import { esc, iso, today } from './util.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COL = { todo: 'var(--y)', doing: 'var(--o)', done: 'var(--g)' };
const dot = t => (t.source === 'canvas' ? 'var(--c)' : COL[t.status] || COL.todo);
export const newCalState = date => ({ cur: date ? new Date(date + 'T00:00') : new Date(), mode: 'month' });

/* Google-Calendar-style grid. `st` ({cur, mode}) is owned by the caller so the view survives re-renders.
   o: { tasks(), mini, selected, onDay(k), onTask(path), onMove(path, k) } */
export function createCalendar(host, st, o) {
  const mini = !!o.mini;

  function span() {
    const c = st.cur, first = new Date(c.getFullYear(), c.getMonth(), 1);
    const start = st.mode === 'week' ? new Date(c.getFullYear(), c.getMonth(), c.getDate()) : new Date(first);
    start.setDate(start.getDate() - start.getDay());
    const n = st.mode === 'week' ? 7 : Math.ceil((first.getDay() + new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate()) / 7) * 7;
    return Array.from({ length: n }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  const title = days => {
    if (st.mode === 'month') return st.cur.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const f = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${f(days[0])} – ${f(days[6])}, ${days[6].getFullYear()}`;
  };

  function render() {
    const days = span(), by = {}, max = st.mode === 'week' ? 99 : 3;
    for (const t of o.tasks()) if (t.due) (by[t.due] ??= []).push(t);
    const cell = d => {
      const k = iso(d), ts = by[k] || [];
      const cls = ['cd', st.mode === 'month' && d.getMonth() !== st.cur.getMonth() && 'out', k === today() && 'now', k === o.selected && 'sel'].filter(Boolean).join(' ');
      const body = mini
        ? (ts.length ? `<i class="dots">${ts.slice(0, 3).map(t => `<b style="--pc:${dot(t)};background:var(--pc)"></b>`).join('')}</i>` : '')
        : ts.slice(0, max).map(t => `<div class="ev ${esc(t.status)}${t.source === 'canvas' ? ' is-canvas' : ''}" draggable="${t.source !== 'canvas'}" data-p="${esc(t.path || t.id)}" title="${esc(t.title + (t.course ? ' · ' + t.course : ''))}">${esc(t.title)}</div>`).join('')
          + (ts.length > max ? `<a class="more" data-more="${k}">+${ts.length - max} more</a>` : '');
      return `<div class="${cls}" data-d="${k}"><span class="dn">${d.getDate()}</span>${body}</div>`;
    };
    host.innerHTML = `<div class="cal${mini ? ' mini' : ''}">
      <div class="cal-h">${mini ? '' : '<button class="ghost" data-a="today">Today</button>'}
        <button class="ic" data-a="prev" aria-label="Previous">‹</button><button class="ic" data-a="next" aria-label="Next">›</button>
        <h3>${title(days)}</h3>
        ${mini ? '' : `<div class="seg"><button data-m="month" class="${st.mode === 'month' ? 'on' : ''}">Month</button><button data-m="week" class="${st.mode === 'week' ? 'on' : ''}">Week</button></div>`}
      </div>
      <div class="cal-w">${DAYS.map(d => `<span>${mini ? d[0] : d}</span>`).join('')}</div>
      <div class="cal-g ${st.mode}">${days.map(cell).join('')}</div></div>`;
  }

  host.addEventListener('click', e => {
    const t = e.target, a = t.closest('[data-a]'), m = t.closest('[data-m]'), more = t.closest('[data-more]'), ev = t.closest('.ev'), cd = t.closest('.cd');
    if (a) {
      const c = st.cur, dir = a.dataset.a;
      if (dir === 'today') st.cur = new Date();
      else { const s = dir === 'next' ? 1 : -1; st.cur = st.mode === 'week' ? new Date(c.getFullYear(), c.getMonth(), c.getDate() + 7 * s) : new Date(c.getFullYear(), c.getMonth() + s, 1); }
      render();
    } else if (m) { st.mode = m.dataset.m; render(); }
    else if (more) { st.cur = new Date(more.dataset.more + 'T00:00'); st.mode = 'week'; render(); }
    else if (ev) o.onTask?.(ev.dataset.p);
    else if (cd) { if (mini) { o.selected = cd.dataset.d; render(); } o.onDay?.(cd.dataset.d); }
  });
  host.addEventListener('dragstart', e => { const ev = e.target.closest?.('.ev[draggable="true"]'); if (ev) { e.dataTransfer.setData('text/plain', ev.dataset.p); e.dataTransfer.effectAllowed = 'move'; } });
  host.addEventListener('dragover', e => {
    const c = e.target.closest?.('.cd');
    if (c && o.onMove) { e.preventDefault(); host.querySelectorAll('.cd.over').forEach(x => x.classList.remove('over')); c.classList.add('over'); }
  });
  host.addEventListener('drop', e => {
    const c = e.target.closest?.('.cd'), p = e.dataTransfer.getData('text/plain');
    if (c && p && o.onMove) { e.preventDefault(); o.onMove(p, c.dataset.d); }
  });
  host.addEventListener('dragend', () => host.querySelectorAll('.over').forEach(x => x.classList.remove('over')));

  return { render, select(k) { o.selected = k; if (k) st.cur = new Date(k + 'T00:00'); render(); } };
}
