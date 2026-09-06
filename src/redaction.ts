/** Best-effort masking for persisted diagnostics; never changes actual tool execution. */
export class Redactor {
  constructor(private readonly secret: string) {}
  text(value: string): string {
    return value.split(this.secret).join('[REDACTED]')
      .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
      .replace(/\b([A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|API_KEY)[A-Z0-9_]*\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/gi, '$1[REDACTED]');
  }
  value(value: unknown): unknown {
    if (typeof value === 'string') return this.text(value);
    if (Array.isArray(value)) return value.map(v => this.value(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, /^(authorization|password|secret|token|api[_-]?key|access[_-]?token)$/i.test(k) ? '[REDACTED]' : this.value(v)]));
    return value;
  }
  stream(): { push(text:string, end?:boolean):string } {
    let pending = '';
    // Retain a suffix so a configured token split across pipe chunks cannot leak.
    const keep = Math.max(this.secret.length + 64, 1024);
    return { push: (text, end=false) => {
      pending += text;
      if (end) { const out=this.text(pending);pending='';return out; }
      let cut=pending.lastIndexOf('\n')+1;
      if (!cut && pending.length > 64000 + keep) cut=pending.length-keep;
      if (!cut) return '';
      // Avoid splitting the known token across the retained boundary.
      for(let n=Math.min(this.secret.length-1,cut);n>0;n--) if(pending.slice(cut-n,cut)===this.secret.slice(0,n)){cut-=n;break;}
      const out=this.text(pending.slice(0,cut));pending=pending.slice(cut);return out;
    }};
  }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
