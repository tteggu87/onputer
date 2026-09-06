import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {History} from '../dist/history.js';
import {configSchema} from '../dist/config.js';
import {digest} from '../dist/files.js';
import {canonical,Redactor} from '../dist/redaction.js';

async function fixture(t,options={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'onputer history 한글 '));
  const other=path.join(root,'other');await fs.mkdir(other);
  const config=configSchema.parse({roots:[root,other],historyDir:path.join(root,'.onputer/history'),token:'secret-token-'.repeat(6),...options});
  const all=[];
  const open=async c=>{const h=new History(c??config);all.push(h);await h.ready;return h;};
  t.after(async()=>{for(const h of all)await h.close().catch(()=>{});await fs.rm(root,{recursive:true,force:true});});
  return {root,other,config,open,history:await open()};
}
async function textArtifact(h,task,id,workspace=0) {
  let result='',offset=0;
  for(let i=0;i<2000;i++){const p=await h.artifact(workspace,task,id,offset,16000);result+=p.content;if(!p.has_more)return result;assert.ok(p.next_offset>offset);offset=p.next_offset;}
  throw Error('Artifact did not end');
}
test('durable task receipt, valid JSON masking, idempotent replay, and workspace fencing survive restart',async t=>{
  const f=await fixture(t),h=f.history;
  const task=await h.createTask(0,'두 단계 작업');
  const args={workspace:0,path:'config.txt',content:'TOKEN=abc',password:'sensitive',literal:f.config.token};
  const begun=await h.begin(0,'write_file',args,task.task_id,'write-once');
  await assert.rejects(h.begin(0,'write_file',args,task.task_id,'write-once'),/pending/);
  await h.complete(begun.ctx,{content:'TOKEN=abc',ok:true},true);
  const replay=await h.begin(0,'write_file',args,task.task_id,'write-once');
  assert.equal(replay.ctx.operationId,begun.ctx.operationId);assert.deepEqual(replay.cached,{content:'TOKEN=[REDACTED]',ok:true});
  await assert.rejects(h.begin(0,'write_file',{...args,path:'different'},task.task_id,'write-once'),/different arguments/);
  const receipt=await h.read(0,task.task_id,0,50);
  const request=receipt.events.find(e=>e.type==='tool/requested');
  const input=JSON.parse(await textArtifact(h,task.task_id,request.data.input_ref));
  assert.equal(input.content,'TOKEN=[REDACTED]');assert.equal(input.password,'[REDACTED]');assert.equal(input.literal,'[REDACTED]');
  await assert.rejects(h.read(1,task.task_id,0,20),/workspace/);
  await assert.rejects(h.artifact(1,task.task_id,request.data.input_ref,0,100),/workspace/);
  assert.throws(()=>{receipt.events[0].data.title='tampered';});
  await h.finish(0,task.task_id,'completed','verified by caller');await h.close();
  const reopened=await f.open({...f.config,roots:[f.other,f.root]});
  assert.equal((await reopened.list(1,0,20)).tasks[0].task_id,task.task_id);
  const again=await reopened.begin(1,'write_file',{...args,workspace:1},task.task_id,'write-once');
  assert.equal(again.cached.ok,true);
  assert.equal((await reopened.read(1,task.task_id,0,20)).outcome_source,'client');
});
test('unfinished work becomes unknown without re-execution; incomplete final bytes are repaired',async t=>{
  const f=await fixture(t),h=f.history;
  const task=await h.createTask(0,'interrupted',true);
  const {ctx}=await h.begin(0,'run_command',{command:'do-not-execute'},task.task_id);
  const output=await h.output(ctx);await output.write('보존된 출력\n');await output.seal();
  const processId=randomUUID();await h.append(ctx,'process/started',{process_id:processId,pid:12345,output_ref:output.id,command:'do-not-execute',cwd:f.root});
  await h.close();
  const file=path.join(f.config.historyDir,task.task_id,'events.jsonl');const before=await fs.readFile(file);
  await fs.appendFile(file,'{"v":1');
  const restored=await f.open();
  const result=await restored.read(0,task.task_id,0,50);
  assert.equal(result.status,'unknown');assert.equal(result.processes[0].state,'unknown');
  assert.equal(result.events.find(e=>e.type==='task/recovered'&&e.data.truncated_bytes).data.truncated_bytes,6);
  assert.ok((await fs.readFile(file)).subarray(0,before.length).equals(before));
  assert.equal(await textArtifact(restored,task.task_id,output.id),'보존된 출력\n');
  const count=result.events.length;await restored.close();const again=await f.open();
  assert.equal((await again.read(0,task.task_id,0,50)).as_of_seq,count-1);
});
test('committed history corruption is rejected without rewriting the valid-looking prefix',async t=>{
  const f=await fixture(t);const task=await f.history.createTask(0,'original');await f.history.close();
  const file=path.join(f.config.historyDir,task.task_id,'events.jsonl');const data=(await fs.readFile(file,'utf8')).replace('original','tampered');await fs.writeFile(file,data);
  const broken=new History(f.config);await assert.rejects(broken.ready,/corruption/);await broken.close().catch(()=>{});
  assert.equal(await fs.readFile(file,'utf8'),data);
});
test('full legacy task retains reserved capacity for recovery and server startup',async t=>{
  const f=await fixture(t);const task=await f.history.createTask(0,'near-limit',true);
  const ctx=(await f.history.begin(0,'write_file',{path:'x'},task.task_id)).ctx;await f.history.close();
  const file=path.join(f.config.historyDir,task.task_id,'events.jsonl');const events=(await fs.readFile(file,'utf8')).trimEnd().split('\n').map(JSON.parse);
  while(events.length<10000){const payload={v:1,task_id:task.task_id,seq:events.length,time:new Date().toISOString(),type:'file/planned',operation_id:ctx.operationId,data:{changes:[]},prev_hash:events.at(-1).hash};events.push({...payload,hash:digest(canonical(payload))});}
  await fs.writeFile(file,events.map(e=>JSON.stringify(e)+'\n').join(''));
  const reopened=await f.open();const result=await reopened.read(0,task.task_id,9998,20);
  assert.equal(result.status,'unknown');assert.ok(result.events.some(e=>e.type==='task/recovered'));
  assert.ok(result.as_of_seq>=10000);
});
test('diff artifacts and context digests are immutable historical evidence',async t=>{
  const f=await fixture(t);const h=f.history;const task=await h.createTask(0,'file evidence');
  const {ctx}=await h.begin(0,'write_file',{path:'x'},task.task_id);
  const recorder=h.recorder(ctx);const plan=await recorder.prepare([{path:'x.txt',before:'old\r\n',after:'new\r\n'}]);await recorder.applied(plan);
  await h.complete(ctx,{files:[{path:'AGENTS.md',content:'first'}]},true);
  await h.context(ctx,'instructions',[{path:'AGENTS.md',sha256:digest('first'),partial:false}]);
  await h.context(ctx,'instructions',[{path:'AGENTS.md',sha256:digest('first'),partial:false}]);
  await h.context(ctx,'instructions',[{path:'AGENTS.md',sha256:digest('second'),partial:false}]);
  const result=await h.read(0,task.task_id,0,50);
  assert.equal(result.file_changes.length,1);assert.equal(result.events.filter(e=>e.type==='context/provided').length,2);
  const diff=await textArtifact(h,task.task_id,result.file_changes[0].diff_ref);
  assert.match(diff,/-old/);assert.match(diff,/\+new/);assert.equal(result.file_changes[0].before_hash,digest('old\r\n'));
});
test('output keeps a bounded UTF-8 prefix and never appends after reaching its cap',async t=>{
  const f=await fixture(t,{historyArtifactMaxBytes:1048576});const h=f.history;const task=await h.createTask(0,'bounded');const {ctx}=await h.begin(0,'run_command',{},task.task_id);
  const out=await h.output(ctx);await out.write('x'.repeat(1048575)+'한');await out.write('LATER');await out.seal();
  const text=await textArtifact(h,task.task_id,out.id);assert.equal(text,'x'.repeat(1048575));
  const first=await h.artifact(0,task.task_id,out.id,0,10);assert.equal(first.truncated,true);assert.equal(first.sealed,true);
});
test('known secret split across long output chunks remains masked, including repetitive tokens',()=>{
  for(const token of ['a'.repeat(64),'secret-'.repeat(12)]) {
    const mask=new Redactor(token).stream();
    const parts=['x'.repeat(64500),token.slice(0,30),token.slice(30),'\n'];let text='';for(const p of parts)text+=mask.push(p);text+=mask.push('',true);
    assert.ok(!text.includes(token));assert.ok(text.includes('[REDACTED]'));
    const boundary=new Redactor(token).stream();const whole='x'.repeat(64000)+token+'y'.repeat(1024-token.length/2);
    const merged=boundary.push(whole)+boundary.push('\n')+boundary.push('',true);assert.ok(!merged.includes(token));assert.ok(merged.includes('[REDACTED]'));
  }
});
test('failed durable append rolls back bytes and allows a later valid append',async t=>{
  const f=await fixture(t);const h=f.history;const task=await h.createTask(0,'write-failure');const {ctx}=await h.begin(0,'demo',{},task.task_id);
  const file=path.join(f.config.historyDir,task.task_id,'events.jsonl'),before=await fs.readFile(file);
  const open=fs.open;let fail=true;
  fs.open=async(...args)=>{const handle=await open(...args);if(args[0]!==file)return handle;return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{if(fail){fail=false;throw Error('injected fsync failure');}return target.sync();};const value=target[key];return typeof value==='function'?value.bind(target):value;}});};
  try{await assert.rejects(h.append(ctx,'file/planned',{changes:[]}),/injected/);}finally{fs.open=open;}
  assert.ok((await fs.readFile(file)).equals(before));await h.append(ctx,'file/planned',{changes:[]});
});

