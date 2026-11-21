import { $, $$, esc, fmt, iso, today, countUp } from './util.js';
import { S, hooks } from './state.js';
import { api } from './api.js';
import { createCalendar, newCalState } from './calendar.js';
import { drawGraph } from './graph.js';
import { renderBoard } from './board.js';
import { drawChart } from './charts.js';
import { drawProgress } from './progress.js';
import { dues, withDue, isOpen, isOverdue, scopeOf, projectOf } from './items.js';

const calStates = new Map();   // one calendar position per widget, kept across refreshes
const open = id => (id.startsWith('canvas:') ? hooks.openCanvas(id) : hooks.openNote(id));
const SCOPE_OPT = { key: 'scope', label: 'Show dues from', kind: 'seg', choices: [['page', 'Page filter'], ['all', 'Overall'], ['personal', 'Personal'], ['canvas', 'Canvas']] };
const palette = () => ['var(--o)', 'var(--g)', 'var(--c)', '#b58cff', 'var(--r)', '#35d0c6', '#ff8fc7', 'var(--y)'];   // variable references: they follow the theme and the colour effect live

/* Data the chart widget can show. build(scope) returns [{label, value, color?, path?, folder?}] */
export const SOURCES = {
  connected: { label: 'Most connected notes', build: () => S.data.notes.filter(n => n.deg).sort((a, b) => b.deg - a.deg).slice(0, 8).map(n => ({ label: n.title, value: n.deg, path: n.path })) },
  folders: { label: 'Notes per folder', build: () => S.data.folders.filter(f => f.parent === null).sort((a, b) => b.count - a.count).slice(0, 8).map(f => ({ label: f.name, value: f.count, folder: f.id })) },
  tasks: {
    label: 'Dues by status', build: sc => {
      const l = dues(sc);
      return [['To do', 'todo', '--y'], ['Doing', 'doing', '--o'], ['Done', 'done', '--g']].map(([label, k, v]) => ({ label, color: `var(${v})`, value: l.filter(d => d.status === k).length }));
    },
  },
  due: {
    label: 'Open dues by date', build: sc => {
      const td = today(), wk = new Date(); wk.setDate(wk.getDate() + 7);
      const l = dues(sc).filter(isOpen), end = iso(wk);
      return [['Overdue', t => t.due && t.due < td, '--r'], ['Today', t => t.due === td, '--y'], ['This week', t => t.due > td && t.due <= end, '--o'], ['Later', t => t.due > end, '--c'], ['No date', t => !t.due, null]]
        .map(([label, f, v]) => ({ label, color: v ? `var(${v})` : '#8a92a0', value: l.filter(f).length }));
    },
  },
  split: { label: 'Open dues: Personal vs Canvas', build: sc => [['Personal', '--y'], ['Canvas', '--c']].map(([label, v]) => ({ label, color: `var(${v})`, value: dues(sc).filter(d => isOpen(d) && (d.source === 'canvas') === (label === 'Canvas')).length })) },
  courses: { label: 'Canvas: open dues per course', build: sc => { const m = {}; dues(sc).filter(d => d.source === 'canvas' && isOpen(d)).forEach(d => { m[d.course] = (m[d.course] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value })); } },
};

/* Progress groups: how much of each group is done. */
function progressGroups(scope, group) {
  const by = new Map(), P = palette();
  const add = (label, d, color) => { const g = by.get(label) || by.set(label, { label, done: 0, total: 0, color }).get(label); g.total++; if (d.status === 'done') g.done++; };
  for (const d of dues(scope)) {
    if (group === 'overall') add('Overall', d);
    else if (group === 'source') add(d.source === 'canvas' ? 'Canvas' : 'Personal', d, d.source === 'canvas' ? 'var(--c)' : 'var(--y)');
    else if (group === 'course') { if (d.source === 'canvas') add(d.course, d); }
    else if (group === 'project') { if (d.source !== 'canvas') add(projectOf(d), d); }
  }
  return [...by.values()].sort((a, b) => b.total - a.total).slice(0, 8).map((g, i) => ({ ...g, pct: g.total ? g.done / g.total : 0, color: g.color || P[i % P.length] }));
}

