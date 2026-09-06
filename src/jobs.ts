import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

const OUTPUT_LIMIT = 128000;
interface Job {
  id: string; child: ChildProcess; output: string; base: number; state: string;
  exitCode: number | null; started: number; timer?: NodeJS.Timeout; escalation?: NodeJS.Timeout;
}
export class Jobs {
  private jobs = new Map<string, Job>();
  start(command: string, cwd: string, timeout: number, shell: 'default' | 'powershell' | 'cmd' = 'default') {
    if ([...this.jobs.values()].filter(j => j.state === 'running').length >= 8) throw new Error('Eight commands are already running; stop or wait for one');
    for (const [id,j] of this.jobs) if (this.jobs.size >= 64 && j.state !== 'running') this.jobs.delete(id);
    const windows = process.platform === 'win32';
    if (!windows && shell !== 'default') throw new Error('powershell and cmd shell options are only available on Windows');
    let executable: string;
    let args: string[];
    if (windows && shell !== 'cmd') {
      executable = 'powershell.exe';
      const prefix = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; ";
      args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(prefix + "$global:LASTEXITCODE = 0; " + command + "\n$onputerSuccess = $?; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; if (-not $onputerSuccess) { exit 1 }", 'utf16le').toString('base64')];
    } else if (windows) {
      executable = process.env.ComSpec || 'cmd.exe'; args = ['/d', '/s', '/c', command];
    } else {
      executable = process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh'; args = ['-c', command];
    }
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('ONPUTER_')) delete env[key];
    const child = spawn(executable, args, { cwd, env, detached: !windows, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const job: Job = { id: randomUUID(), child, output: '', base: 0, state: 'running', exitCode: null, started: Date.now() };
    this.jobs.set(job.id, job);
    const append = (text: string) => {
      job.output += text;
      if (job.output.length > OUTPUT_LIMIT) { const removed = job.output.length - OUTPUT_LIMIT; job.output = job.output.slice(removed); job.base += removed; }
    };
    for (const stream of [child.stdout!, child.stderr!]) {
      const decoder = new StringDecoder('utf8');
      stream.on('data', data => append(decoder.write(data)));
      stream.on('end', () => append(decoder.end()));
    }
    child.on('error', e => { append(e.message); job.state = 'failed'; clearTimeout(job.timer); });
    child.on('close', code => {
      job.exitCode = code;
      if (job.state === 'running') job.state = code === 0 ? 'completed' : 'failed';
      clearTimeout(job.timer);
    });
    job.timer = setTimeout(() => { if (job.state === 'running') { job.state = 'timed_out'; this.kill(job); } }, timeout);
    job.timer.unref();
    return this.read(job.id, 0);
  }
  private kill(job: Job) {
    if (!job.child.pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(job.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => job.child.kill());
    } else {
      try { process.kill(-job.child.pid, 'SIGTERM'); } catch { /* already exited */ }
      job.escalation = setTimeout(() => { try { process.kill(-job.child.pid!, 'SIGKILL'); } catch { /* already exited */ } }, 1000);
      job.escalation.unref();
    }
  }
  read(id: string, offset: number) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown or expired process_id; jobs are lost when the server restarts');
    const start = Math.max(offset, job.base);
    const output = job.output.slice(start - job.base, start - job.base + 16000);
    return { process_id: id, state: job.state, exit_code: job.exitCode, output, next_offset: start + output.length, output_lost: offset < job.base, has_more: start + output.length < job.base + job.output.length };
  }
  stop(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown process_id');
    if (job.state === 'running') { job.state = 'stopped'; this.kill(job); }
    return this.read(id, 0);
  }
  close() { for (const job of this.jobs.values()) if (job.state === 'running') { job.state = 'stopped'; this.kill(job); } }
}
