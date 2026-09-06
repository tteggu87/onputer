import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const FILE_LIMIT = 1024 * 1024;
const skipped = new Set(['.git', 'node_modules', '.onputer', '.ssh', '.aws', '.azure', '.gnupg', 'dist', 'build', '.next', '__pycache__']);
export function blocked(name: string): boolean {
  const n = name.toLowerCase();
  return skipped.has(n) || n === '.env' || n.startsWith('.env.') || /\.(pem|key|p12|pfx)$/.test(n);
}
export function within(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
}
export async function resolvePath(root: string, input = '.'): Promise<string> {
  const target = path.resolve(root, input);
  if (!within(root, target)) throw new Error('Path is outside this workspace');
  const parts = path.relative(root, target).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    if (blocked(part) || (process.platform === 'win32' && /[:]|[. ]$/.test(part))) throw new Error('Blocked path component: ' + part);
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symbolic links and junctions are not supported');
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  return target;
}
export async function textFile(file: string): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > FILE_LIMIT) throw new Error('Expected a text file of at most 1 MiB');
    const buffer = Buffer.alloc(FILE_LIMIT + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > FILE_LIMIT) throw new Error('File exceeds 1 MiB');
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) throw new Error('Binary files are not supported');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { await handle.close(); }
}
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const locks = new Map<string, Promise<void>>();
export async function locked<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(file) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(r => { release = r; });
  locks.set(file, next);
  await previous;
  try { return await fn(); } finally { release(); if (locks.get(file) === next) locks.delete(file); }
}
export async function saveText(root: string, input: string, content: string, expectedHash?: string) {
  const file = await resolvePath(root, input);
  if (Buffer.byteLength(content) > FILE_LIMIT) throw new Error('Content exceeds 1 MiB');
  return locked(root.toLowerCase(), async () => {
    let old: string | undefined;
    try { old = await textFile(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (old !== undefined && !expectedHash) throw new Error('Existing file: read_file first and provide expected_hash');
    if (expectedHash && (old === undefined || digest(old) !== expectedHash)) throw new Error('File changed. Read it again before writing');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await resolvePath(root, input);
    const temp = path.join(path.dirname(file), '.onputer-' + randomUUID() + '.tmp');
    try {
      const mode = old === undefined ? undefined : (await fs.stat(file)).mode;
      await fs.writeFile(temp, content, { flag: 'wx', mode });
      await fs.rename(temp, file);
    } finally { await fs.rm(temp, { force: true }); }
    return { path: input, sha256: digest(content), bytes: Buffer.byteLength(content), created: old === undefined };
  });
}
export async function walk(root: string, input: string, depth: number, cap = 5000) {
  const base = await resolvePath(root, input);
  const entries: {path: string; type: string}[] = [];
  let truncated = false;
  async function visit(dir: string, level: number): Promise<void> {
    const iterator = await fs.opendir(dir);
    for await (const entry of iterator) {
      if (blocked(entry.name) || entry.isSymbolicLink()) continue;
      if (entries.length >= cap) { truncated = true; break; }
      const full = path.join(dir, entry.name);
      entries.push({ path: path.relative(root, full).split(path.sep).join('/'), type: entry.isDirectory() ? 'directory' : 'file' });
      if (entry.isDirectory() && level < depth) await visit(full, level + 1);
      if (truncated) break;
    }
  }
  await visit(base, 1);
  return { entries: entries.sort((a,b) => a.path.localeCompare(b.path)), truncated };
}
