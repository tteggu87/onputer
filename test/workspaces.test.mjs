import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {editWorkspaces} from '../scripts/workspaces.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'onputer workspace 한글 '));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const folders=await Promise.all(['first','second space','third'].map(async name=>{const p=path.join(root,name);await fs.mkdir(p);return fs.realpath(p);}));
  return {root,folders};
}
async function menu(roots,answers,options={}) {const lines=[];let index=0;const result=await editWorkspaces(roots,async()=>answers[index++],s=>lines.push(s),options);return {result,lines};}

test('existing workspaces support add, change and unregister without deleting folders',async t=>{
  const {folders:[a,b,c]}=await fixture(t);const original=[a];
  const {result,lines}=await menu(original,['A',`"${b}"`,'E','0',c,'R','1','']);
  assert.equal(result.start,true);assert.deepEqual(result.roots,[c]);assert.deepEqual(original,[a]);
  assert.ok(lines.some(s=>s.includes('[0]')));assert.ok((await fs.stat(b)).isDirectory());
});
test('invalid paths, duplicates and removal of the final workspace preserve the list',async t=>{
  const {root,folders:[a]}=await fixture(t);const file=path.join(root,'file.txt');await fs.writeFile(file,'keep');
  const {result,lines}=await menu([a],['A',path.join(root,'missing'),'A',file,'A',a,'R','0','E','9','']);
  assert.deepEqual(result.roots,[a]);assert.ok(lines.some(s=>s.includes('폴더를 찾을 수 없습니다')));assert.ok(lines.some(s=>s.includes('이미 [0]')));assert.ok(lines.some(s=>s.includes('최소 하나')));
});
test('quit and EOF discard drafts; missing saved roots can be repaired before starting',async t=>{
  const {root,folders:[a,b]}=await fixture(t);
  assert.deepEqual((await menu([a],['A',b,'Q'])).result,{start:false,roots:[a]});
  assert.equal((await menu([a],[])).result.start,false);
  const {result,lines}=await menu([path.join(root,'missing')],['','E','0',b,'']);
  assert.deepEqual(result.roots,[b]);assert.ok(lines.some(s=>s.includes('현재 접근 불가')));
});
test('first-run folder question retries invalid input before presenting the management menu',async t=>{
  const {root,folders:[a,b]}=await fixture(t);
  const {result}=await menu([a],[path.join(root,'missing'),b,''],{firstRun:true});
  assert.deepEqual(result,{start:true,roots:[b]});
});
test('actual launcher reopens workspace management with saved config and preserves credentials',async t=>{
  const {root,folders:[a,b]}=await fixture(t);
  const configFile=path.join(root,'config.json');const token='workspace-menu-fixture-token-only-'.repeat(2);
  const original={roots:[a],token,port:8911,allowedHosts:['localhost','127.0.0.1','custom.example'],historyRetentionDays:17};
  await fs.writeFile(configFile,JSON.stringify(original));
  const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  async function launch(input,extra=[]) {
    const child=spawn(process.execPath,[path.join(project,'scripts/launch.mjs'),'--setup-only','--workspaces',...extra],{cwd:project,env:{...process.env,ONPUTER_CONFIG:configFile},stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.stdin.end(input);
    const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Launcher timed out'));},30000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',c=>{clearTimeout(timer);resolve(c);});});
    assert.equal(code,0,output);return output;
  }
  const output=await launch(`A\n"${b}"\n\n`);
  assert.ok(output.includes('등록된 워크스페이스'));assert.ok(output.includes('Bearer token'));
  assert.deepEqual(JSON.parse(await fs.readFile(configFile,'utf8')),{...original,roots:[a,b]});
  await launch('R\n1\nQ\n');
  assert.deepEqual(JSON.parse(await fs.readFile(configFile,'utf8')).roots,[a,b]);
  const automated=await launch('', ['--no-prompt']);
  assert.ok(!automated.includes('선택: '));
  assert.deepEqual(JSON.parse(await fs.readFile(configFile,'utf8')).roots,[a,b]);
});
