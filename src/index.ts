import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createApp } from './http.js';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const config = await loadConfig(process.env.ONPUTER_CONFIG || path.join(project, '.onputer', 'config.json'));
  const { app, ready, close: closeRuntime } = createApp(config);
  await ready;
  const server = app.listen(config.port, config.host, () => {
    console.log(`onputer ready at http://${config.host}:${config.port}/mcp`);
    console.log('Connection details: .onputer/connection.txt | Stop: Ctrl+C');
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; void closeRuntime(); });
  let closing = false;
  const close = () => {
    if(closing)return;closing=true;server.close();server.closeAllConnections();
    void closeRuntime().catch(error=>{console.error(String(error));process.exitCode=1;});
  };
  process.on('SIGINT', close); process.on('SIGTERM', close);
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
