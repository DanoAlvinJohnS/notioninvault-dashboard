// VaultPort over Obsidian's API and VaultService. Only this file (and main.ts) knows about Obsidian; everything else is pure.
import { TFile, getAllTags } from 'obsidian';
import type { App } from 'obsidian';
import type { VaultService } from '../service.ts';
import type { VaultPort, MapNote, MapFile, CanvasEntry } from './types.ts';
import { isExcluded } from './vaultmap.ts';

const FM = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export class ObsidianPort implements VaultPort {
  app: App; svc: VaultService;
  constructor(app: App, svc: VaultService) { this.app = app; this.svc = svc; }

  private file(path: string): TFile {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error('No such file: ' + path);
    return f;
  }
  private async ensureFolder(folder: string) {
    if (!folder || this.app.vault.getAbstractFileByPath(folder)) return;
    await this.ensureFolder(parentOf(folder));
    await this.app.vault.createFolder(folder);
  }

  /** The vault index, built once per vault change (svc.rev) instead of on every tool call. */
  private memo: { rev: number; p: Promise<{ notes: MapNote[]; edges: [string, string][] }> } | null = null;
  private snapshot() {
    if (!this.memo || this.memo.rev !== this.svc.rev) {
      const p = this.build(), memo = { rev: this.svc.rev, p };
      this.memo = memo;
      p.catch(() => { if (this.memo === memo) this.memo = null; });
    }
    return this.memo.p;
  }
  private async build() {
    const { notes, edges } = await this.svc.index();
    return { edges: edges as [string, string][], notes: notes.map(n => {
      const f = this.app.vault.getAbstractFileByPath(n.path), cache = f instanceof TFile ? this.app.metadataCache.getFileCache(f) : null;
      const tags = cache ? [...new Set(getAllTags(cache) ?? [])] : [];
      return { path: n.path, title: n.title, folder: n.folder, type: n.type, status: n.status, due: n.due, links: n.links, deg: n.deg, excerpt: n.excerpt, tags, mtime: n.mtime };
    }) };
  }
  async notes(): Promise<MapNote[]> { return (await this.snapshot()).notes; }
  async files(): Promise<MapFile[]> {
    return this.app.vault.getFiles().filter(f => f.extension !== 'md' && !isExcluded(f.path))
      .map(f => ({ path: f.path, ext: f.extension, size: f.stat.size, mtime: f.stat.mtime / 1000 }));
  }
  async edges() { return (await this.snapshot()).edges; }
  async read(path: string) { return this.app.vault.read(this.file(path)); }   // exact disk content: the stale check depends on it
  async readFast(path: string) { return this.app.vault.cachedRead(this.file(path)); }
  exists(path: string) { return !!this.app.vault.getAbstractFileByPath(path); }

  async canvas(daysAhead: number): Promise<CanvasEntry[]> {
    const c = await this.svc.getCanvas();
    const today = new Date().toLocaleDateString('en-CA'), until = new Date(Date.now() + daysAhead * 864e5).toLocaleDateString('en-CA');
    return (c.items ?? []).filter((i: any) => i.due >= today && i.due <= until)
      .map((i: any) => ({ id: i.id, title: i.title, due: `${i.due} ${i.time}`.trim(), course: i.course, status: i.status }));
  }

  async createTask(t: Parameters<VaultPort['createTask']>[0]) { return this.svc.createTask(t); }
  async updateTask(u: Parameters<VaultPort['updateTask']>[0]) { await this.svc.update(u); }
  async writeBody(path: string, body: string) { await this.app.vault.process(this.file(path), t => (t.match(FM)?.[0] ?? '') + body); }
  async write(path: string, text: string) { await this.app.vault.modify(this.file(path), text); }
  async create(path: string, text: string) { await this.ensureFolder(parentOf(path)); await this.app.vault.create(path, text); }
  async rename(path: string, newPath: string) { await this.ensureFolder(parentOf(newPath)); await this.app.fileManager.renameFile(this.file(path), newPath); }
  async trash(path: string) { await this.app.fileManager.trashFile(this.file(path)); }
}
