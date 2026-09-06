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
  for (let i=0; i<200; i++) {
    if (server.exitCode !== null) throw new Error(`Launcher exited: ${log}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {}
    if (i === 199) throw new Error('Launcher startup timeout');
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
  for (let i=0; i<200; i++) { last = await call('read_process', { process_id: id }); if (last.state !== 'running') return last; await pause(100); }
  throw new Error('Command did not complete: ' + JSON.stringify(last));
}
async function command(text) {
  const start = await call('run_command', { command: text });
  const result = await wait(start.process_id);
  assert.equal(result.exit_code, 0, result.output); return result;
}
try {
  await boot();
  assert.equal((await client.listTools()).tools.length, 15);
  passed('launcher starts from unrelated cwd, authenticated MCP handshake, 15 tools');
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
  await command('git init');
  await command('git config user.name OnputerTest');
  await command('git config user.email onputer-test@example.invalid');
  await command('git checkout -b acceptance');
  await command('git add AGENTS.md src');
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
  assert.equal(big.output_lost, true);
  let page = big; let collected = page.output;
  while(page.has_more) { page = await call('read_process', { process_id: big.process_id, offset: page.next_offset }); collected += page.output; }
  assert.equal(collected.length, 128000); assert.ok(collected.endsWith('END'));
  passed('large output cap, lost-output flag, pagination, retained tail');
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
  if (process.platform !== 'win32') {
    await client.close(); client = undefined;
    server.kill('SIGINT');
    await new Promise((resolve,reject) => { server.once('exit',code=>code===0?resolve():reject(new Error('shutdown failed'))); setTimeout(()=>reject(new Error('shutdown timeout')),5000).unref(); });
    passed('launcher Ctrl+C exits cleanly');
    await boot();
    assert.equal(JSON.parse(await fs.readFile(configPath,'utf8')).token,token);
    assert.ok((await call('read_file',{path:'src/app.mjs'})).content.includes('작업 완료'));
    passed('restart preserves token/config and workspace data');
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
