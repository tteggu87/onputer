import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parsePatch, applyPatch as patchText } from 'diff';
import { digest, FILE_LIMIT, locked, resolvePath, textFile } from './files.js';

type Snapshot = { content: string; mode: number } | null;
type Change = { path: string; absolute: string; before: Snapshot; after: string | null; mode?: number; temp?: string };
const portable = (p: string) => p.replaceAll('\\', '/');
function patchPath(raw: string | undefined, prefix: 'a/' | 'b/') {
  if (raw === '/dev/null') return null;
  if (!raw) throw new Error('Every patch needs --- and +++ paths (or Git rename headers)');
  const name = portable(raw.startsWith(prefix) ? raw.slice(2) : raw);
  if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f]/.test(name)) throw new Error('Patch paths must be workspace-relative without traversal');
  return name;
}
async function snapshot(file: string): Promise<Snapshot> {
  try { return { content: await textFile(file), mode: (await fs.stat(file)).mode }; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}

/** Validate the entire batch and serialize it with write_file/edit_file. Not crash-atomic across files. */
export async function applyWorkspacePatch(root: string, patch: string, expectedHashes: Record<string, string>, dryRun = false) {
  if (!patch.trim() || Buffer.byteLength(patch) > FILE_LIMIT) throw new Error('Patch must be nonempty and at most 1 MiB');
  if (/^(?:GIT binary patch|Binary files )/m.test(patch)) throw new Error('Binary patches are not supported');
  const parsed = parsePatch(patch);
  if (!parsed.length || parsed.length > 50) throw new Error('Patch must contain 1–50 files');
  return locked('file-writes', async () => {
    const changes: Change[] = [];
    const summary: object[] = [];
    const used = new Set<string>();
    let total = 0;
    for (const part of parsed) {
      if (part.isBinary || part.isCopy) throw new Error('Binary patches and copy headers are not supported');
      for (const mode of [part.oldMode, part.newMode]) if (mode && !['100644', '100755'].includes(mode)) throw new Error('Only regular text file modes are supported');
      const oldPath = part.isCreate ? null : patchPath(part.oldFileName, 'a/');
      const newPath = part.isDelete ? null : patchPath(part.newFileName, 'b/');
      if (!oldPath && !newPath) throw new Error('Patch has neither a source nor a destination');
      const paths = [...new Set([oldPath, newPath].filter((p): p is string => p !== null))];
      for (const name of paths) {
        const key = name.toLowerCase();
        if (used.has(key)) throw new Error('Duplicate or case-alias patch path: ' + name);
        for (const prev of used) if (prev.startsWith(key + '/') || key.startsWith(prev + '/')) throw new Error('Overlapping file/directory paths in one patch');
        used.add(key);
      }
      if (oldPath !== newPath && oldPath?.toLowerCase() === newPath?.toLowerCase()) throw new Error('Case-only renames require a separate intermediate move');
      const oldAbs = oldPath ? await resolvePath(root, oldPath) : null;
      const newAbs = newPath ? await resolvePath(root, newPath) : null;
      const before = oldAbs ? await snapshot(oldAbs) : null;
      if (oldPath && !before) throw new Error('Patch source does not exist: ' + oldPath);
      if (oldPath && expectedHashes[oldPath] !== digest(before!.content)) throw new Error('Missing or stale expected_hashes for ' + oldPath + '; use read_file first');
      if (newAbs && newAbs !== oldAbs && await snapshot(newAbs)) throw new Error('Patch destination already exists: ' + newPath);
      if (!part.hunks.length && oldPath === newPath && !part.newMode) throw new Error('Patch contains no changes');
      const after = part.hunks.length ? patchText(before?.content ?? '', part, { fuzzFactor: 0, autoConvertLineEndings: true }) : before?.content ?? '';
      if (after === false) throw new Error('Patch context does not match: ' + (oldPath ?? newPath));
      if (!newPath && after !== '') throw new Error('Deletion patch must remove the complete file');
      total += Buffer.byteLength(after) + Buffer.byteLength(before?.content ?? '');
      if (Buffer.byteLength(after) > FILE_LIMIT || total > 8 * FILE_LIMIT) throw new Error('Patched file exceeds 1 MiB or batch exceeds 8 MiB');
      if (oldAbs && oldPath !== newPath) changes.push({ path: oldPath!, absolute: oldAbs, before, after: null });
      if (newAbs) changes.push({ path: newPath!, absolute: newAbs, before: oldPath === newPath ? before : null, after, mode: part.newMode ? parseInt(part.newMode, 8) & 0o777 : before?.mode });
      summary.push({ path: newPath ?? oldPath, old_path: oldPath, action: !oldPath ? 'create' : !newPath ? 'delete' : oldPath !== newPath ? 'move' : 'update', sha256: newPath ? digest(after) : null,
        additions: part.hunks.reduce((n,h) => n + h.lines.filter(l => l.startsWith('+')).length, 0), deletions: part.hunks.reduce((n,h) => n + h.lines.filter(l => l.startsWith('-')).length, 0) });
    }
    if (dryRun) return { applied: false, dry_run: true, files: summary };
    const applied: Change[] = [];
    const createdDirs: string[] = [];
    try {
      for (const change of changes) {
        if (change.after === null) continue;
        const parent = path.dirname(change.absolute);
        const missing: string[] = [];
        for (let dir = parent; dir !== root; dir = path.dirname(dir)) {
          try { await fs.lstat(dir); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; missing.push(dir); }
        }
        await fs.mkdir(parent, { recursive: true }); createdDirs.push(...missing.reverse());
        await resolvePath(root, change.path);
        change.temp = path.join(parent, '.onputer-' + randomUUID() + '.tmp');
        await fs.writeFile(change.temp, change.after, { flag: 'wx', mode: change.mode });
        if (change.mode !== undefined && process.platform !== 'win32') await fs.chmod(change.temp, change.mode);
      }
      // Recheck every source after staging, before any workspace file is replaced.
      for (const change of changes) {
        await resolvePath(root, change.path);
        const now = await snapshot(change.absolute);
        if (now?.content !== change.before?.content) throw new Error('File changed while preparing patch: ' + change.path);
      }
      for (const change of changes) {
        await resolvePath(root, change.path);
        if (change.after === null) await fs.unlink(change.absolute);
        else await fs.rename(change.temp!, change.absolute);
        applied.push(change);
      }
    } catch (error) {
      const failed: string[] = [];
      for (const change of applied.reverse()) {
        try {
          await resolvePath(root, change.path);
          const now = await snapshot(change.absolute);
          if ((now?.content ?? null) !== change.after) throw new Error('External edit during rollback');
          if (!change.before) await fs.unlink(change.absolute);
          else { await fs.writeFile(change.absolute, change.before.content, { mode: change.before.mode }); if (process.platform !== 'win32') await fs.chmod(change.absolute, change.before.mode); }
        } catch { failed.push(change.path); }
      }
      if (failed.length) throw new Error('Patch failed and rollback needs manual review: ' + failed.join(', '));
      throw error;
    } finally {
      for (const change of changes) if (change.temp) await fs.rm(change.temp, { force: true }).catch(() => {});
      // Remove only directories created by this operation, and only when empty.
      for (const dir of createdDirs.reverse()) await fs.rmdir(dir).catch(() => {});
    }
    return { applied: true, dry_run: false, files: summary };
  });
}
