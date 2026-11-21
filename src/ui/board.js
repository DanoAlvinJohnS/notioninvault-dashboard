import Sortable from 'sortablejs';
import { $$, esc, fmt, today } from './util.js';
import { S, hooks } from './state.js';
import { api } from './api.js';

const COLS = [['todo', 'To do', 'var(--y)'], ['doing', 'Doing', 'var(--o)'], ['done', 'Done', 'var(--g)']];

/* Kanban board drawn into `host`. Dropping a card rewrites that task's status in its note. Returns a cleanup function. */
export function renderBoard(host) {
  const td = today();
  host.innerHTML = `<div class="board">${COLS.map(([k, label, c]) => {
    const ts = S.data.tasks.filter(t => t.status === k);
    return `<section><div class="colh"><span class="dot" style="--pc:${c};background:var(--pc)"></span>${label}<small>${ts.length}</small></div>
    <div class="colb" data-s="${k}">${ts.map(t => `<div class="card" data-p="${esc(t.path)}"><div class="t">${esc(t.title)}</div>
      ${t.due ? `<div class="due ${t.due < td && k !== 'done' ? 'late' : ''}">${fmt(t.due)}</div>` : ''}
      ${t.links.length ? `<div class="chips">${t.links.slice(0, 3).map(l => `<span class="chip"><span class="ell">${esc(S.by[l].title)}</span></span>`).join('')}</div>` : ''}</div>`).join('')}</div></section>`;
  }).join('')}</div>`;
  $$('.card', host).forEach(e => e.onclick = () => hooks.openNote(e.dataset.p));
  const sorts = $$('.colb', host).map(el => new Sortable(el, {
    group: 't', animation: 150,
    onStart: () => hooks.busy(true),
    onEnd: async () => {
      const columns = {}; $$('.colb', host).forEach(c => columns[c.dataset.s] = [...c.children].map(x => x.dataset.p));
      try { await api('/api/tasks/reorder', { columns }); } finally { hooks.busy(false); hooks.reload(); }
    },
  }));
  return () => sorts.forEach(s => s.destroy());
}