test('file completion uses reserved capacity after a plan reaches the admission boundary',async t=>{
  const f=await fixture(t);const task=await f.history.createTask(0,'file-limit');
  const old=(await f.history.begin(0,'old',{},task.task_id)).ctx;await f.history.complete(old,{ok:true},true);await f.history.close();
  const file=path.join(f.config.historyDir,task.task_id,'events.jsonl');const events=(await fs.readFile(file,'utf8')).trimEnd().split('\n').map(JSON.parse);
  while(events.length<7994){const payload={v:1,task_id:task.task_id,seq:events.length,time:new Date().toISOString(),type:'file/planned',operation_id:old.operationId,data:{changes:[]},prev_hash:events.at(-1).hash};events.push({...payload,hash:digest(canonical(payload))});}
  await fs.writeFile(file,events.map(e=>JSON.stringify(e)+'\n').join(''));
  const h=await f.open();const {ctx}=await h.begin(0,'write_file',{path:'x.txt'},task.task_id);
  const {saveText}=await import('../dist/files.js');await saveText(f.root,'x.txt','written',undefined,h.recorder(ctx));
  await h.complete(ctx,{ok:true},true);
  const receipt=await h.read(0,task.task_id,7994,20);
  assert.equal(await fs.readFile(path.join(f.root,'x.txt'),'utf8'),'written');
  assert.equal(receipt.file_changes.at(-1).path,'x.txt');
  assert.ok(receipt.events.some(e=>e.type==='file/changed'));
  await h.finish(0,task.task_id,'completed','boundary completion verified');
});
