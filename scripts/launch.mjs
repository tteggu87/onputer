import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { manageWorkspaces } from './workspaces.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} needs a value`);
  return args[i + 1];
};
async function runNpm(action) {
  // Fixed command only. User paths are passed as cwd, never interpolated into shell text.
  const child = process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${action}`], { cwd: project, stdio: 'inherit' })
    : spawn('npm', action.split(' '), { cwd: project, stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`npm ${action} failed (${code})`)));
  });
}
try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Install Node.js 22 or newer from https://nodejs.org and run this launcher again.');
  const configFile = process.env.ONPUTER_CONFIG || path.join(project, '.onputer', 'config.json');
  await fs.mkdir(path.dirname(configFile), { recursive: true });
  let config;
  try { config = JSON.parse(await fs.readFile(configFile, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const selected = option('--root');
  const firstRun = !config;
  if (!config) config = { roots: [path.resolve(selected || project)], skillRoots: [], host: '127.0.0.1', port: 8788, token: randomBytes(32).toString('hex'), allowedHosts: ['localhost', '127.0.0.1', '[::1]'], allowedOrigins: [], allowCommands: true };
  else if (selected) config.roots = [path.resolve(selected)];
  const interactive = !args.includes('--no-prompt') && (process.stdin.isTTY || args.includes('--workspaces')) && (!selected || args.includes('--workspaces'));
  if (interactive) {
    const selection = await manageWorkspaces(config.roots, {firstRun: firstRun && !selected});
    if (!selection.start) { console.log('시작을 취소했습니다. 저장된 설정은 변경하지 않았습니다.'); process.exit(0); }
    config.roots = selection.roots;
  }
  const port = option('--port');
  if (port !== undefined) config.port = Number(port);
  for (const root of config.roots) if (!(await fs.stat(root)).isDirectory()) throw new Error(`Not a directory: ${root}`);
  await fs.writeFile(configFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(configFile, 0o600);
  const lock = await fs.readFile(path.join(project, 'package-lock.json'), 'utf8');
  const stampPath = path.join(project, 'node_modules', '.onputer-lock');
  const stamp = await fs.readFile(stampPath, 'utf8').catch(() => '');
  if (stamp !== lock) { console.log('Installing locked dependencies...'); await runNpm('ci --ignore-scripts'); await fs.writeFile(stampPath, lock); }
  console.log('Building onputer...');
  await runNpm('run build');
  // Validate with the same schema as the server, before claiming setup succeeded.
  const { loadConfig } = await import('../dist/config.js');
  config = await loadConfig(configFile);
  const url = `http://${config.host}:${config.port}/mcp`;
  const connection = `onputer connection\n\nServer URL: ${url}\n\nBearer token (paste only this value into the token field):\n${config.token}\n\nAuthorization header (for custom headers):\nAuthorization: Bearer ${config.token}\n\nFor clients that only accept a URL (keep it private):\n${url}/${config.token}\n\nA remote web service needs an HTTPS tunnel to this local port.\nAdd the public hostname to allowedHosts in config.json and restart.\nReplace the local origin above with that HTTPS origin.\nNever share connection.txt or config.json.\n`;
  const connectionFile = path.join(path.dirname(configFile), 'connection.txt');
  await fs.writeFile(connectionFile, connection, { mode: 0o600 });
  await fs.chmod(connectionFile, 0o600);
  console.log(`Workspace: ${config.roots.join(', ')}`);
  console.log(`Private connection details: ${connectionFile}`);
  console.log(`\n${connection}`);
  if (!args.includes('--setup-only')) {
    process.env.ONPUTER_CONFIG = configFile;
    await import('../dist/index.js');
  }
} catch (error) { console.error(`onputer: ${error.message}`); process.exitCode = 1; }
