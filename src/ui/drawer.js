import { $, $$, esc, obs, md, longDay, today } from './util.js';
import { S, hooks } from './state.js';
import { api } from './api.js';

let cur = null;   // { kind: 'note' | 'folder', id }
const none = '<p class="empty">None yet</p>';
const refs = a => a.length ? `<div class="chips">${a.map(x => `<span class="chip link" data-go="${esc(x.path)}" title="${esc(x.path)}"><span class="ell">${esc(x.title)}</span>${x.n > 1 ? `<em>${x.n}</em>` : ''}</span>`).join('')}</div>` : none;

function shell(html) {
  const d = $('#drawer');
  d.innerHTML = `<button class="x" id="dx" aria-label="Close">×</button>${html}`;
  d.classList.add('open');
  $('#dx').onclick = () => { d.classList.remove('open'); cur = null; };
  $$('[data-go]', d).forEach(e => e.onclick = () => openNote(e.dataset.go));
}
export const refreshDrawer = () => { if (cur) (cur.kind === 'folder' ? openFolder : cur.kind === 'canvas' ? openCanvas : openNote)(cur.id); };

/* A Canvas assignment (read-only). */
export function openCanvas(id) {
  const c = S.canvas.items.find(x => x.id === id); if (!c) return;
  cur = { kind: 'canvas', id };
  const status = c.status === 'done' ? (c.score != null ? `Graded: ${c.score}${c.points ? ' / ' + c.points : ''}` : 'Submitted')
    : c.missing ? 'Missing' : c.due < today() ? 'Not submitted (past due)' : 'Not submitted yet';
  shell(`<h4>Title</h4><h2>${esc(c.title)}</h2>
    <h4>Course</h4><p>${esc(c.course)}</p>
    <h4>Due</h4><p>${esc(longDay(c.due))} at ${esc(c.time)}</p>
    <h4>Status</h4><p>${esc(status)}${c.late ? ' (late)' : ''}</p>
    <h4>Type</h4><p>${esc(c.kind)}${c.points ? `, ${c.points} points` : ''}</p>
    ${c.url ? `<a class="btn" href="${esc(c.url)}" target="_blank" rel="noopener">Open in Canvas</a>` : ''}
    <p class="tp-hint">Canvas items are read-only here. Submit your work in Canvas.</p>`);
}

// Title, Folder located, Links to, Linked from, Summary
export function openFolder(id) {
  const f = S.folders[id]; if (!f) return;
  cur = { kind: 'folder', id };
  shell(`<h4>Title</h4><h2>${esc(f.name)}</h2>
    <h4>Folder located</h4><p>${esc(f.located)}</p>
    <h4>Links to</h4>${refs(f.links_to)}
    <h4>Linked from</h4>${refs(f.linked_from)}
    <h4>Summary</h4><p>${esc(f.summary)}</p>`);
}

export function openNote(path) {
  const n = S.by[path]; if (!n) return;
  cur = { kind: 'note', id: path };
  const out = n.links.map(p => ({ path: p, title: S.by[p].title })), back = S.data.edges.filter(e => e[1] === path).map(e => ({ path: e[0], title: S.by[e[0]].title }));
  const task = n.type === 'task';
  shell(`<h4>Title</h4><h2>${esc(n.title)}</h2>
    <a class="btn" href="${obs(S.data.vault, path)}">Open in Obsidian</a>
    ${task ? `<h4>Due date</h4><input type="date" id="dd" value="${esc(n.due)}">
      <h4>Connect to a note</h4><input list="titles" id="dl" placeholder="Type a note name, press Enter">` : ''}
    <h4>Folder located</h4><p>${esc(n.folder ? n.folder.split('/').join(' / ') : 'Vault root')}</p>
    <h4>Links to</h4>${refs(out)}
    <h4>Linked from</h4>${refs(back)}
    ${task ? '<h4>Details</h4><div class="prose" id="dbody" style="padding:0"></div>' : `<h4>Summary</h4><p>${esc(n.excerpt) || '<span class="empty">No text yet</span>'}</p>`}`);
  if (task) {
    $('#dd').onchange = async e => { await api('/api/tasks/update', { path, due: e.target.value }); hooks.reload(); };
    $('#dl').onkeydown = async e => { if (e.key === 'Enter' && e.target.value.trim()) { await api('/api/tasks/update', { path, add_link: e.target.value.trim() }); hooks.reload(); } };
    api('/api/note?path=' + encodeURIComponent(path)).then(r => { if (cur?.id === path && $('#dbody')) $('#dbody').innerHTML = md(r.content.replace(/^\s*# .*\n+/, '')); });
  }
}
