// Replaces the Python backend: reads and writes the vault through Obsidian's own API.
import { FuzzySuggestModal, TFile, TFolder } from 'obsidian';
import type { App, TAbstractFile } from 'obsidian';
import { buildFolders, excerptOf } from './folders.ts';
import { resolveTheme } from './ui/theme.js';
import { fetchAll, friendly } from './canvas.ts';
import type { Http } from './canvas.ts';
import type { Note, Edge } from './folders.ts';
import type { ProposalQueue } from './agent/proposals.ts';

const STATUSES = ['todo', 'doing', 'done'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'];
const clean = (s: string) => s.replace(/[\\/:*?"<>|#^\[\]]/g, '').trim();
const linkpath = (l: string) => l.split('#')[0];
const hidden = (path: string) => path.split('/').some(p => p.startsWith('.'));
// shortcut: about 500k tokens of text; Claude itself refuses much more in one chat. Revisit if Claude's limit changes.
export const SHARE_MAX = 2 * 1024 * 1024;
const dstr = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

export interface NewTask { title: string; due?: string | null; status?: string; links?: string[]; details?: string; canvas_id?: string }

export interface Store { load: () => Promise<any>; save: (d: any) => Promise<void> }

export class VaultService {
  app: App;
  tasksFolder: string;
  store?: Store;
  http?: Http;                      // set by main.ts (Obsidian's requestUrl, which is not limited by browser CORS rules)
  canvasState = { items: [] as any[], courses: [] as any[], fetchedAt: 0, error: '', refreshing: false, lastTry: 0 };
  canvasRun: Promise<void> | null = null;
  onTheme?: (theme: any) => void;   // set by main.ts: mirrors theme changes onto the whole app
  queue?: ProposalQueue;            // set by main.ts on desktop: agent proposals waiting for the Review page
  rev = 0;
  excerpts = new Map<string, { m: number; t: string }>();

  constructor(app: App, tasksFolder = 'Tasks', store?: Store) { this.app = app; this.tasksFolder = tasksFolder; this.store = store; }

  /** Canvas: URL and token live in the plugin's data.json (Settings > NotionInVault Dashboard). */
  async canvasConfig() {
    const c = (await this.store?.load())?.canvas ?? {};
    const token = String(c.token ?? '').trim();
    let url = String(c.url ?? '').trim().replace(/\/+$/, '');
    if (!token || token === 'C_API_HERE' || !url) return null;       // the literal placeholder counts as "not filled in yet"
    if (!/^https?:/.test(url)) url = 'https://' + url;
    return { url, token };
  }
  /** What is saved, exactly as typed (even if only one of the two fields is filled in). Used by the settings tab. */
  async canvasRaw() {
    const c = (await this.store?.load())?.canvas ?? {};
    return { url: String(c.url ?? ''), token: String(c.token ?? '') };
  }
  async setCanvasConfig(url: string, token: string) {
    const data = (await this.store?.load()) ?? {};
    data.canvas = { url, token };
    await this.store?.save(data);
    this.canvasState = { items: [], courses: [], fetchedAt: 0, error: '', refreshing: false, lastTry: 0 };
  }
  async getCanvas(force = false) {
    const cfg = await this.canvasConfig(), s = this.canvasState;
    if (!cfg || !this.http) return { configured: false, items: [], courses: [], fetchedAt: 0, error: '', refreshing: false };
    const now = Date.now() / 1000;
    if (force || now - s.fetchedAt > 600 || (s.error && now - s.lastTry > 60)) {   // after a failure, retry within a minute
      if (!this.canvasRun) {
        s.refreshing = true; s.lastTry = now;
        this.canvasRun = fetchAll(cfg.url, cfg.token, this.http)
          .then(r => { Object.assign(s, { items: r.items, courses: r.courses, fetchedAt: Date.now() / 1000, error: '' }); })
          .catch(e => { s.error = friendly(e); })              // keep the last good data, show why the refresh failed
          .finally(() => { s.refreshing = false; this.canvasRun = null; });
      }
      if (force || !s.fetchedAt) await Promise.race([this.canvasRun, new Promise(r => setTimeout(r, force ? 30000 : 15000))]);
    }
    return { configured: true, ...s };
  }
  refreshCanvas() { return this.getCanvas(true); }

  /** Live theme changes from the editor. */
  previewTheme(theme: unknown) { this.onTheme?.(theme); }
  /** Changes theme fields from outside the dashboard (command, settings tab). */
  async patchTheme(patch: Record<string, unknown>) {
    const data = (await this.store?.load()) ?? {}, layout = data.layout ?? { version: 1 };
    layout.appearance = resolveTheme({ ...layout.appearance, ...patch });
    data.layout = layout;
    await this.store?.save(data);
    this.onTheme?.(layout.appearance);
    return layout.appearance;
  }

  /** Widget layout lives in the plugin's data.json. */
  async getLayout() { return { layout: (await this.store?.load())?.layout ?? null }; }
  async saveLayout(layout: unknown) {
    if (!this.store) return { ok: false };
    const data = (await this.store.load()) ?? {};
    data.layout = layout;
    await this.store.save(data);
    return { ok: true };
  }

  /** Called by main.ts on every vault / metadata event. The UI polls this number. */
  bump() { this.rev++; }
  version() { return { version: String(this.rev) }; }

  private files(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter(f => !hidden(f.path));
  }
  private file(path: string): TFile {
    const f = this.app.vault.getAbstractFileByPath(path) as TFile | null;
    if (!f || (f as TFile).extension !== 'md') throw new Error('Invalid note path');
    return f;
  }
  private async excerpt(f: TFile): Promise<string> {
    const hit = this.excerpts.get(f.path);
    if (hit && hit.m === f.stat.mtime) return hit.t;
    const t = excerptOf((await this.app.vault.cachedRead(f)).replace(/^---\n[\s\S]*?\n---\n?/, ''));
    this.excerpts.set(f.path, { m: f.stat.mtime, t });
    return t;
  }

  async index() {
    const mc = this.app.metadataCache, files = this.files(), known = new Set(files.map(f => f.path));
    const resolved = mc.resolvedLinks;   // Obsidian's own resolved link table (body and frontmatter links): no per-link lookups
    const excerpts = await Promise.all(files.map(f => this.excerpt(f)));   // cached by mtime; only changed notes are read
    const notes: Note[] = [], edgeSet = new Set<string>();
    files.forEach((f, i) => {
      const fm: any = mc.getFileCache(f)?.frontmatter ?? {};
      const targets = Object.keys(resolved[f.path] ?? {}).filter(t => t !== f.path && known.has(t));
      notes.push({
        path: f.path, title: f.basename, folder: f.parent && f.parent.path !== '/' ? f.parent.path : '',
        mtime: f.stat.mtime / 1000, type: String(fm.type ?? ''), status: String(fm.status ?? 'todo'),
        due: dstr(fm.due), order: Number(fm.order ?? 0) || 0, excerpt: excerpts[i],
        links: targets.sort(), deg: 0,
      });
      for (const t of targets) edgeSet.add(f.path + '\u0000' + t);
    });
    for (const p of this.excerpts.keys()) if (!known.has(p)) this.excerpts.delete(p);   // forget deleted and renamed notes
    const edges = [...edgeSet].sort().map(s => s.split('\u0000') as Edge);
    const deg = new Map<string, number>();
    for (const [a, b] of edges) { deg.set(a, (deg.get(a) ?? 0) + 1); deg.set(b, (deg.get(b) ?? 0) + 1); }
    for (const n of notes) n.deg = deg.get(n.path) ?? 0;
    return {
      vault: this.app.vault.getName(), tasks_folder: this.tasksFolder, notes,
      tasks: notes.filter(n => n.type === 'task').sort((a, b) => a.order - b.order),
      folders: buildFolders(notes, edges), edges,
    };
  }

  /** Wallpaper: a file called db_background.<ext> anywhere in the vault (the vault root wins). */
  private bgFiles(): TFile[] {
    return this.app.vault.getFiles()
      .filter(f => f.basename.toLowerCase() === 'db_background' && BG_EXT.includes(f.extension.toLowerCase()))
      .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  }
  getBackground() {
    const f = this.bgFiles()[0];
    return { background: f ? { name: f.name, url: this.app.vault.getResourcePath(f) } : null };
  }
  async setBackground(name: string, data: ArrayBuffer) {
    const ext = (name.includes('.') ? name.split('.').pop()! : '').toLowerCase();
    if (!BG_EXT.includes(ext)) throw new Error('Use a PNG, JPG, WebP, GIF, AVIF, BMP or SVG image');
    if (!data.byteLength) throw new Error('That file is empty');
    if (data.byteLength > 50 * 1024 * 1024) throw new Error('That image is larger than 50 MB');
    const path = `db_background.${ext}`, files = this.bgFiles(), same = files.find(f => f.path === path);
    for (const f of files) if (f !== same) await this.app.fileManager.trashFile(f);   // one wallpaper at a time
    if (same) await this.app.vault.modifyBinary(same, data);
    else await this.app.vault.createBinary(path, data);
  }
  async removeBackground() { for (const f of this.bgFiles()) await this.app.fileManager.trashFile(f); }

  /** A note or file dragged out of Obsidian into the AI box. `hint` is the text of the drag (an obsidian:// link, a [[link]] or a path);
      Obsidian's own record of what is being dragged is tried first. Returns null when it is not a vault file. */
  async dropped(hint: string) {
    const { vault, metadataCache } = this.app;
    const asFile = (x: any): TFile | null => (x && typeof x.path === 'string' && typeof x.extension === 'string' ? x as TFile : null);
    let f = asFile((this.app as any).dragManager?.draggable?.file);
    if (!f && hint) {
      let t = hint.trim().split(/\r?\n/)[0];
      const m = t.match(/^obsidian:\/\/open\?.*?[?&]file=([^&]+)/i);
      if (m) t = decodeURIComponent(m[1]);
      t = t.replace(/^!?\[\[|\]\]$/g, '').split('|')[0].split('#')[0];
      f = asFile(vault.getAbstractFileByPath(t)) || asFile(vault.getAbstractFileByPath(t + '.md')) || metadataCache.getFirstLinkpathDest(t, '');
    }
    if (!f) return null;
    const data = await vault.readBinary(f);
    return { name: f.name, path: f.path, data };
  }

  /** Claude page: Obsidian's own fuzzy picker over notes and folders ("Whole vault" first). Resolves null when dismissed. */
  async pickForClaude() {
    const app = this.app, root = app.vault.getRoot();
    const items: TAbstractFile[] = [root, ...app.vault.getAllLoadedFiles().filter(f =>
      !hidden(f.path) && ((f instanceof TFolder && !f.isRoot()) || (f instanceof TFile && f.extension === 'md')))];
    const chosen = await new Promise<TAbstractFile | null>(done => {
      let pick: TAbstractFile | null = null;
      const m = new (class extends FuzzySuggestModal<TAbstractFile> {
        getItems() { return items; }
        getItemText(f: TAbstractFile) { return f === root ? 'Whole vault' : f instanceof TFolder ? f.path + '/' : f.path; }
        onChooseItem(f: TAbstractFile) { pick = f; }
        onClose() { setTimeout(() => done(pick), 0); }   // Obsidian calls onChooseItem right after onClose
      })(app);
      m.setPlaceholder('Share a note or a folder with Claude');
      m.open();
    });
    return chosen ? this.bundle(chosen) : null;
  }

  /** One note as it is; a folder (or the whole vault) as one Markdown file, each note under a heading with its path. */
  async bundle(f: TAbstractFile, max = SHARE_MAX) {
    const { vault } = this.app;
    if (f instanceof TFile) return { name: f.name, data: await vault.readBinary(f), count: 1, skipped: 0 };
    const prefix = (f as TFolder).isRoot() ? '' : f.path + '/';
    const files = this.files().filter(x => x.path.startsWith(prefix)).sort((a, b) => a.path.localeCompare(b.path));
    const enc = new TextEncoder(), parts: string[] = [];
    let size = 0;
    for (const x of files) {
      const part = `# ${x.path}\n\n${(await vault.cachedRead(x)).trim()}\n\n`, n = enc.encode(part).length;
      if (size + n > max) break;   // the rest does not fit: the caller reports how many were left out
      parts.push(part); size += n;
    }
    const name = `${prefix ? f.name : vault.getName()} (${parts.length} notes).md`;
    return { name, data: enc.encode(parts.join('')).buffer as ArrayBuffer, count: parts.length, skipped: files.length - parts.length };
  }

  /** Opens Obsidian's own graph view in a tab (it cannot be embedded inside a custom view). */
  openGraph() { (this.app as any).commands.executeCommandById('graph:open'); }

  async note(path: string) {
    const text = await this.app.vault.cachedRead(this.file(path));
    return { content: text.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\n+/, '') };
  }

  async createTask(t: NewTask) {
    const title = clean(t.title ?? '');
    if (!title) throw new Error('Title is required');
    const links = [...new Set((t.links ?? []).map(clean))].filter(Boolean);
    const vault = this.app.vault, dir = this.tasksFolder;
    if (!vault.getAbstractFileByPath(dir)) await vault.createFolder(dir);
    let path = `${dir}/${title}.md`, i = 2;
    while (vault.getAbstractFileByPath(path)) path = `${dir}/${title} ${i++}.md`;
    const fm = ['---', 'type: task', `status: ${STATUSES.includes(t.status ?? '') ? t.status : 'todo'}`,
      `created: ${new Date().toLocaleDateString('en-CA')}`, `order: ${Math.floor(Date.now() / 1000)}`];
    if (t.due && DATE.test(t.due)) fm.push(`due: ${t.due}`);
    const cid = String(t.canvas_id ?? '').replace(/[^\w.:-]/g, '');
    if (cid) fm.push(`canvas_id: "${cid}"`);   // links a task made from a Canvas assignment back to it (agents use it to avoid duplicates)
    if (links.length) fm.push(`project: "[[${links[0]}]]"`, 'related:', ...links.map(l => `  - "[[${l}]]"`));
    fm.push('---');
    let body = `# ${title}\n\n`;
    if (t.details?.trim()) body += t.details.trim() + '\n\n';
    if (links.length) body += 'Related: ' + links.map(l => `[[${l}]]`).join(', ') + '\n';
    await vault.create(path, fm.join('\n') + '\n\n' + body);
    return { path };
  }

  private isTask(f: TFile) { return this.app.metadataCache.getFileCache(f)?.frontmatter?.type === 'task'; }

  async reorder(columns: Record<string, string[]>) {
    for (const [status, paths] of Object.entries(columns)) {
      if (!STATUSES.includes(status)) continue;
      for (let i = 0; i < paths.length; i++) {
        const f = this.file(paths[i]), fm: any = this.app.metadataCache.getFileCache(f)?.frontmatter;
        if (fm?.type !== 'task' || (fm.status === status && fm.order === i)) continue;
        await this.app.fileManager.processFrontMatter(f, (m: any) => { m.status = status; m.order = i; });
      }
    }
  }

  async update(u: { path: string; due?: string | null; add_link?: string | null; status?: string }) {
    const f = this.file(u.path);
    if (!this.isTask(f)) throw new Error('Only task notes can be edited here');
    if (u.due && !DATE.test(u.due)) throw new Error('Invalid date');
    if (u.status && !STATUSES.includes(u.status)) throw new Error('Invalid status');
    if (u.status) await this.app.fileManager.processFrontMatter(f, (m: any) => { m.status = u.status; });
    const link = u.add_link ? clean(u.add_link) : '', tag = `[[${link}]]`;
    let added = false;
    await this.app.fileManager.processFrontMatter(f, (m: any) => {
      if (u.due !== undefined && u.due !== null) { if (u.due) m.due = u.due; else delete m.due; }
      if (link) {
        const rel: string[] = Array.isArray(m.related) ? [...m.related] : [];
        if (!rel.includes(tag)) { rel.push(tag); m.related = rel; added = true; }
        m.project ??= tag;
      }
    });
    if (added) await this.app.vault.process(f, t => t.trimEnd() + `\n\nRelated: ${tag}\n`);
  }
}