/* Widget registry. render(host, widget) fills `host` and may return a cleanup function. min = smallest size in grid cells. */
export const WIDGETS = {
  stats: {
    dues: true, label: 'Stats', desc: 'Notes, connections and due counts', w: 12, h: 2, min: { w: 3, h: 2 }, title: null, opts: { scope: 'page' }, options: [SCOPE_OPT],
    render(host, w) {
      const d = S.data, td = today(), l = dues(scopeOf(w)).filter(isOpen), late = l.filter(x => isOverdue(x, td)).length;
      host.innerHTML = `<div class="stats">
        <div><b>${d.notes.length}</b><span>notes</span></div><div><b>${d.edges.length}</b><span>connections</span></div>
        <div><b>${l.length}</b><span>open dues</span></div><div><b style="color:${late ? 'var(--r)' : 'inherit'}">${late}</b><span>overdue</span></div>
        <div><b>${d.notes.filter(n => !n.deg).length}</b><span>notes with no links</span></div></div>`;
      if (host.closest('.wgrid.enter')) countUp(host);
    },
  },
  calendar: {
    dues: true, label: 'Calendar', desc: 'Month or week view of your due dates', w: 8, h: 9, min: { w: 4, h: 6 }, title: null, opts: { scope: 'page' }, options: [SCOPE_OPT],
    render(host, w) {
      const st = calStates.get(w.id) || calStates.set(w.id, newCalState()).get(w.id);
      createCalendar(host, st, {
        tasks: () => withDue(dues(scopeOf(w))), onDay: k => hooks.newTask({ due: k }), onTask: open,
        onMove: async (p, k) => { await api('/api/tasks/update', { path: p, due: k }); hooks.reload(); },
      }).render();
    },
  },
  due: {
    dues: true, label: 'Due soon', desc: 'Open dues sorted by date', w: 4, h: 4, min: { w: 2, h: 3 }, title: 'Due soon', opts: { limit: '6', scope: 'page' },
    options: [SCOPE_OPT, { key: 'limit', label: 'Show', kind: 'seg', choices: [['3', '3'], ['6', '6'], ['10', '10']] }],
    render(host, w) {
      const td = today(), list = withDue(dues(scopeOf(w))).filter(isOpen).sort((a, b) => a.due.localeCompare(b.due)).slice(0, Number(w.opts.limit) || 6);
      host.innerHTML = list.map(t => `<div class="row" data-id="${esc(t.id)}"><span class="src src-${t.source}"></span><span class="t ell">${esc(t.title)}${t.course ? `<small class="crs">${esc(t.course)}</small>` : ''}</span><small style="${t.due < td ? 'color:var(--r)' : ''}">${fmt(t.due)}</small></div>`).join('')
        || '<p class="empty">No open dues for this filter.</p>';
      $$('.row', host).forEach(e => { e.onclick = () => open(e.dataset.id); });
    },
  },
  chart: {
    dues: true, label: 'Chart', desc: 'Bar, line, pie or donut chart of your vault and dues', w: 4, h: 5, min: { w: 3, h: 3 }, opts: { source: 'connected', type: 'hbar', scope: 'page' },
    title: w => (SOURCES[w.opts.source] || SOURCES.connected).label,
    options: [
      { key: 'source', label: 'Data', kind: 'select', choices: Object.entries(SOURCES).map(([k, v]) => [k, v.label]) },
      { key: 'type', label: 'Chart type', kind: 'seg', choices: [['hbar', 'Horizontal'], ['bar', 'Bar'], ['line', 'Line'], ['pie', 'Pie'], ['donut', 'Donut']] }, SCOPE_OPT,
    ],
    render(host, w) {
      let data = (SOURCES[w.opts.source] || SOURCES.connected).build(scopeOf(w));
      if (data.every(d => !d.value)) data = [];
      return drawChart(host, { id: w.id, type: w.opts.type || 'hbar', data, onPick: d => (d.path ? hooks.openNote(d.path) : d.folder != null ? hooks.openFolder(d.folder) : null) });
    },
  },
  progress: {
    dues: true, label: 'Progress', desc: 'How much is done: bars, rings, donut or pie', w: 6, h: 7, min: { w: 3, h: 3 }, opts: { scope: 'page', group: 'source', type: 'bars' },
    title: w => ({ source: 'Progress by source', overall: 'Overall progress', course: 'Progress by course', project: 'Progress by project' }[w.opts.group] || 'Progress'),
    options: [
      SCOPE_OPT,
      { key: 'group', label: 'Group by (bars and rings)', kind: 'select', choices: [['overall', 'Overall'], ['source', 'Personal vs Canvas'], ['course', 'Canvas course'], ['project', 'Personal project']] },
      { key: 'type', label: 'Style', kind: 'seg', choices: [['bars', 'Bars'], ['rings', 'Rings'], ['donut', 'Donut'], ['pie', 'Pie']] },
    ],
    render(host, w) {
      const scope = scopeOf(w), type = w.opts.type || 'bars';
      if (type === 'donut' || type === 'pie') {   // done / open / overdue split of everything in view
        const l = dues(scope), done = l.filter(d => !isOpen(d)).length, late = l.filter(d => isOverdue(d)).length, openN = l.length - done - late;
        const data = l.length ? [{ label: 'Done', value: done, color: 'var(--g)' }, { label: 'Open', value: openN, color: 'var(--o)' }, { label: 'Overdue', value: late, color: 'var(--r)' }] : [];
        return drawChart(host, { id: w.id, type, data, center: { text: l.length ? Math.round(done / l.length * 100) + '%' : '0%', sub: 'done' } });
      }
      return drawProgress(host, { id: w.id, type, groups: progressGroups(scope, w.opts.group || 'source') });
    },
  },
  graph: {
    label: 'Graph', desc: 'Interactive map of how your notes link', w: 6, h: 7, min: { w: 4, h: 4 }, title: 'Graph',
    render(host) {
      host.innerHTML = `<svg class="gsvg" role="img" aria-label="Graph of linked notes"></svg>
        <div class="glegend"><span><i style="--pc:var(--g);background:var(--pc)"></i>Tasks</span><span><i style="--pc:var(--o);background:var(--pc)"></i>Hubs</span><span><i style="--pc:var(--y);background:var(--pc)"></i>Linked</span><span><i style="background:#9aa1ad"></i>No links</span></div>
        ${hooks.openGraph ? '<button class="ghost gopen">Open Obsidian graph</button>' : ''}`;
      const og = $('.gopen', host); if (og) og.onclick = () => hooks.openGraph();
      return drawGraph($('.gsvg', host));
    },
  },
  board: {
    label: 'Tasks board', desc: 'Drag personal tasks between To do, Doing and Done', w: 12, h: 8, min: { w: 4, h: 4 }, title: 'Tasks',
    render(host) {
      const stop = renderBoard(host);
      if (S.canvas.items.length && S.filter !== 'personal') host.insertAdjacentHTML('afterbegin', '<p class="tp-hint">This board shows your personal tasks. Canvas items are read-only: see the Calendar and Due soon widgets.</p>');
      return stop;
    },
  },
  folders: {
    label: 'Folders', desc: 'A card for every top-level folder', w: 12, h: 5, min: { w: 3, h: 3 }, title: 'Folders',
    render(host) {
      host.innerHTML = `<div class="grid">${S.data.folders.filter(f => f.parent === null).map(f => `<div class="fold" tabindex="0" role="button" data-f="${esc(f.id)}">
        <div class="n"><span class="nm" title="${esc(f.name)}">${esc(f.name)}</span><small>${f.count} note${f.count === 1 ? '' : 's'}</small></div>
        ${f.subs.length ? `<div class="chips">${f.subs.slice(0, 4).map(s => `<span class="chip"><span class="ell">${esc(S.folders[s].name)}</span></span>`).join('')}${f.subs.length > 4 ? `<span class="chip">+${f.subs.length - 4}</span>` : ''}</div>` : ''}
        <ul>${f.recent.map(r => `<li class="ell" title="${esc(r.title)}">${esc(r.title)}</li>`).join('')}</ul></div>`).join('')}</div>`;
      $$('.fold', host).forEach(e => { const go = () => hooks.openFolder(e.dataset.f); e.onclick = go; e.onkeydown = k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); go(); } }; });
    },
  },
};
