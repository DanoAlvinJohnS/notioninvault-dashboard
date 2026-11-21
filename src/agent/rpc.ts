// Minimal MCP over JSON-RPC 2.0: just what Claude Code needs to list and call the vault tools.
import type { Tool } from './tools.ts';

const err = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export async function handleRpc(msg: any, tools: Tool[], version = '0.0.0'): Promise<any | null> {
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map(m => handleRpc(m, tools, version)))).filter(r => r !== null);
    return out.length ? out : null;
  }
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(msg?.id, -32600, 'Invalid request');
  const isNotification = !('id' in msg);
  const ok = (result: unknown) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize':
      return ok({ protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'vault', version } });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const tool = tools.find(t => t.name === msg.params?.name);
      if (!tool) return isNotification ? null : err(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
      try { return ok({ content: [{ type: 'text', text: await tool.run(msg.params?.arguments ?? {}) }] }); }
      catch (e: any) { return ok({ content: [{ type: 'text', text: e?.message ?? String(e) }], isError: true }); }
    }
    default:
      return isNotification ? null : err(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
