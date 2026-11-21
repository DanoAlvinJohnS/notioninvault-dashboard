// Shared types for the vault agent tools. Pure: no Obsidian imports, so node --test can load every module that uses them.
export interface MapNote { path: string; title: string; folder: string; type: string; status: string; due: string; links: string[]; deg: number; excerpt: string; tags: string[]; mtime: number }
export interface MapFile { path: string; ext: string; size: number; mtime: number }
export type ProposalKind = 'task' | 'task_update' | 'edit' | 'link' | 'move' | 'rename' | 'delete' | 'create_note';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'stale' | 'failed';
export interface Proposal { id: string; kind: ProposalKind; agent: string; reason: string; created: number; status: ProposalStatus; args: Record<string, any>; base?: string; note?: string; error?: string; decided?: number }
export interface CanvasEntry { id: string; title: string; due: string; course: string; status: string }
export interface VaultPort {
  notes(): Promise<MapNote[]>;
  files(): Promise<MapFile[]>;
  edges(): Promise<[string, string][]>;
  /** Whole file text, frontmatter included. */
  read(path: string): Promise<string>;
  /** Optional faster read from Obsidian's cache, for search and reading only (approvals always use read()). */
  readFast?(path: string): Promise<string>;
  exists(path: string): boolean;
  canvas(daysAhead: number): Promise<CanvasEntry[]>;
  createTask(t: { title: string; due?: string; status?: string; links?: string[]; details?: string; canvas_id?: string }): Promise<{ path: string }>;
  updateTask(u: { path: string; status?: string; due?: string; add_link?: string }): Promise<void>;
  /** Replaces the body and keeps the frontmatter. */
  writeBody(path: string, body: string): Promise<void>;
  write(path: string, text: string): Promise<void>;
  create(path: string, text: string): Promise<void>;
  rename(path: string, newPath: string): Promise<void>;
  trash(path: string): Promise<void>;
}
