import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { History, type OutputArtifact } from './history.js';
import type { OperationContext } from './history-types.js';

type StopReason='cancelled'|'timeout'|'shutdown';
interface Job {
  id:string;ctx:OperationContext;child:ChildProcess;artifact:OutputArtifact;state:string;exitCode:number|null;signal:string|null;
  osClosed:boolean;published:boolean;io:Promise<void>;started:Promise<void>;termination?:Promise<void>;stopReason?:StopReason;stopError?:string;recordingError?:string;
  timer?:NodeJS.Timeout;done:Promise<void>;resolveDone:()=>void;
}
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export class Jobs {
  private jobs=new Map<string,Job>();
  private reservations=0;
  private closing=false;
  constructor(private history:History){}
  async start(command:string,cwd:string,timeout:number,shell:'default'|'powershell'|'cmd',ctx:OperationContext) {
    await this.history.ready;
    if(this.closing)throw new Error('Server is shutting down');
    if(this.reservations+[...this.jobs.values()].filter(j=>['running','stopping'].includes(j.state)||!!j.stopError).length>=8)throw new Error('Eight commands are running or stopping; wait for actual completion');
    this.reservations++;
    let artifact:OutputArtifact|undefined;
    try {
      const windows=process.platform==='win32';
      if(!windows&&shell!=='default')throw new Error('powershell and cmd options are Windows-only');
      let executable:string,args:string[];
      if(windows&&shell!=='cmd') {
        executable='powershell.exe';
        const prefix="[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; $global:LASTEXITCODE = 0; ";
        args=['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(prefix+command+'\n$onputerSuccess = $?; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; if (-not $onputerSuccess) { exit 1 }','utf16le').toString('base64')];
      } else if(windows) {executable=process.env.ComSpec||'cmd.exe';args=['/d','/s','/c',command];}
      else {executable=process.platform==='darwin'?'/bin/zsh':'/bin/sh';args=['-c',command];}
      artifact=await this.history.output(ctx);
      if(this.closing)throw new Error('Server is shutting down');
      const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('ONPUTER_'))delete env[key];
      const child=spawn(executable,args,{cwd,env,detached:!windows,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let resolveDone!:()=>void;
      const done=new Promise<void>(r=>{resolveDone=r;});
      const job:Job={id:randomUUID(),ctx,child,artifact,state:'running',exitCode:null,signal:null,osClosed:false,published:false,io:Promise.resolve(),started:Promise.resolve(),done,resolveDone};
      this.jobs.set(job.id,job);
      const spawned=new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
      job.started=spawned.then(async()=>{
        await this.history.append(ctx,'process/started',{process_id:job.id,...child.pid?{pid:child.pid}:{},output_ref:job.artifact.id,command:this.history.redactor.text(command).slice(0,2000),cwd});job.published=true;
      });
      // Attach a rejection observer immediately; the owning start call still reports failures.
      void job.started.catch(()=>{});
      const enqueue=(text:string)=>{
        job.io=job.io.then(async()=>{if(text)await job.artifact.write(text);}).catch(error=>{job.recordingError=this.history.redactor.text(String(error));void this.requestStop(job,'shutdown');});
        return job.io;
      };
      for(const stream of [child.stdout!,child.stderr!]) {
        const decoder=new StringDecoder('utf8'),mask=this.history.redactor.stream();
        stream.on('data',chunk=>{stream.pause();void enqueue(mask.push(decoder.write(chunk))).finally(()=>stream.resume());});
        stream.on('end',()=>{void enqueue(mask.push(decoder.end(),true));});
        stream.on('error',error=>{job.recordingError=this.history.redactor.text(String(error));});
      }
      child.on('error',error=>{job.recordingError=this.history.redactor.text(error.message);});
      child.on('close',(code,signal)=>{
        job.osClosed=true;job.exitCode=code;job.signal=signal;clearTimeout(job.timer);
        void this.settle(job);
      });
      job.timer=setTimeout(()=>{void this.requestStop(job,'timeout');},timeout);job.timer.unref();
      try {await job.started;} catch(error) {await this.requestStop(job,'shutdown');await job.done;throw error;}
      return this.readLive(job,0);
    } catch(error) {if(artifact && ![...this.jobs.values()].some(j=>j.artifact===artifact))await artifact.seal().catch(()=>{});throw error;}
    finally{this.reservations--;}
  }
  private async settle(job:Job) {
    try {
      await job.started.catch(()=>{});await job.io;await job.termination;
      try{await job.artifact.seal();}catch(e){job.recordingError=this.history.redactor.text(String(e));}
      const state=job.stopError?'unknown':job.recordingError?'failed':job.stopReason==='timeout'?'timed_out':job.stopReason?'stopped':job.exitCode===0?'completed':'failed';
      if(job.published) {
        try {
          await this.history.append(job.ctx,'process/exited',{process_id:job.id,state,exit_code:job.exitCode,signal:job.signal,output_ref:job.artifact.id,...job.recordingError||job.stopError?{recording_error:job.recordingError??job.stopError}:{} });
          job.state=state;await this.history.maybeClose(job.ctx);
        } catch(e){job.recordingError=this.history.redactor.text(String(e));job.state='unknown';}
      } else job.state='failed';
    } finally {
      job.resolveDone();
      for(const [id,candidate] of this.jobs)if(this.jobs.size>64 && !['running','stopping'].includes(candidate.state)&&!candidate.stopError)this.jobs.delete(id);
    }
  }
  private requestStop(job:Job,reason:StopReason):Promise<void> {
    if(job.termination)return job.termination;
    if(job.osClosed)return Promise.resolve();
    job.state='stopping';job.stopReason=reason;
    job.termination=(async()=>{
      await job.started.catch(()=>{});
      if(job.published)try{await this.history.append(job.ctx,'process/stopping',{process_id:job.id,reason});}catch(e){job.recordingError=this.history.redactor.text(String(e));}
      const pid=job.child.pid;if(!pid)return;
      if(process.platform==='win32') {
        const killer=spawn('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
        const killed=await new Promise<boolean>(resolve=>{
          const timer=setTimeout(()=>{killer.kill();resolve(false);},5000);
          killer.once('error',()=>{clearTimeout(timer);resolve(false);});killer.once('close',code=>{clearTimeout(timer);resolve(code===0);});
        });
        if(!killed){job.stopError='Process-tree termination could not be confirmed. Inspect the OS process list.';job.child.kill();job.child.stdout?.destroy();job.child.stderr?.destroy();}
      } else {
        try{process.kill(-pid,'SIGTERM');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')job.stopError=String(e);}
        // Keep this timer referenced, even after the parent closes, until group escalation runs.
        await delay(1000);
        try{process.kill(-pid,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')job.stopError=String(e);}
      }
    })();
    return job.termination;
  }
  private async readLive(job:Job,offset:number) {
    await job.io;
    const workspace=this.history.workspaceKeys.indexOf(job.ctx.workspaceKey);
    const data=await this.history.artifact(workspace,job.ctx.taskId,job.artifact.id,offset,16000);
    return {process_id:job.id,task_id:job.ctx.taskId,operation_id:job.ctx.operationId,state:job.state,exit_code:job.exitCode,signal:job.signal,output:data.content,next_offset:data.next_offset,offset_unit:'utf8_bytes',output_lost:job.artifact.truncated,has_more:data.has_more,artifact_id:job.artifact.id,live:true,...job.recordingError?{recording_error:job.recordingError}:{}};
  }
  async read(id:string,offset:number,workspace=0) {
    const job=this.jobs.get(id);
    if(job) {if(job.ctx.workspaceKey!==this.history.workspaceKeys[workspace])throw new Error('Process does not belong to this workspace');return this.readLive(job,offset);}
    const saved=await this.history.findProcess(workspace,id);
    const data=await this.history.artifact(workspace,saved.task_id,saved.output_ref,offset,16000);
    return {...saved,output:data.content,next_offset:data.next_offset,offset_unit:'utf8_bytes',output_lost:data.truncated,has_more:data.has_more,artifact_id:saved.output_ref,live:false};
  }
  async stop(id:string,workspace=0) {
    const job=this.jobs.get(id);
    if(!job){const prior=await this.history.findProcess(workspace,id);return {...prior,live:false,message:'Historical process. No signal was sent; a stored PID is not safe to reuse.'};}
    if(job.ctx.workspaceKey!==this.history.workspaceKeys[workspace])throw new Error('Process does not belong to this workspace');
    if(['running','stopping'].includes(job.state)&&!job.osClosed)void this.requestStop(job,'cancelled');
    return this.readLive(job,0);
  }
  async close() {
    if(this.closing)return;this.closing=true;
    const jobs=[...this.jobs.values()];await Promise.all(jobs.map(j=>this.requestStop(j,'shutdown')));
    const done=Promise.all(jobs.map(j=>j.done));
    let timer:NodeJS.Timeout|undefined;
    try{await Promise.race([done,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Some processes did not settle during shutdown')),8000);})]);}
    finally{clearTimeout(timer);}
  }
}
