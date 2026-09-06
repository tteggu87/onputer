import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../dist/http.js';
import { configSchema } from '../dist/config.js';

const pause = ms => new Promise(r => setTimeout(r, ms));
test('Streamable HTTP: workspaces, instructions, skills, files, Git, processes and isolation', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'onputer 한글 space '));
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'onputer-other-'));
  await fs.mkdir(path.join(temp, 'src'), { recursive: true });
  await fs.mkdir(path.join(temp, '.agents/skills/example/references'), { recursive: true });
  await fs.writeFile(path.join(temp, 'AGENTS.md'), 'Root instruction');
  await fs.writeFile(path.join(temp, 'src/AGENTS.md'), 'Nested instruction');
  await fs.writeFile(path.join(temp, '.agents/skills/example/SKILL.md'), '---\nname: example\ndescription: Example task\n---\nRead references/guide.md');
  await fs.writeFile(path.join(temp, '.agents/skills/example/references/guide.md'), 'Reference proof');
  execFileSync('git', ['init'], { cwd: temp });
  const config = configSchema.parse({ roots: [temp, other], token: 'a'.repeat(64), allowedOrigins: ['https://trusted.example'] });
  const { app, jobs } = createApp(config);
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(r => listener.once('listening', r));
  const base = `http://127.0.0.1:${listener.address().port}`;
  const client = new Client({ name: 'test', version: '1.0' });
  t.after(async () => { await client.close(); jobs.close(); listener.closeAllConnections(); await new Promise(r => listener.close(r)); await pause(1200); await fs.rm(temp, { recursive: true, force: true }); await fs.rm(other, { recursive: true, force: true }); });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${config.token}` } } }));
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent;
  }
  const list = await client.listTools();
  assert.equal(list.tools.length, 15);
  assert.ok(list.tools.every(t => !t.name.includes('codex') && !t.name.includes('bash')));
  assert.equal((await call('server_status')).platform, process.platform);
  assert.equal((await call('list_workspaces')).workspaces.length, 2);
  const opened = await call('open_workspace');
  assert.equal(opened.instructions.files[0].content, 'Root instruction');
  const chain = await call('read_instructions', { path: 'src/new.ts' });
  assert.deepEqual(chain.files.map(f => f.content), ['Root instruction', 'Nested instruction']);
  const skill = (await call('list_skills')).skills[0];
  assert.equal((await call('read_skill', { skill_id: skill.id, file: 'references/guide.md' })).content, 'Reference proof');
  assert.ok((await client.callTool({ name: 'read_skill', arguments: { skill_id: skill.id, file: '../../AGENTS.md' } })).isError);
  const written = await call('write_file', { path: 'src/한글 file.txt', content: 'hello\r\nworld\r\n' });
  const read = await call('read_file', { path: 'src/한글 file.txt' });
  assert.equal(read.sha256, written.sha256);
  await call('edit_file', { path: 'src/한글 file.txt', old_text: 'world', new_text: 'computer', expected_hash: read.sha256 });
  assert.equal(await fs.readFile(path.join(temp, 'src/한글 file.txt'), 'utf8'), 'hello\r\ncomputer\r\n');
  assert.ok((await client.callTool({ name: 'write_file', arguments: { path: 'src/한글 file.txt', content: 'stale', expected_hash: read.sha256 } })).isError);
  const current = await call('read_file', { path: 'src/한글 file.txt' });
  const race = await Promise.all(['one','two'].map(content => client.callTool({ name: 'write_file', arguments: { path: 'src/한글 file.txt', content, expected_hash: current.sha256 } })));
  assert.equal(race.filter(r => r.isError).length, 1);
  const caseFile = await call('write_file', { path: 'Case.txt', content: 'original' });
  const aliasExists = await fs.stat(path.join(temp, 'case.txt')).then(() => true, () => false);
  if (aliasExists) {
    const aliasRace = await Promise.all(['Case.txt', 'case.txt'].map((file, i) => client.callTool({ name: 'write_file', arguments: { path: file, content: String(i), expected_hash: caseFile.sha256 } })));
    assert.equal(aliasRace.filter(r => r.isError).length, 1);
  }
  await fs.writeFile(path.join(temp, 'large.txt'), 'old\n'.repeat(60000));
  execFileSync('git', ['add', 'large.txt'], { cwd: temp });
  await fs.writeFile(path.join(temp, 'large.txt'), 'new\n'.repeat(60000));
  const largeDiff = await call('git_changes', { path: 'large.txt' });
  assert.equal(largeDiff.truncated, true);
  assert.ok(largeDiff.diff.startsWith('diff --git'));

  assert.ok((await call('list_files', { depth: 3 })).entries.some(e => e.path === 'src/한글 file.txt'));
  assert.ok((await call('search_files', { query: '한글', mode: 'name' })).matches.length);
  assert.ok((await call('search_files', { query: 'Root instruction' })).matches.length);
  assert.ok((await client.callTool({ name: 'read_file', arguments: { path: '../outside' } })).isError);
  assert.ok((await client.callTool({ name: 'write_file', arguments: { path: '.onputer/config.json', content: 'x' } })).isError);
  assert.ok((await client.callTool({ name: 'write_file', arguments: { path: '.env.local', content: 'x' } })).isError);
  await fs.symlink(other, path.join(temp, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok((await client.callTool({ name: 'write_file', arguments: { path: 'link/escape.txt', content: 'x' } })).isError);
  await call('write_file', { workspace: 1, path: 'separate.txt', content: 'second root' });
  assert.ok((await client.callTool({ name: 'read_file', arguments: { path: 'separate.txt' } })).isError);
  assert.ok((await call('git_changes')).status.includes('AGENTS.md'));
  const windows = process.platform === 'win32';
  const command = windows ? "Write-Output '안녕하세요'; node -e \"process.exit(0)\"" : "printf '안녕하세요'; node -e 'process.exit(0)'";
  const job = await call('run_command', { command });
  let result;
  for (let n=0; n<100; n++) { result = await call('read_process', { process_id: job.process_id }); if (result.state !== 'running') break; await pause(100); }
  assert.equal(result.state, 'completed'); assert.equal(result.exit_code, 0); assert.ok(result.output.includes('안녕하세요'));
  const fail = await call('run_command', { command: windows ? 'node -e "process.exit(7)" # trailing comment' : 'node -e "process.exit(7)"' });
  for (let n=0; n<100; n++) { result = await call('read_process', { process_id: fail.process_id }); if (result.state !== 'running') break; await pause(100); }
  assert.equal(result.exit_code, 7);
  const long = await call('run_command', { command: 'node -e "setInterval(()=>{},1000)"' });
  await pause(1000);
  assert.equal((await call('stop_process', { process_id: long.process_id })).state, 'stopped');
  const timed = await call('run_command', { command: 'node -e "setInterval(()=>{},1000)"', timeout_seconds: 1 });
  await pause(1500);
  assert.equal((await call('read_process', { process_id: timed.process_id })).state, 'timed_out');
  if (windows) {
    const cmd = await call('run_command', { command: 'echo cmd-ok', shell: 'cmd' });
    await pause(1000);
    assert.match((await call('read_process', { process_id: cmd.process_id })).output, /cmd-ok/);
  }
  assert.equal((await fetch(base + '/mcp', { method: 'POST' })).status, 401);
  assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, Origin: 'https://evil.example' } })).status, 403);
  const badHost = await new Promise((resolve, reject) => { const req = http.get(base + '/health', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  assert.equal(badHost, 403);
  assert.equal((await fetch(base + '/mcp', { headers: { Authorization: `Bearer ${config.token}` } })).status, 405);
  assert.equal((await fetch(base + '/mcp', { method: 'OPTIONS', headers: { Origin: 'https://trusted.example' } })).status, 204);
  const urlClient = new Client({ name: 'url-test', version: '1' });
  await urlClient.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp/' + config.token)));
  assert.equal((await urlClient.listTools()).tools.length, 15);
  await urlClient.close();
});
