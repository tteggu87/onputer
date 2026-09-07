import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createTools, type ToolLifecycle } from './tools.js';
import { Jobs } from './jobs.js';
import { History } from './history.js';
import type { Config } from './config.js';

export function createApp(config: Config) {
  const app = express();
  const history = new History(config);
  const jobs = new Jobs(history);
  const ready = history.ready;
  const lifecycle:ToolLifecycle={accepting:true,pending:new Set()};
  void ready.catch(()=>{});
  app.disable('x-powered-by');
  app.use(async (req, res, next) => {
    if(!lifecycle.accepting){res.status(503).json({error:'Server is shutting down'});return;}
    try { await ready; } catch { res.status(503).json({error:'History initialization failed; inspect server logs'}); return; }
    res.setHeader('Cache-Control', 'no-store');
    let host: string;
    try { host = new URL('http://' + req.headers.host).hostname; } catch { res.sendStatus(403); return; }
    if (!config.allowedHosts.includes(host)) { res.status(403).json({ error: 'Host is not allowed. Add its hostname to allowedHosts in local config.' }); return; }
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) { res.status(403).json({ error: 'Origin is not allowed' }); return; }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Accept');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    if (req.path === '/health') { res.json({ name: 'onputer', status: 'ok' }); return; }
    // Match the route's optional trailing slash without treating it as token data.
    const tokenSegment = /^\/mcp\/([^/]+)\/?$/.exec(req.path)?.[1];
    let pathToken = '';
    if (tokenSegment) { try { pathToken = decodeURIComponent(tokenSegment); } catch { /* malformed token encoding stays unauthenticated */ } }
    const supplied = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : pathToken;
    const expected = Buffer.from(config.token);
    const actual = Buffer.from(supplied);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) { res.status(401).json({ error: 'Supply Authorization: Bearer <token> or use the private /mcp/<token> URL' }); return; }
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.all(['/mcp', '/mcp/:token'], async (req, res) => {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.sendStatus(405); return; }
    const server = createTools(config, jobs, history, lifecycle);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' }); }
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (error as {status?: number})?.status;
    res.status(status === 413 ? 413 : 400).json({ error: 'Invalid or oversized request' });
  });
  let closing:Promise<void>|undefined;
  const close=()=>closing??=(async()=>{lifecycle.accepting=false;await Promise.all([...lifecycle.pending]);try{await jobs.close();}finally{await history.close();}})();
  return { app, jobs, history, ready, close };
}
