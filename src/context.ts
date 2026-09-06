import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolvePath, textFile, walk } from './files.js';

export async function instructions(root: string, target = '.') {
  const full = await resolvePath(root, target);
  let dir = full;
  try { if (!(await fs.stat(full)).isDirectory()) dir = path.dirname(full); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') dir = path.dirname(full); else throw e; }
  const relative = path.relative(root, dir);
  const dirs = [root];
  for (const part of relative.split(path.sep).filter(Boolean)) dirs.push(path.join(dirs.at(-1)!, part));
  const files = [];
  let total = 0;
  for (const directory of dirs) {
    const filename = path.relative(root, path.join(directory, 'AGENTS.md'));
    try {
      const content = await textFile(await resolvePath(root, filename));
      total += content.length;
      if (total > 100000) throw new Error('Instruction chain exceeds 100,000 characters; read AGENTS.md files individually');
      files.push({ path: filename, content });
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  return { target, files, guidance: 'Read these instructions before working. More specific directory instructions apply to their subtree; user instructions take precedence.' };
}
export type Skill = { id: string; name: string; description: string; directory: string; root: string };
export async function skills(root: string, extras: string[]): Promise<Skill[]> {
  const roots = [path.join(root, '.agents', 'skills'), path.join(root, '.codex', 'skills'), path.join(root, 'skills'), ...extras];
  const found: Skill[] = [];
  const seen = new Set<string>();
  for (const candidate of roots) {
    let base: string;
    try {
      if (!extras.includes(candidate)) await resolvePath(root, path.relative(root, candidate));
      if ((await fs.lstat(candidate)).isSymbolicLink()) continue;
      base = await fs.realpath(candidate);
    } catch (e) { if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) continue; throw e; }
    const inventory = await walk(base, '.', 4, 2000);
    const candidates = ['SKILL.md', ...inventory.entries.filter(e => path.basename(e.path) === 'SKILL.md').map(e => e.path)];
    for (const rel of candidates) {
      const file = await resolvePath(base, rel);
      if (seen.has(file)) continue;
      let body: string;
      try { body = await textFile(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
      seen.add(file);
      const field = (key: string) => body.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'))?.[1]?.replace(/^["']|["']$/g, '') ?? '';
      found.push({ id: createHash('sha256').update(file).digest('hex').slice(0, 16), name: field('name') || path.basename(path.dirname(file)), description: field('description').slice(0, 1000), directory: path.dirname(file), root: base });
      if (found.length >= 200) return found;
    }
  }
  return found;
}
