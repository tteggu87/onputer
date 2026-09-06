import fs, {type FileHandle} from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { createTwoFilesPatch } from 'diff';
import { digest } from './files.js';
import { Redactor, canonical } from './redaction.js';
import { dataSchemas, envelope, project, type Data, type EventType, type HistoryEvent, type OperationContext } from './history-types.js';
import type { Config } from './config.js';

const MAX_LOG_BYTES=5*1024*1024, MAX_EVENTS=11000, MAX_TASKS=5000;
const ADMISSION_BYTES=3*1024*1024, ADMISSION_EVENTS=8000;
function frozen<T>(value:T):T {if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
const validId=(id:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
type Task={id:string;events:HistoryEvent[];bytes:number};
export type FileChange={path:string;before:string|null;after:string|null};
export interface FileRecorder { prepare(changes:FileChange[]):Promise<number>; applied(plan:number):Promise<void> }
export class History {
  readonly redactor:Redactor;
  readonly workspaceKeys:string[]=[];
  readonly ready:Promise<void>;
  private release?:()=>Promise<void>;
  private fatal?:Error;
  private stopped=false;
  private queue:Promise<unknown>=Promise.resolve();
  private cache=new Map<string,Task>();
  private ids=new Set<string>();
  readonly root:string;
  constructor(readonly config:Config) {
    this.root=path.resolve(config.historyDir ?? path.join(config.roots[0],'.onputer','history'));
    this.redactor=new Redactor(config.token);
    this.ready=this.initialize();
  }
  private async initialize() {
    try {
      await fs.mkdir(this.root,{recursive:true,mode:0o700});
      if((await fs.lstat(this.root)).isSymbolicLink()) throw new Error('History root must not be a symlink');
      this.release=await lockfile.lock(this.root,{lockfilePath:path.join(this.root,'.writer.lock'),stale:15000,update:5000,retries:{retries:16,minTimeout:1000,maxTimeout:1000},onCompromised:e=>{this.fatal=e;}});
      for(const root of this.config.roots) this.workspaceKeys.push(digest(await fs.realpath(root)));
      const entries=await fs.readdir(this.root,{withFileTypes:true});
      for(const entry of entries) if(validId(entry.name) && entry.isDirectory() && !entry.isSymbolicLink()) this.ids.add(entry.name);
      if(this.ids.size>MAX_TASKS) throw new Error('History task limit exceeded; archive old history folders locally');
      for(const id of [...this.ids]) {
        const task=await this.load(id,true);
        if(!task.events.length) {this.ids.delete(id);continue;}
        const view=project(task.events);
        if(view.closed && view.closed.outcome!=='unknown' && this.config.historyRetentionDays>0 && Date.parse(view.updated_at)<Date.now()-this.config.historyRetentionDays*86400000) {
          await fs.rm(this.taskDir(id),{recursive:true,force:true});this.cache.delete(id);this.ids.delete(id);continue;
        }
        const operations=Object.entries(view.operations).filter(([,o])=>o.state==='pending').map(([id])=>id);
        const processes=Object.values(view.processes).filter(p=>['running','stopping'].includes(p.state)).map(p=>p.process_id);
        if(operations.length||processes.length) {
          await this.appendUnlocked(task,'task/recovered',{operation_ids:operations,process_ids:processes,truncated_bytes:0});
          if(view.automatic) await this.appendUnlocked(task,'task/closed',{outcome:'unknown',summary:'Server restarted before a definitive outcome was recorded. Inspect actual files/processes; do not automatically repeat effects.',reported_by:'server'});
        }
      }
    } catch(e) {this.fatal=e instanceof Error?e:new Error(String(e));await this.release?.().catch(()=>{});this.release=undefined;throw this.fatal;}
  }
  private taskDir(id:string) {if(!validId(id))throw new Error('Invalid task_id');return path.join(this.root,id);}
  private async guarded(file:string) {
    const relative=path.relative(this.root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('History path outside storage');
    let cursor=this.root;
    for(const part of relative.split(path.sep).filter(Boolean)) {cursor=path.join(cursor,part);if((await fs.lstat(cursor)).isSymbolicLink())throw new Error('History links are forbidden');}
    return file;
  }
  private remember(task:Task) {this.cache.delete(task.id);this.cache.set(task.id,task);while(this.cache.size>32)this.cache.delete(this.cache.keys().next().value!);}
  private async load(id:string,repair=false):Promise<Task> {
    const cached=this.cache.get(id);if(cached)return cached;
    const dir=this.taskDir(id),file=path.join(dir,'events.jsonl');
    let bytes:Buffer;
    try {await this.guarded(file);const size=(await fs.stat(file)).size;if(size>MAX_LOG_BYTES)throw new Error('Oversized task event log');bytes=await fs.readFile(file);}
    catch(e){if(repair && (e as NodeJS.ErrnoException).code==='ENOENT')return {id,events:[],bytes:0};throw e;}
    const end=bytes.lastIndexOf(10)+1;
    const tail=bytes.length-end;
    if(!end) {if(repair && bytes.length===0)return {id,events:[],bytes:0};throw new Error('Invalid initial history record: '+id);}
    const lines=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,end)).trimEnd().split('\n');
    const events:HistoryEvent[]=[];
    try {
      for(const line of lines) {
        const raw=envelope.strict().parse(JSON.parse(line));
        if(!(raw.type in dataSchemas))throw new Error('Unknown required event type: '+raw.type);
        const {hash,...payload}=raw;
        if(raw.task_id!==id||raw.seq!==events.length||raw.prev_hash!==(events.at(-1)?.hash??null)||hash!==digest(canonical(payload)))throw new Error('Event sequence/hash chain mismatch');
        const data=dataSchemas[raw.type as EventType].strict().parse(raw.data);
        events.push(frozen({...raw,data} as HistoryEvent));
      }
      if(events[0]?.type!=='task/opened'||events.slice(1).some(e=>e.type==='task/opened'))throw new Error('Invalid task header');
    } catch(e) {throw new Error(`History corruption in ${id}; committed records were not changed: ${e instanceof Error?e.message:String(e)}`);}
    const task={id,events,bytes:end};this.remember(task);
    if(tail) {
      if(!repair)throw new Error('Incomplete history tail; restart server to recover');
      const handle=await fs.open(file,'r+');try{await handle.truncate(end);await handle.sync();}finally{await handle.close();}
      await this.appendUnlocked(task,'task/recovered',{operation_ids:[],process_ids:[],truncated_bytes:tail});
    }
    return task;
  }
  private async serial<T>(fn:()=>Promise<T>):Promise<T> {
    await this.ready;
    const next=this.queue.then(async()=>{if(this.fatal)throw this.fatal;if(this.stopped)throw new Error('History is closed');return fn();});
    this.queue=next.catch(()=>{});return next;
  }
  private checkScope(task:Task,key:string) {if(project(task.events).workspace_key!==key)throw new Error('Task does not belong to this workspace');}
  private async appendUnlocked<K extends EventType>(task:Task,type:K,data:Data<K>,operationId?:string) {
    if(this.fatal)throw this.fatal;
    if(task.events.length>=MAX_EVENTS)throw new Error('Task event limit reached; start a new task');
    const parsed=dataSchemas[type].strict().parse(this.redactor.value(data));
    const payload={v:1 as const,task_id:task.id,seq:task.events.length,time:new Date().toISOString(),type,...operationId?{operation_id:operationId}:{},data:parsed,prev_hash:task.events.at(-1)?.hash??null};
    const event=frozen({...payload,hash:digest(canonical(payload))} as HistoryEvent);
    const bytes=Buffer.from(JSON.stringify(event)+'\n');
    const completion=['file/changed','context/provided','tool/completed','process/started','process/stopping','process/exited','task/recovered','task/closed'].includes(type)||(type==='artifact/created'&&(data as Data<'artifact/created'>).kind==='result')||(type==='artifact/sealed'&&['output','result'].includes(project(task.events).artifacts[(data as Data<'artifact/sealed'>).artifact_id]?.kind));
    if(!completion && (task.events.length>=ADMISSION_EVENTS || task.bytes+bytes.length>ADMISSION_BYTES))throw new Error('Task recording admission limit reached; finalization space is reserved');
    if(task.bytes+bytes.length>MAX_LOG_BYTES)throw new Error('Task log limit reached; start a new task');
    const file=await this.guarded(path.join(this.taskDir(task.id),'events.jsonl'));
    const handle=await fs.open(file,'r+');
    try {let written=0;while(written<bytes.length){const result=await handle.write(bytes,written,bytes.length-written,task.bytes+written);if(!result.bytesWritten)throw new Error('History write made no progress');written+=result.bytesWritten;}await handle.sync();}
    catch(e){try{await handle.truncate(task.bytes);await handle.sync();}catch{this.fatal=new Error('History write and rollback failed; restart and inspect storage');}throw e;}
    finally{await handle.close();}
    task.events.push(event);task.bytes+=bytes.length;this.remember(task);return event;
  }
  async append<K extends EventType>(ctx:OperationContext,type:K,data:Data<K>) {return this.serial(async()=>{const t=await this.load(ctx.taskId);this.checkScope(t,ctx.workspaceKey);return this.appendUnlocked(t,type,data,ctx.operationId);});}
  async createTask(workspace:number,title:string,automatic=false) {
    return this.serial(async()=>{
      const key=this.workspaceKeys[workspace];if(!key)throw new Error('Unknown workspace');if(this.ids.size>=MAX_TASKS)throw new Error('History task limit reached; archive old completed history locally');
      const id=randomUUID(),dir=this.taskDir(id);await fs.mkdir(dir,{mode:0o700});await fs.mkdir(path.join(dir,'artifacts'),{mode:0o700});await fs.writeFile(path.join(dir,'events.jsonl'),'',{flag:'wx',mode:0o600});
      const task={id,events:[],bytes:0};await this.appendUnlocked(task,'task/opened',{title:title.slice(0,200),workspace_key:key,workspace_path:this.config.roots[workspace],automatic,owner:'local-owner'});this.ids.add(id);
      return {task_id:id,workspace_key:key,title:this.redactor.text(title),status:'open'};
    });
  }
  async begin(workspace:number,name:string,args:object,taskId?:string,idempotencyKey?:string) {
    if(idempotencyKey&&!taskId)throw new Error('idempotency_key requires an explicit task_id from start_task');
    taskId ??= (await this.createTask(workspace,name,true)).task_id;
    const id=taskId;
    return this.serial(async()=>{
      const task=await this.load(id);this.checkScope(task,this.workspaceKeys[workspace]);const view=project(task.events);const {workspace:_workspace,...identity}=args as Record<string,unknown>;const inputHash=digest(canonical(identity));
      if(idempotencyKey) {
        const existing=Object.entries(view.operations).find(([,o])=>o.idempotency_key===idempotencyKey);
        if(existing) {
          const [operationId,o]=existing;
          if(o.name!==name||o.input_hash!==inputHash)throw new Error('Idempotency key was used for different arguments');
          if(o.state==='pending'||o.state==='unknown'||!o.result_ref)throw new Error('Previous operation is pending or outcome unknown; inspect read_task before retrying');
          return {ctx:{taskId:id,operationId,workspaceKey:view.workspace_key},cached:JSON.parse(await this.artifactTextUnlocked(task,o.result_ref)),cachedOk:o.state==='completed'};
        }
      }
      if(view.closed)throw new Error('Task is closed; start a new task');
      if(task.bytes>=ADMISSION_BYTES||task.events.length>=ADMISSION_EVENTS)throw new Error('Task admission limit reached; finish this task and start a new one');
      if(Object.values(view.operations).filter(o=>o.state==='pending').length>=16)throw new Error('Too many pending operations in this task');
      const ctx={taskId:id,operationId:randomUUID(),workspaceKey:view.workspace_key};
      const ref=await this.saveTextUnlocked(task,ctx.operationId,'input',JSON.stringify(this.redactor.value(args)));
      await this.appendUnlocked(task,'tool/requested',{name,input_hash:inputHash,input_ref:ref.artifact_id,...idempotencyKey?{idempotency_key:idempotencyKey}:{}},ctx.operationId);
      return {ctx,cached:undefined,cachedOk:undefined};
    });
  }
  async complete(ctx:OperationContext,output:object,ok:boolean) {
    await this.serial(async()=>{const t=await this.load(ctx.taskId);this.checkScope(t,ctx.workspaceKey);const ref=await this.saveTextUnlocked(t,ctx.operationId,'result',JSON.stringify(this.redactor.value(output)));await this.appendUnlocked(t,'tool/completed',{ok,result_ref:ref.artifact_id},ctx.operationId);});
    await this.maybeClose(ctx);
  }
  async maybeClose(ctx:OperationContext) {
    return this.serial(async()=>{
      const task=await this.load(ctx.taskId),v=project(task.events);if(!v.automatic||v.closed)return;
      if(Object.values(v.operations).some(o=>o.state==='pending')||Object.values(v.processes).some(p=>['running','stopping'].includes(p.state)))return;
      const unknown=Object.values(v.operations).some(o=>o.state==='unknown')||Object.values(v.processes).some(p=>p.state==='unknown');
      const failed=Object.values(v.operations).some(o=>o.state==='failed')||Object.values(v.processes).some(p=>p.state!=='completed');
      await this.appendUnlocked(task,'task/closed',{outcome:unknown?'unknown':failed?'failed':'completed',summary:'Automatic operation record',reported_by:'server'});
    });
  }
  async finish(workspace:number,taskId:string,outcome:'completed'|'failed',summary:string) {
    return this.serial(async()=>{
      const task=await this.load(taskId);this.checkScope(task,this.workspaceKeys[workspace]);const v=project(task.events);
      if(v.closed)throw new Error('Task is already closed');
      if(Object.values(v.operations).some(o=>o.state==='pending')||Object.values(v.processes).some(p=>['running','stopping'].includes(p.state)))throw new Error('Task still has running operations or processes');
      if(outcome==='completed' && (Object.values(v.operations).some(o=>o.state==='unknown')||Object.values(v.processes).some(p=>p.state==='unknown')))throw new Error('Task contains unknown outcomes; close as failed and verify in a new task');
      await this.appendUnlocked(task,'task/closed',{outcome,summary:summary.slice(0,2000),reported_by:'client'});return this.summary(task);
    });
  }
  private summary(t:Task) {
    const v=project(t.events);return {task_id:v.task_id,title:v.title,workspace_key:v.workspace_key,status:v.status,automatic:v.automatic,created_at:v.created_at,updated_at:v.updated_at,as_of_seq:v.as_of_seq,outcome_source:v.closed?.reported_by??null,summary:v.closed?.summary??null,operation_count:Object.keys(v.operations).length,failed_operations:Object.values(v.operations).filter(o=>o.state==='failed').length,unknown_outcomes:Object.values(v.operations).filter(o=>o.state==='unknown').length+Object.values(v.processes).filter(p=>p.state==='unknown').length,failed_processes:Object.values(v.processes).filter(p=>['failed','timed_out','unknown'].includes(p.state)).length,processes:Object.values(v.processes),file_changes:v.file_changes,artifact_count:Object.keys(v.artifacts).length};
  }
  async list(workspace:number,offset:number,limit:number) {
    return this.serial(async()=>{const rows=[];for(const id of this.ids){const t=await this.load(id);if(project(t.events).workspace_key===this.workspaceKeys[workspace])rows.push(this.summary(t));}rows.sort((a,b)=>b.updated_at.localeCompare(a.updated_at));return {tasks:rows.slice(offset,offset+limit),total:rows.length,has_more:offset+limit<rows.length,next_offset:Math.min(rows.length,offset+limit)};});
  }
  async read(workspace:number,id:string,offset:number,limit:number) {
    return this.serial(async()=>{const t=await this.load(id);this.checkScope(t,this.workspaceKeys[workspace]);return {...this.summary(t),events:t.events.slice(offset,offset+limit),has_more:offset+limit<t.events.length,next_offset:Math.min(t.events.length,offset+limit)};});
  }
  async findProcess(workspace:number,id:string) {
    return this.serial(async()=>{for(const taskId of this.ids){const t=await this.load(taskId),v=project(t.events);if(v.workspace_key!==this.workspaceKeys[workspace])continue;const p=v.processes[id];if(p)return {...p};}throw new Error('Unknown process_id for this workspace');});
  }
  async processes(workspace:number) {return this.serial(async()=>{const rows=[];for(const id of this.ids){const t=await this.load(id),v=project(t.events);if(v.workspace_key===this.workspaceKeys[workspace])rows.push(...Object.values(v.processes));}return {processes:rows.sort((a,b)=>b.started_at.localeCompare(a.started_at)).slice(0,200),truncated:rows.length>200};});}
  private async createArtifactUnlocked(task:Task,operationId:string,kind:Data<'artifact/created'>['kind']) {
    const artifactId=randomUUID(),file=path.join(this.taskDir(task.id),'artifacts',artifactId+'.txt');await this.guarded(path.dirname(file));
    const handle=await fs.open(file,'wx',0o600);
    try {await handle.sync();await this.appendUnlocked(task,'artifact/created',{artifact_id:artifactId,kind},operationId);} catch(e){await handle.close();throw e;}
    return {artifactId,handle};
  }
  private async saveTextUnlocked(task:Task,op:string,kind:Data<'artifact/created'>['kind'],text:string) {
    const clean=kind==='input'||kind==='result'?text:this.redactor.text(text),bytes=Buffer.from(clean);
    if(bytes.length>this.config.historyArtifactMaxBytes)throw new Error('History artifact limit exceeded; reduce result or increase historyArtifactMaxBytes');
    const {artifactId,handle}=await this.createArtifactUnlocked(task,op,kind);
    try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    await this.appendUnlocked(task,'artifact/sealed',{artifact_id:artifactId,bytes:bytes.length,total_bytes:bytes.length,truncated:false,sha256:digest(clean)},op);return {artifact_id:artifactId};
  }
  async output(ctx:OperationContext):Promise<OutputArtifact> {
    return this.serial(async()=>{const t=await this.load(ctx.taskId);this.checkScope(t,ctx.workspaceKey);const {artifactId,handle}=await this.createArtifactUnlocked(t,ctx.operationId,'output');return new OutputArtifact(this,ctx,artifactId,handle,this.config.historyArtifactMaxBytes);});
  }
  async sealOutput(ctx:OperationContext,data:Data<'artifact/sealed'>) {await this.append(ctx,'artifact/sealed',data);}
  private async artifactTextUnlocked(task:Task,id:string) {
    if(!validId(id)||!project(task.events).artifacts[id])throw new Error('Unknown artifact_id');
    const file=await this.guarded(path.join(this.taskDir(task.id),'artifacts',id+'.txt'));
    if((await fs.stat(file)).size>this.config.historyArtifactMaxBytes)throw new Error('Oversized stored artifact');const text=await fs.readFile(file,'utf8');const expected=project(task.events).artifacts[id].sha256;if(expected && digest(text)!==expected)throw new Error('Artifact checksum mismatch');return text;
  }
  async artifact(workspace:number,taskId:string,id:string,offset:number,limit:number) {
    return this.serial(async()=>{
      const t=await this.load(taskId);this.checkScope(t,this.workspaceKeys[workspace]);const meta=project(t.events).artifacts[id];if(!validId(id)||!meta)throw new Error('Unknown artifact_id');
      const file=await this.guarded(path.join(this.taskDir(taskId),'artifacts',id+'.txt')),handle=await fs.open(file,'r');
      try {
        const size=(await handle.stat()).size;
        if(meta.sha256 && size!==meta.bytes)throw new Error('Artifact size differs from its sealed receipt');
        if(offset>size)throw new Error('Offset exceeds artifact size');
        const buffer=Buffer.alloc(Math.min(limit,size-offset));const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);let length=bytesRead;
        if(length && (buffer[0]&0xc0)===0x80)throw new Error('Offset is inside a UTF-8 character; use next_offset or zero');
        let text='';for(let attempt=0;attempt<4;attempt++){try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length));break;}catch(e){if(attempt===3)throw e;length--;}}
        const incompleteTail=length<bytesRead && offset+bytesRead===size;
        if(incompleteTail && meta.sha256)throw new Error('Sealed artifact has invalid UTF-8');
        return {task_id:taskId,artifact_id:id,kind:meta.kind,content:text,offset,next_offset:offset+length,has_more:!incompleteTail&&offset+length<size,bytes:size,sealed:meta.sha256!==undefined,truncated:meta.truncated??null,incomplete_tail:incompleteTail};
      } finally{await handle.close();}
    });
  }
  recorder(ctx:OperationContext):FileRecorder {
    return {prepare:changes=>this.serial(async()=>{
      const t=await this.load(ctx.taskId);this.checkScope(t,ctx.workspaceKey);const recorded=[];
      for(const c of changes){const diff=createTwoFilesPatch(c.before===null?'/dev/null':'a/'+c.path,c.after===null?'/dev/null':'b/'+c.path,c.before??'',c.after??'',undefined,undefined,{context:3,timeout:100});const ref=await this.saveTextUnlocked(t,ctx.operationId,'diff',diff??'Diff omitted: computation budget exceeded. Hashes still identify the planned change.');recorded.push({path:c.path,before_hash:c.before===null?null:digest(c.before),after_hash:c.after===null?null:digest(c.after),diff_ref:ref.artifact_id,diff_complete:diff!==undefined});}
      return (await this.appendUnlocked(t,'file/planned',{changes:recorded},ctx.operationId)).seq;
    }),applied:async plan=>{await this.append(ctx,'file/changed',{plan_seq:plan});}};
  }
  async context(ctx:OperationContext,kind:'instructions'|'skill',entries:{path:string;sha256:string;partial:boolean}[]) {
    return this.serial(async()=>{
      const t=await this.load(ctx.taskId),v=project(t.events),resultRef=v.operations[ctx.operationId]?.result_ref;if(!resultRef)return;
      for(const entry of entries) if(v.contexts[kind+':'+entry.path]!==entry.sha256) await this.appendUnlocked(t,'context/provided',{...entry,kind,result_ref:resultRef},ctx.operationId);
    });
  }
  async close() {await this.ready.catch(()=>{});await this.queue;if(this.stopped)return;this.stopped=true;await this.release?.();this.release=undefined;}
}
export class OutputArtifact {
  private bytes=0;private total=0;private hash=createHash('sha256');private sealed=false;private capped=false;
  constructor(private history:History,private ctx:OperationContext,readonly id:string,private handle:FileHandle,private max:number){}
  async write(text:string) {if(this.sealed)throw new Error('Output artifact is sealed');const buffer=Buffer.from(text);this.total+=buffer.length;if(this.capped)return;if(buffer.length>this.max-this.bytes)this.capped=true;let length=Math.min(buffer.length,this.max-this.bytes);while(length>0&&length<buffer.length&&(buffer[length]&0xc0)===0x80)length--;const kept=buffer.subarray(0,length);if(kept.length){await this.handle.writeFile(kept);this.hash.update(kept);this.bytes+=kept.length;}}
  get truncated() {return this.total>this.bytes;}
  async seal() {if(this.sealed)return;this.sealed=true;try{await this.handle.sync();}finally{await this.handle.close();}await this.history.sealOutput(this.ctx,{artifact_id:this.id,bytes:this.bytes,total_bytes:this.total,truncated:this.total>this.bytes,sha256:this.hash.digest('hex')});}
}
