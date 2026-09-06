import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Config } from './config.js';
import { resolvePath, textFile, digest, saveText, walk } from './files.js';
import { instructions, skills } from './context.js';
import { Jobs } from './jobs.js';
import { applyWorkspacePatch } from './patch.js';
import { inspectProject, searchCode, analyzeChanges } from './analysis.js';

const exec = promisify(execFile);
const workspace = z.number().int().min(0).default(0).describe('Workspace id from list_workspaces. Default: 0.');
const filePath = z.string().min(1).max(4096).describe('Path relative to the workspace. Windows and POSIX paths are supported on their respective OS.');
export function createTools(config: Config, jobs: Jobs) {
  const server = new McpServer({ name: 'onputer', version: '0.2.0' }, { instructions: 'Start with open_workspace. Read AGENTS.md instructions for each target path and relevant skills before editing. Use inspect_project/search_code for code orientation and analyze_changes for impact. Use expected_hash from read_file for edits, and expected_hashes for multi-file apply_patch. Commands run as the local OS user. Check process exit_code and git_changes before reporting success.' });
  const root = (id: number) => { const value = config.roots[id]; if (!value) throw new Error('Unknown workspace id; call list_workspaces'); return value; };
  function tool<S extends z.ZodRawShape>(name: string, description: string, inputSchema: S, readOnly: boolean, handler: (a: z.infer<z.ZodObject<S>>) => Promise<object> | object, openWorld = false) {
    server.registerTool<z.ZodRawShape, z.ZodRawShape>(name, { title: name.replaceAll('_', ' '), description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: openWorld } }, async args => {
      try {
        const output = await handler(args as z.infer<z.ZodObject<S>>);
        return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output as Record<string, unknown> };
      } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }; }
    });
  }
  tool('server_status', 'Show server OS, default shell and enabled capabilities. No tokens are returned.', {}, true, () => ({ version: '0.2.0', platform: process.platform, default_shell: process.platform === 'win32' ? 'powershell' : process.platform === 'darwin' ? 'zsh' : 'sh', commands_enabled: config.allowCommands, workspace_count: config.roots.length }));
  tool('list_workspaces', 'List configured workspace ids and paths. Workspaces are explicitly configured on the server.', {}, true, () => ({ workspaces: config.roots.map((p,id) => ({ id, path: p })) }));
  tool('open_workspace', 'Start here: return workspace instructions and skill summaries. Does not change another chat’s workspace; pass workspace on later calls.', { workspace }, true, async a => ({ workspace: a.workspace, root: root(a.workspace), instructions: await instructions(root(a.workspace)), skills: (await skills(root(a.workspace), config.skillRoots)).map(({id,name,description}) => ({id,name,description})) }));
  tool('read_instructions', 'Read the AGENTS.md chain from workspace root through the target directory. Use before working on a new target path.', { workspace, path: filePath.default('.') }, true, a => instructions(root(a.workspace), a.path));
  tool('list_files', 'List files recursively to a bounded depth. Excludes links, dependency/build directories and secret paths. Paginate using offset.', { workspace, path: filePath.default('.'), depth: z.number().int().min(1).max(12).default(2), offset: z.number().int().min(0).max(5000).default(0), limit: z.number().int().min(1).max(500).default(100) }, true, async a => {
    const result = await walk(root(a.workspace), a.path, a.depth);
    const entries = result.entries.slice(a.offset, a.offset + a.limit);
    return { entries, next_offset: a.offset + entries.length, has_more: a.offset + entries.length < result.entries.length, scan_truncated: result.truncated };
  });
  tool('read_file', 'Read a UTF-8 file with line numbers and a full-file sha256 for safe edits. Files up to 1 MiB; paginate by start_line.', { workspace, path: filePath, start_line: z.number().int().min(1).default(1), max_lines: z.number().int().min(1).max(1000).default(200) }, true, async a => {
    const content = await textFile(await resolvePath(root(a.workspace), a.path));
    const lines = content.split('\n');
    const selected: string[] = []; let chars = 0;
    for (let i = a.start_line - 1; i < Math.min(lines.length, a.start_line - 1 + a.max_lines); i++) {
      if (lines[i].length > 30000) throw new Error('A line exceeds 30,000 characters; use a local command to inspect this file');
      if (chars + lines[i].length > 32000) break;
      selected.push(`${i + 1}: ${lines[i]}`); chars += lines[i].length;
    }
    return { path: a.path, sha256: digest(content), total_lines: lines.length, content: selected.join('\n'), next_line: a.start_line + selected.length, has_more: a.start_line + selected.length <= lines.length };
  });
  tool('search_files', 'Search literal text or file names without requiring ripgrep. Bounded scan; narrow path when scan_truncated is true.', { workspace, path: filePath.default('.'), query: z.string().min(1).max(500), mode: z.enum(['content', 'name']).default('content'), case_sensitive: z.boolean().default(false), offset: z.number().int().min(0).max(5000).default(0), limit: z.number().int().min(1).max(200).default(50) }, true, async a => {
    const inventory = await walk(root(a.workspace), a.path, 12, 5000);
    const results: object[] = []; let bytes = 0; let truncated = inventory.truncated; let skipped = 0;
    const norm = (s: string) => a.case_sensitive ? s : s.toLowerCase();
    for (const item of inventory.entries) {
      if (a.mode === 'name') { if (norm(item.path).includes(norm(a.query))) results.push(item); }
      else if (item.type === 'file') {
        let content: string;
        try { content = await textFile(await resolvePath(root(a.workspace), item.path)); } catch { skipped++; continue; }
        bytes += Buffer.byteLength(content);
        if (bytes > 16 * 1024 * 1024) { truncated = true; break; }
        for (const [i,line] of content.split('\n').entries()) {
          if (norm(line).includes(norm(a.query))) results.push({ path: item.path, line: i + 1, text: line.slice(0, 500) });
          if (results.length >= a.offset + a.limit + 1) break;
        }
      }
      if (results.length >= a.offset + a.limit + 1) { truncated = true; break; }
    }
    return { matches: results.slice(a.offset, a.offset + a.limit), has_more: results.length > a.offset + a.limit, next_offset: a.offset + Math.min(a.limit, Math.max(0, results.length - a.offset)), scan_truncated: truncated, skipped_files: skipped };
  });
  tool('inspect_project', 'Build a bounded local project map: languages, manifests, conventional entrypoints, areas and symbol preview. JS/TS use syntax trees; other languages use heuristics. No project code is executed. Paginate files with offset.', { workspace, offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(100) }, true, a => inspectProject(root(a.workspace), a.offset, a.limit));
  tool('search_code', 'Find symbol definitions or identifier occurrences with source positions. References are candidates, not semantic bindings; same names may be unrelated. Use search_files for plain text or unsupported syntax.', { workspace, query: z.string().min(1).max(200), kind: z.enum(['definitions','references']).default('definitions'), exact: z.boolean().default(true), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(50) }, true, a => searchCode(root(a.workspace), a.query, a.kind, a.offset, a.limit, a.exact));
  tool('analyze_changes', 'Inspect potential impact via reverse imports, related tests and declared verification scripts. Uses explicit paths for planned work, otherwise Git unstaged+untracked or staged paths. Analysis uses working-tree contents. Does not execute tests or certify safety.', { workspace, paths: z.array(filePath).min(1).max(1000).optional(), staged: z.boolean().default(false) }, true, a => analyzeChanges(root(a.workspace), a.paths, a.staged));
  tool('apply_patch', 'Apply a multi-file unified diff (--- a/path, +++ b/path, @@ hunks). Supports text creation, update, deletion (/dev/null) and rename. Existing source paths require expected_hashes from read_file. Entire batch is validated first; dry_run previews without writing. UTF-8 only; preserves CRLF. No Git installation required.', { workspace, patch: z.string().min(1).max(1048576), expected_hashes: z.record(z.string().length(64)).default({}).describe('Map workspace-relative old paths without a/ prefix to read_file sha256 values, including deletions and renames.'), dry_run: z.boolean().default(false) }, false, a => applyWorkspacePatch(root(a.workspace), a.patch, a.expected_hashes, a.dry_run));
  tool('write_file', 'Create a UTF-8 file or replace it. Existing files require expected_hash from read_file. Parent directories are created.', { workspace, path: filePath, content: z.string().max(1048576), expected_hash: z.string().length(64).optional() }, false, a => saveText(root(a.workspace), a.path, a.content, a.expected_hash));
  tool('edit_file', 'Replace one exact occurrence in a UTF-8 file. Rejects ambiguous matches and stale expected_hash. Preserve original line endings in old_text/new_text.', { workspace, path: filePath, old_text: z.string().min(1).max(1048576), new_text: z.string().max(1048576), expected_hash: z.string().length(64) }, false, async a => {
    const current = await textFile(await resolvePath(root(a.workspace), a.path));
    if (digest(current) !== a.expected_hash) throw new Error('File changed; read_file again');
    const first = current.indexOf(a.old_text);
    if (first < 0 || current.indexOf(a.old_text, first + 1) >= 0) throw new Error('old_text must match exactly once; include more surrounding text');
    return saveText(root(a.workspace), a.path, current.slice(0, first) + a.new_text + current.slice(first + a.old_text.length), a.expected_hash);
  });
  tool('list_skills', 'Discover workspace skills and explicitly configured external skill folders. Lists names/descriptions; load only the relevant skill.', { workspace }, true, async a => ({ skills: (await skills(root(a.workspace), config.skillRoots)).map(({id,name,description}) => ({id,name,description})), limit: 200 }));
  tool('read_skill', 'Read SKILL.md or a referenced file inside a discovered skill directory. Does not execute the skill. Supports bounded text paging.', { workspace, skill_id: z.string(), file: filePath.default('SKILL.md'), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(30000).default(20000) }, true, async a => {
    const skill = (await skills(root(a.workspace), config.skillRoots)).find(s => s.id === a.skill_id);
    if (!skill) throw new Error('Unknown skill id; call list_skills');
    const body = await textFile(await resolvePath(skill.directory, a.file));
    return { name: skill.name, directory: skill.directory, file: a.file, content: body.slice(a.offset, a.offset + a.limit), next_offset: Math.min(body.length, a.offset + a.limit), has_more: a.offset + a.limit < body.length };
  });
  tool('git_changes', 'Return Git status and staged/unstaged diff. Git commit, branch, fetch and push use run_command. Requires Git installed.', { workspace, staged: z.boolean().default(false), path: filePath.optional() }, true, async a => {
    const cwd = root(a.workspace);
    if (a.path) await resolvePath(cwd, a.path);
    const options = { cwd, maxBuffer: 256000, timeout: 15000, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } };
    const status = await exec('git', ['--no-pager','status','--short','--branch'], options);
    const args = ['--no-pager','diff','--no-ext-diff','--no-textconv', ...(a.staged ? ['--cached'] : []), '--', ...(a.path ? [a.path] : [])];
    let output: string; let overflow = false;
    try { output = (await exec('git', args, options)).stdout; }
    catch (error) {
      const e = error as { code?: string; stdout?: string };
      if (e.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || typeof e.stdout !== 'string') throw error;
      output = e.stdout; overflow = true;
    }
    return { status: status.stdout, diff: output.slice(0, 40000), truncated: overflow || output.length > 40000, staged: a.staged };
  });
  if (config.allowCommands) {
    tool('run_command', 'Run a noninteractive command as the OS user (not sandboxed). Windows defaults to PowerShell; macOS to zsh. Returns process_id immediately. Use read_process until completion. Only run user-authorized actions.', { workspace, command: z.string().min(1).max(32000), cwd: filePath.default('.'), shell: z.enum(['default','powershell','cmd']).default('default'), timeout_seconds: z.number().int().min(1).max(86400).default(600) }, false, async a => {
      const cwd = await resolvePath(root(a.workspace), a.cwd);
      if (!(await fs.stat(cwd)).isDirectory()) throw new Error('cwd must be a directory');
      return jobs.start(a.command, cwd, a.timeout_seconds * 1000, a.shell);
    }, true);
    tool('read_process', 'Read bounded command output from offset. Poll until state is completed/failed/timed_out/stopped and check exit_code. Output buffers retain the last 128,000 characters.', { process_id: z.string(), offset: z.number().int().min(0).default(0) }, true, a => jobs.read(a.process_id, a.offset));
    tool('stop_process', 'Stop a running command and its process tree. Jobs belong to this server owner and are shared across authenticated chats.', { process_id: z.string() }, false, a => jobs.stop(a.process_id));
  }
  return server;
}
