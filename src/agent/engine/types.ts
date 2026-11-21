// Shared types for running agents on an AI engine (Claude Code or Gemini CLI). Pure: no Obsidian or Node imports.
export type EngineName = 'claude' | 'gemini';
export const ENGINE_LABEL: Record<EngineName, string> = { claude: 'Claude', gemini: 'Gemini' };

export interface AgentDef { name: string; description: string; engine: EngineName; model?: string; geminiModel?: string; body: string; path: string; warning?: string }

export type ChatEvent =
  | { type: 'start'; sessionId: string; engine: EngineName; model: string; toolsOk: boolean }
  | { type: 'delta'; text: string }
  | { type: 'message'; text: string }
  | { type: 'tool'; name: string; status: 'call' | 'ok' | 'error'; text?: string; id?: string }
  | { type: 'denied'; tool: string }
  | { type: 'done'; costUsd?: number }
  | { type: 'error'; message: string };

export interface ChildLike {
  stdin: { write(s: string): void; end(): void };
  stdout: { on(e: 'data', f: (d: any) => void): void };
  stderr: { on(e: 'data', f: (d: any) => void): void };
  on(e: 'exit', f: (code: number | null) => void): void;
  on(e: 'error', f: (err: Error) => void): void;
  kill(): void;
}
/** `env` is added to the inherited environment. The real spawner kills the whole process tree on kill(). */
export type Spawner = (cmd: string, args: string[], opts: { cwd: string; env?: Record<string, string> }) => ChildLike;
