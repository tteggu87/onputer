import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {History} from '../dist/history.js';
import {Jobs} from '../dist/jobs.js';
import {configSchema} from '../dist/config.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('stopping retains admission capacity, and another workspace cannot control a process',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'onputer-stop-capacity-'));const other=path.join(root,'other');await fs.mkdir(other);
  const h=new History(configSchema.parse({roots:[root,other],token:'capacity-token-'.repeat(4)}));await h.ready;const jobs=new Jobs(h);
  t.after(async()=>{await jobs.close();await h.close();await fs.rm(root,{recursive:true,force:true});});
  await fs.writeFile(path.join(root,'hold.cjs'),"process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000);");
  const task=await h.createTask(0,'capacity');const ids=[];
  for(let i=0;i<8;i++){const {ctx}=await h.begin(0,'run_command',{i},task.task_id);const result=await jobs.start('node hold.cjs',root,30000,'default',ctx);await h.complete(ctx,result,true);ids.push(result.process_id);}
  for(let i=0;i<100;i++){if((await jobs.read(ids[0],0)).output.includes('ready'))break;await pause(100);}
  await assert.rejects(jobs.stop(ids[0],1),/workspace/);
  let release;const gate=new Promise(r=>{release=r;});const append=h.append.bind(h);
  h.append=async(ctx,type,data)=>{if(type==='process/stopping')await gate;return append(ctx,type,data);};
  try {
    assert.equal((await jobs.stop(ids[0])).state,'stopping');
    const {ctx}=await h.begin(0,'run_command',{extra:true},task.task_id);
    await assert.rejects(jobs.start('node -e "process.exit(0)"',root,10000,'default',ctx),/running or stopping/);
    await h.complete(ctx,{error:'capacity rejected'},false);
  } finally {release();h.append=append;}
  for(let i=0;i<100;i++){const result=await jobs.read(ids[0],0);if(!['running','stopping'].includes(result.state)){assert.equal(result.state,'stopped');break;}await pause(100);}
  const {ctx}=await h.begin(0,'run_command',{after:true},task.task_id);
  const after=await jobs.start('node -e "process.exit(0)"',root,10000,'default',ctx);await h.complete(ctx,after,true);
  assert.ok(after.process_id);
});
