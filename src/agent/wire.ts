// Desktop only: starts the `vault` MCP server, keeps .mcp.json pointing at it, writes the agent setup files, and owns the review queue.
import { Notice } from 'obsidian';
import type { Plugin } from 'obsidian';
import type { VaultService } from '../service.ts';
import type { Proposal } from './types.ts';
import { ObsidianPort } from './port.ts';
import { ProposalQueue } from './proposals.ts';
import { makeTools } from './tools.ts';
import { mergeMcpJson, setupPlan } from './setup.ts';
import { hooks } from '../ui/state.js';
import type { sharedData } from './datastore.ts';
import type { AgentDef, EngineName, Spawner } from './engine/types.ts';
import type { Engine } from './engine/engines.ts';
import { ClaudeEngine, GeminiEngine } from './engine/engines.ts';
import { listAgents } from './engine/agents.ts';
import { vaultMcpConfig, mergeGeminiSettings } from './engine/args.ts';
import { MSG } from './engine/events.ts';

type SharedData = ReturnType<typeof sharedData>;

const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');

export interface EngineSettings { defaultEngine: EngineName; geminiModel: string; claudePath: string; geminiScript: string; showSpark: boolean; randomQuotes: boolean; quoteEvery: 'often' | 'normal' | 'rare'; spark?: { mode: 'roam' | 'sit' | 'sleep'; x: number; y?: number; outline?: 'white' | 'black' | 'orange' | 'none' } }
export const ENGINE_DEFAULTS = (): EngineSettings => ({
  showSpark: true, randomQuotes: true, quoteEvery: 'normal', defaultEngine: 'claude', geminiModel: 'gemini-3.5-flash',
  claudePath: winPath(process.env.USERPROFILE ?? '', '.local', 'bin', 'claude.exe'),
  geminiScript: winPath(process.env.APPDATA ?? '', 'npm', 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js'),
});
const winPath = (...parts: string[]) => parts.join('\\');

export interface Agents {
  queue: ProposalQueue; port: number | null; stop(): Promise<void>;
  /** Called with the pending count on every queue change. Returns the unsubscribe function. */
  onPending(fn: (n: number) => void): () => void;
  /** Every agent file in .claude/agents/, with its engine resolved against the default. */
  catalog(): Promise<AgentDef[]>;
  makeEngine(agent: AgentDef): Promise<Engine>;
  settings(): Promise<EngineSettings>;
  saveSettings(patch: Partial<EngineSettings>): Promise<void>;
}

export async function startAgents(plugin: Plugin, svc: VaultService, data: SharedData): Promise<Agents> {
  // data.json is shared with the layout and Canvas settings; `data.agent` changes only the `agent` key, under one lock with the dashboard.
  const token: string = await data.agent(a => (a.token ??= hex(32)));

  const port = new ObsidianPort(plugin.app, svc);
  const queue = new ProposalQueue(port,
    () => data.readAgent(a => structuredClone(a.proposals ?? []) as Proposal[]),   // reading never rewrites data.json
    async list => { await data.agent(a => { a.proposals = list; }); });
  svc.queue = queue;

  let last = 0, lastNotice = 0;
  const listeners = new Set<(n: number) => void>();
  queue.onChange = n => {
    hooks.reviewChanged?.(n);
    for (const f of [...listeners]) { try { f(n); } catch (e) { console.error('[vault-dashboard]', e); } }
    if (n > last && Date.now() - lastNotice > 10_000) { lastNotice = Date.now(); new Notice(`${n} change${n > 1 ? 's' : ''} need${n > 1 ? '' : 's'} your OK — open the Review page`); }
    last = n;
  };
  last = (await queue.list('pending')).length;

  const adapter = plugin.app.vault.adapter;
  let server: { port: number; close(): Promise<void> } | null = null;
  try {
    const { startServer } = await import('./server.ts');   // node:http is only loaded on desktop, and only here
    server = await startServer({ tools: () => makeTools(port, queue), token, version: plugin.manifest.version });

    const old = (await adapter.exists('.mcp.json')) ? await adapter.read('.mcp.json') : null;
    if (old !== null) { try { JSON.parse(old); } catch { await adapter.write('.mcp.json.bak', old); } }
    const next = mergeMcpJson(old, server.port, token);
    if (next !== old) await adapter.write('.mcp.json', next);

    const have = new Set<string>();
    for (const p of ['CLAUDE.md', '.claude/settings.json', '.claude/agents/secretary.md', '.claude/agent-template.md']) if (await adapter.exists(p)) have.add(p);
    for (const f of setupPlan(p => have.has(p))) {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
      if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
      await adapter.write(f.path, f.text);
    }

    // Engine configs: Claude gets the server through --mcp-config; Gemini reads <vault>/.gemini/settings.json.
    await adapter.write('.claude/vault-mcp.json', vaultMcpConfig(server.port, token));
    if (!(await adapter.exists('.gemini'))) await adapter.mkdir('.gemini');
    const oldG = (await adapter.exists('.gemini/settings.json')) ? await adapter.read('.gemini/settings.json') : null;
    if (oldG !== null) { try { JSON.parse(oldG); } catch { await adapter.write('.gemini/settings.json.bak', oldG); } }
    const nextG = mergeGeminiSettings(oldG, server.port, token);
    if (nextG !== oldG) await adapter.write('.gemini/settings.json', nextG);
  } catch (e: any) {
    console.error('[vault-dashboard] agent server', e);
    new Notice(`Vault agents could not start: ${e?.message ?? e}`);
  }

  const base = (adapter as any).getBasePath?.() as string ?? '';
  const settings = async (): Promise<EngineSettings> => ({ ...ENGINE_DEFAULTS(), ...(await data.readAgent(a => a.settings ?? {})) });   // read-only
  let spawner: Spawner | null = null;
  const getSpawner = async (): Promise<Spawner> => {
    if (spawner) return spawner;
    return spawner = (await import('./spawn.ts')).realSpawner;   // desktop only, loaded on first use (see spawn.ts)
  };
  const preflight = () => (server ? null : MSG.vault);

  return {
    queue, port: server?.port ?? null,
    onPending(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async stop() { await server?.close(); },
    settings,
    async saveSettings(patch) { await data.agent(a => { a.settings = { ...(a.settings ?? {}), ...patch }; }); },
    async catalog() {
      const s = await settings(), dir = '.claude/agents';
      if (!(await adapter.exists(dir))) return [];
      const files = (await adapter.list(dir)).files.filter(f => f.toLowerCase().endsWith('.md'));
      return listAgents(await Promise.all(files.map(async path => ({ path, text: await adapter.read(path) }))), s.defaultEngine);
    },
    async makeEngine(agent) {
      const s = await settings(), spawn = await getSpawner();
      if (agent.engine === 'gemini')
        return new GeminiEngine({ spawn, node: 'node', script: s.geminiScript, cwd: base, agent, model: s.geminiModel, newId: () => crypto.randomUUID(), preflight });
      return new ClaudeEngine({ spawn, exe: s.claudePath, cwd: base, agent, mcpConfigPath: winPath(base, '.claude', 'vault-mcp.json'), preflight });
    },
  };
}
