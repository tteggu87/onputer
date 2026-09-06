import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';

export const configSchema = z.object({
  roots: z.array(z.string().min(1)).min(1).max(32),
  skillRoots: z.array(z.string().min(1)).max(32).default([]),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(0).max(65535).default(8788),
  token: z.string().min(32),
  allowedHosts: z.array(z.string()).default(['localhost', '127.0.0.1', '[::1]']),
  allowedOrigins: z.array(z.string().url()).default([]),
  allowCommands: z.boolean().default(true),
});
export type Config = z.infer<typeof configSchema>;
export const expand = (p: string) => path.resolve(p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
export async function loadConfig(file: string): Promise<Config> {
  const c = configSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  c.roots = await Promise.all(c.roots.map(p => fs.realpath(expand(p))));
  c.skillRoots = c.skillRoots.map(expand);
  for (const root of c.roots) if (!(await fs.stat(root)).isDirectory()) throw new Error('Workspace root must be a directory');
  return c;
}
