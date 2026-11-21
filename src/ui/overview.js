import { $, $$, esc, fmt, today } from './util.js';
import { S, hooks } from './state.js';
import { api } from './api.js';
import { createCalendar, newCalState } from './calendar.js';
import { drawGraph } from './graph.js';

const calState = newCalState();   // lives across re-renders so the month you browse is kept

export function overview() {
  const d = S.data, td = today(), open = d.tasks.filter(t => t.status !== 'done');
  const late = open.filter(t => t.due && t.due < td).length, orphans = d.notes.filter(n => !n.deg).length;
  const due = open.filter(t => t.due).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6);
  const hubs = [...d.notes].sort((a, b) => b.deg - a.deg).slice(0, 6), max = hubs[0]?.deg || 1;
  const cards = d.folders.filter(f => f.parent === null);

  $('#main').innerHTML = `
  <h2>${esc(d.vault)}</h2><p class="sub">Everything in your vault at a glance.</p>
  <div class="stats">
    <div><b>${d.notes.length}</b><span>notes</span></div>
    <div><b>${d.edges.length}</b><span>connections</span></div>
    <div><b>${open.length}</b><span>open tasks</span></div>
    <div><b style="color:${late ? 'var(--r)' : 'inherit'}">${late}</b><span>overdue</span></div>
    <div><b>${orphans}</b><span>notes with no links</span></div>
  </div>
  <div class="ov">
    <section class="panel"><div id="cal"></div></section>
    <div>
      <h3>Due soon</h3>${due.map(t => `<div class="row" data-p="${esc(t.path)}"><span class="t ell">${esc(t.title)}</span><small style="${t.due < td ? 'color:var(--r)' : ''}">${fmt(t.due)}</small></div>`).join('') || '<p class="empty">No tasks with due dates yet.</p>'}
      <h3 class="sec">Most connected</h3>${hubs.map(n => `<div class="row" data-p="${esc(n.path)}" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px"><span class="t ell">${esc(n.title)}</span><small>${n.deg}</small></div><div class="bar" style="width:${n.deg / max * 100}%"></div></div>`).join('')}
    </div>
  </div>
  <div class="ghead"><h3 class="sec">Graph</h3>${hooks.openGraph ? '<button class="ghost" id="og">Open Obsidian graph</button>' : ''}</div>
  <section class="panel gpanel"><svg id="g" role="img" aria-label="Graph of linked notes"></svg></section>
  <p class="sub gleg">Green: tasks. Orange: hubs. Yellow: linked notes. Grey: no links. Drag, scroll to zoom, click a note.</p>
  <h3 class="sec">Folders</h3>
  <div class="grid">${cards.map(f => `<div class="fold" tabindex="0" role="button" data-f="${esc(f.id)}">
      <div class="n"><span class="nm" title="${esc(f.name)}">${esc(f.name)}</span><small>${f.count} note${f.count === 1 ? '' : 's'}</small></div>
      ${f.subs.length ? `<div class="chips">${f.subs.slice(0, 4).map(s => `<span class="chip"><span class="ell">${esc(S.folders[s].name)}</span></span>`).join('')}${f.subs.length > 4 ? `<span class="chip">+${f.subs.length - 4}</span>` : ''}</div>` : ''}
      <ul>${f.recent.map(r => `<li class="ell" title="${esc(r.title)}">${esc(r.title)}</li>`).join('')}</ul></div>`).join('')}</div>`;

  $$('.row[data-p]').forEach(e => e.onclick = () => hooks.openNote(e.dataset.p));
  $$('.fold').forEach(e => { const go = () => hooks.openFolder(e.dataset.f); e.onclick = go; e.onkeydown = k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); go(); } }; });
  drawGraph($('#g'));
  const og = $('#og'); if (og) og.onclick = () => hooks.openGraph();
  createCalendar($('#cal'), calState, {
    tasks: () => S.data.tasks,
    onDay: k => hooks.newTask({ due: k }),
    onTask: p => hooks.openNote(p),
    onMove: async (p, k) => { await api('/api/tasks/update', { path: p, due: k }); hooks.reload(); },
  }).render();
}
