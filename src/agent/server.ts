// Local HTTP endpoint for the `vault` MCP server: 127.0.0.1 only, bearer token, POST /mcp with plain JSON replies.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Tool } from './tools.ts';
import { handleRpc } from './rpc.ts';

export const DEFAULT_PORT = 27124;
const MAX_BODY = 4 * 1024 * 1024;

export interface ServerOpts { tools: () => Tool[]; token: string; port?: number; tries?: number; version?: string }

function authorized(header: string | undefined, token: string) {
  const got = Buffer.from(String(header ?? '').replace(/^Bearer\s+/i, '')), want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

const send = (res: http.ServerResponse, status: number, body?: unknown) => {
  if (body === undefined) { res.writeHead(status).end(); return; }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
};

export function startServer(opts: ServerOpts): Promise<{ port: number; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/mcp') return send(res, 404, { error: 'Not found' });
    if (!authorized(req.headers.authorization, opts.token)) return send(res, 401, { error: 'Unauthorized' });
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return send(res, 405, { error: 'Use POST' }); }
    const chunks: Buffer[] = [];
    let size = 0, tooBig = false;
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { tooBig = true; req.destroy(); } else chunks.push(c); });
    req.on('end', async () => {
      if (tooBig) return;
      let msg: unknown;
      try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return send(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
      try {
        const reply = await handleRpc(msg, opts.tools(), opts.version);
        reply === null ? send(res, 202) : send(res, 200, reply);
      } catch (e: any) { send(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32603, message: e?.message ?? 'Internal error' } }); }
    });
    req.on('close', () => { if (tooBig && !res.headersSent) send(res, 413, { error: 'Request too large' }); });
  });

  const first = opts.port ?? DEFAULT_PORT, tries = opts.tries ?? 10;
  return new Promise((resolve, reject) => {
    const attempt = (port: number) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        if (e.code === 'EADDRINUSE' && port < first + tries) attempt(port + 1);
        else reject(e);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve({ port, close: () => new Promise<void>(r => { server.closeAllConnections?.(); server.close(() => r()); }) });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    };
    attempt(first);
  });
}
