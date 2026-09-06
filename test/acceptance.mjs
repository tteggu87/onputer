// Real launcher + HTTP client acceptance test. Uses only temporary workspaces/remotes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'onputer acceptance 한글 '));
const root = path.join(temp, 'work space');
const remote = path.join(temp, 'remote.git');
await fs.mkdir(root);
execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
const socket = net.createServer();
await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise(r => socket.close(r));
const token = randomBytes(32).toString('hex');
const configPath = path.join(temp, 'config.json');
await fs.writeFile(configPath, JSON.stringify({ roots: [root], port, token }));
let server, client;
const pause = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function passed(name) { checks++; console.log(`PASS ${name}`); }
async function boot() {
  server = spawn(process.execPath, [path.join(project, 'scripts/launch.mjs'), '--no-prompt'], { cwd: temp, env: { ...process.env, ONPUTER_CONFIG: configPath }, stdio: ['ignore','pipe','pipe'] });
  let log = ''; server.stdout.on('data', c => log += c); server.stderr.on('data', c => log += c);
  for (let i=0; i<500; i++) {
    if (server.exitCode !== null) throw new Error(`Launcher exited: ${log}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {}
    if (i === 499) throw new Error('Launcher startup timeout');
    await pause(100);
  }
  client = new Client({ name: 'acceptance', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
}
async function call(name, args={}) {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, JSON.stringify(r)); return r.structuredContent;
}
async function wait(id) {
  let last;
  for (let i=0; i<200; i++) { last = await call('read_process', { process_id: id }); if (!['running','stopping'].includes(last.state)) return last; await pause(100); }
  throw new Error('Command did not complete: ' + JSON.stringify(last));
}
async function command(text) {
  const start = await call('run_command', { command: text });
  const result = await wait(start.process_id);
  assert.equal(result.exit_code, 0, result.output); return result;
}
try {
  await boot();
  assert.equal((await client.listTools()).tools.length, 25);
  passed('launcher starts from unrelated cwd, authenticated MCP handshake, 25 tools');
  await call('write_file', { path: 'AGENTS.md', content: 'Run tests before committing.' });
  await call('write_file', { path: 'src/AGENTS.md', content: 'Keep Korean text unchanged.' });
  assert.equal((await call('read_instructions', { path: 'src/app.mjs' })).files.length, 2);
  passed('real workspace instruction chain');
  await call('write_file', { path: 'src/app.mjs', content: "console.log('안녕하세요');\n" });
  await command('node src/app.mjs');
  const read = await call('read_file', { path: 'src/app.mjs' });
  await call('edit_file', { path: 'src/app.mjs', expected_hash: read.sha256, old_text: '안녕하세요', new_text: '작업 완료' });
  assert.ok((await command('node src/app.mjs')).output.includes('작업 완료'));
  passed('create/read/edit and execute Korean file');
  const patch = [
    '--- a/src/app.mjs', '+++ b/src/app.mjs', '@@ -1 +1,2 @@',
    "-console.log('작업 완료');", "+import {answer} from './helper.mjs';", "+console.log('작업 완료', answer());",
    '--- /dev/null', '+++ b/src/helper.mjs', '@@ -0,0 +1 @@', '+export function answer() { return 7; }',
    '--- /dev/null', '+++ b/test/helper.test.mjs', '@@ -0,0 +1,3 @@',
    "+import assert from 'node:assert/strict';", "+import {answer} from '../src/helper.mjs';", '+assert.equal(answer(), 7);', ''
  ].join('\n');
  const beforePatch = await call('read_file', { path: 'src/app.mjs' });
  const preview = await call('apply_patch', { patch, expected_hashes: {'src/app.mjs': beforePatch.sha256}, dry_run: true });
  assert.equal(preview.applied, false);
  await assert.rejects(fs.stat(path.join(root, 'src/helper.mjs')), {code:'ENOENT'});
  assert.equal((await call('apply_patch', { patch, expected_hashes: {'src/app.mjs': beforePatch.sha256} })).files.length, 3);
  await command('node --test test/helper.test.mjs');
  assert.ok((await command('node src/app.mjs')).output.includes('작업 완료 7'));
  passed('MCP multi-file patch preview/application produces executable source and passing test');
  assert.ok((await call('inspect_project')).languages.includes('javascript'));
  assert.ok((await call('search_code', {query:'answer'})).matches.some(m=>m.path==='src/helper.mjs'));
  assert.ok((await call('search_code', {query:'answer',kind:'references'})).matches.some(m=>m.path==='src/app.mjs'));
  const impact = await call('analyze_changes', {paths:['src/helper.mjs']});
  assert.ok(impact.dependents.some(d=>d.path==='src/app.mjs'));
  assert.ok(impact.related_tests.some(t=>t.path==='test/helper.test.mjs'));
  passed('MCP project map, definition/reference search and change-to-test impact');

  await command('git init');
  await command('git config user.name OnputerTest');
  await command('git config user.email onputer-test@example.invalid');
  await command('git checkout -b acceptance');
  await command('git add AGENTS.md src test');
  await command('git commit -m acceptance');
  await command('git remote add origin "../remote.git"');
  await command('git push -u origin acceptance');
  const commit = execFileSync('git', ['rev-parse','HEAD'], { cwd: root, encoding:'utf8' }).trim();
  const pushed = execFileSync('git', ['rev-parse','refs/heads/acceptance'], { cwd: remote, encoding:'utf8' }).trim();
  assert.equal(commit, pushed);
  assert.ok(!(await call('git_changes')).status.includes('??'));
  passed('Git init/branch/add/commit/push to isolated local remote and verify commit hash');
  await call('write_file', { path: 'output.mjs', content: "process.stdout.write('x'.repeat(200000) + 'END');" });
  const big = await command('node output.mjs');
  assert.equal(big.output_lost, false);
  let page = big; let collected = page.output;
  while(page.has_more) { page = await call('read_process', { process_id: big.process_id, offset: page.next_offset }); collected += page.output; }
  assert.equal(collected.length, 200003); assert.ok(collected.endsWith('END'));
  passed('large output persisted without old memory-buffer loss, pagination, retained tail');
  await call('write_file', { path: 'heartbeat.mjs', content: "import fs from 'node:fs'; setInterval(()=>fs.appendFileSync('heartbeat.txt','x'),50);" });
  await call('write_file', { path: 'parent.mjs', content: "import {spawn} from 'node:child_process'; spawn(process.execPath,['heartbeat.mjs'],{stdio:'inherit'}); setInterval(()=>{},1000);" });
  const long = await call('run_command', { command: 'node parent.mjs' });
  for (let i=0; i<50; i++) { if (await fs.stat(path.join(root,'heartbeat.txt')).catch(()=>null)) break; await pause(100); }
  assert.ok((await fs.stat(path.join(root,'heartbeat.txt'))).size > 0);
  await call('stop_process', { process_id: long.process_id });
  await pause(1500);
  const size = (await fs.stat(path.join(root,'heartbeat.txt'))).size;
  await pause(500);
  assert.equal((await fs.stat(path.join(root,'heartbeat.txt'))).size, size);
  passed('stop_process actually stops child process heartbeat');
  const timeout = await call('run_command', { command: 'node parent.mjs', timeout_seconds: 1 });
  await pause(2500);
  assert.equal((await call('read_process', { process_id: timeout.process_id })).state,'timed_out');
  const stoppedSize = (await fs.stat(path.join(root,'heartbeat.txt'))).size;
  await pause(500);
  assert.equal((await fs.stat(path.join(root,'heartbeat.txt'))).size,stoppedSize);
  passed('timeout actually stops process tree');
  const bad = await fetch(`http://127.0.0.1:${port}/mcp`, { method:'POST', headers:{Authorization:'Bearer incorrect'} });
  assert.equal(bad.status,401);
  passed('incorrect token rejected');
  const tracked = await call('start_task', {title:'Tracked acceptance'});
  await call('write_file', {task_id:tracked.task_id,path:'once.mjs',content:"import fs from 'node:fs'; fs.appendFileSync('once-count.txt','x'); console.log('once');"});
  const onceArgs={task_id:tracked.task_id,idempotency_key:'one-logical-command',command:'node once.mjs'};
  const once=await call('run_command',onceArgs);
  const duplicate=await call('run_command',onceArgs);
  assert.equal(duplicate.process_id,once.process_id);assert.equal(duplicate.replayed,true);
  assert.equal((await wait(once.process_id)).exit_code,0);
  assert.equal(await fs.readFile(path.join(root,'once-count.txt'),'utf8'),'x');
  passed('MCP idempotency retry reuses original operation without repeating side effect');
  await call('read_instructions',{task_id:tracked.task_id,path:'src/app.mjs'});
  await call('read_instructions',{task_id:tracked.task_id,path:'src/app.mjs'});
  await call('write_file',{task_id:tracked.task_id,path:'history-file.txt',content:'before\n'});
  const observed=await call('read_file',{task_id:tracked.task_id,path:'history-file.txt'});
  await call('edit_file',{task_id:tracked.task_id,path:'history-file.txt',old_text:'before',new_text:'after',expected_hash:observed.sha256});
  await fs.writeFile(path.join(root,'history-file.txt'),'external current value');
  const receipt=await call('read_task',{task_id:tracked.task_id,limit:50});
  const changed=receipt.file_changes.findLast(c=>c.path==='history-file.txt');
  const diffArtifact=await call('read_artifact',{task_id:tracked.task_id,artifact_id:changed.diff_ref});
  assert.match(diffArtifact.content,/-before/);assert.match(diffArtifact.content,/\+after/);assert.ok(!diffArtifact.content.includes('external current value'));
  assert.equal(receipt.events.filter(e=>e.type==='context/provided'&&e.data.kind==='instructions').length,2);
  assert.ok((await call('list_processes')).processes.some(p=>p.process_id===once.process_id));
  await call('finish_task',{task_id:tracked.task_id,outcome:'completed',summary:'Verified scoped history, not a claim about unrelated tasks'});
  assert.ok((await call('list_tasks')).tasks.some(t=>t.task_id===tracked.task_id&&t.outcome_source==='client'));
  passed('MCP task grouping, instruction version dedup, historical diff and receipt');

  if (process.platform !== 'win32') {
    await client.close(); client = undefined;
    server.kill('SIGINT');
    await new Promise((resolve,reject) => { server.once('exit',code=>code===0?resolve():reject(new Error('shutdown failed'))); setTimeout(()=>reject(new Error('shutdown timeout')),5000).unref(); });
    passed('launcher Ctrl+C exits cleanly');
    await boot();
    assert.equal(JSON.parse(await fs.readFile(configPath,'utf8')).token,token);
    assert.ok((await call('read_file',{path:'src/app.mjs'})).content.includes('작업 완료'));
    passed('restart preserves token/config and workspace data');
    const savedProcess=await call('read_process',{process_id:once.process_id});
    assert.equal(savedProcess.state,'completed');assert.equal(savedProcess.live,false);assert.ok(savedProcess.output.includes('once'));
    assert.equal((await call('read_task',{task_id:tracked.task_id})).status,'completed');
    passed('task/process results survive a real server restart');
    await call('write_file',{path:'crash-once.mjs',content:"import fs from 'node:fs'; fs.appendFileSync('crash-count.txt','x'); setTimeout(()=>{},5000);"});
    const unfinished=await call('run_command',{command:'node crash-once.mjs'});
    for(let i=0;i<100;i++){if(await fs.stat(path.join(root,'crash-count.txt')).catch(()=>null))break;await pause(100);}
    assert.equal(await fs.readFile(path.join(root,'crash-count.txt'),'utf8'),'x');
    await client.close();client=undefined;
    const exited=new Promise(r=>server.once('exit',r));server.kill('SIGKILL');await exited;
    await boot();
    const unknown=await call('read_process',{process_id:unfinished.process_id});
    assert.equal(unknown.state,'unknown');assert.equal(unknown.live,false);
    assert.equal((await call('read_task',{task_id:unfinished.task_id})).status,'unknown');
    await pause(200);assert.equal(await fs.readFile(path.join(root,'crash-count.txt'),'utf8'),'x');
    passed('hard-crash stale-lock recovery marks unknown outcome without re-executing command');

  }
  console.log(`Acceptance complete: ${checks} scenarios passed on ${process.platform}`);
} finally {
  await client?.close().catch(()=>{});
  if (server && server.exitCode === null) {
    if (process.platform === 'win32') execFileSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore'});
    else server.kill('SIGINT');
    await Promise.race([new Promise(r=>server.once('exit',r)),pause(3000)]);
  }
  await fs.rm(temp,{recursive:true,force:true});
}
