import Sortable from 'sortablejs';
import { $, $$, esc, themeRoot, reduced } from './util.js';
import { S, hooks } from './state.js';
import { WIDGETS } from './widgets.js';
import * as L from './layout.js';
import { SCOPES } from './items.js';
import { loadCanvas } from './canvasdata.js';
import { skeletonFor, headSkeleton } from './skeleton.js';

const cleanups = new Map();         // widget id -> cleanup returned by its render()
let sortable = null, popFor = null, docClick = null, docKey = null;

const defOf = w => WIDGETS[w.type];
const titleOf = w => { const t = defOf(w).title; return (typeof t === 'function' ? t(w) : t) || defOf(w).label; };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const find = id => L.getWidgets().find(w => w.id === id);
const frameEl = id => $(`.wg[data-id="${id}"]`);

/* First paint: the layout appears at once as skeleton bubbles, then every widget fills in on its own as its data is ready.
   hyd tracks that fill-in so a view change can cancel it. */
const hyd = { active: false, grid: null, waiting: new Set(), timers: new Set() };
const later = (fn, ms) => { const t = setTimeout(() => { hyd.timers.delete(t); fn(); }, ms); hyd.timers.add(t); };
const still = () => themeRoot().dataset.anim === 'off' || reduced();

export function cleanupDashboard() {
  hyd.timers.forEach(clearTimeout); hyd.timers.clear(); hyd.waiting.clear(); hyd.active = false; hyd.grid = null;
  cleanups.forEach(f => f()); cleanups.clear();
  if (sortable) { sortable.destroy(); sortable = null; }
  if (docClick) { document.removeEventListener('click', docClick); docClick = null; }
  if (docKey) { document.removeEventListener('keydown', docKey); docKey = null; }
  popFor = null;
}

function mount(w) {
  const host = $('.wg-body', frameEl(w.id));
  cleanups.get(w.id)?.();
  const c = defOf(w).render(host, w);
  cleanups.set(w.id, typeof c === 'function' ? c : () => {});
}

const frame = (w, edit, i = 0, loading = false) => `<section class="wg wg-${w.type}${defOf(w).title === null ? ' nohead' : ''}${loading ? ' is-loading' : ''}" data-id="${w.id}" style="grid-column:span ${w.w};grid-row:span ${w.h};--i:${i}">
  <header class="wg-h">${edit ? '<button class="wg-grip" title="Drag to move" aria-label="Drag to move">⠿</button>' : ''}<span class="wg-t">${esc(titleOf(w))}</span>
  ${edit ? '<button class="wg-btn" data-act="cfg" title="Options" aria-label="Options">⚙</button><button class="wg-btn" data-act="del" title="Remove" aria-label="Remove widget">×</button>' : ''}</header>
  <div class="wg-body"></div>${loading ? `<div class="wg-sk" aria-hidden="true">${skeletonFor(w.type)}</div>` : ''}${edit ? '<span class="wg-rs" title="Drag to resize"></span>' : ''}</section>`;

/* ---- filter bar: Overall / Personal / Canvas, plus Canvas connection status ---- */
function filterBar() {
  const c = S.canvas, open = c.items.filter(i => i.status !== 'done').length;
  const chip = !c.loaded ? ['Canvas: checking…', ''] : !c.configured ? ['Connect Canvas', 'warn'] : c.error ? ['Canvas: problem', 'bad'] : [`Canvas: ${open} open${c.refreshing ? ', updating…' : ''}`, 'ok'];
  return `<div class="filterbar"><div class="seg" role="group" aria-label="Show dues from">${SCOPES.map(([k, n]) => `<button data-scope="${k}" class="${S.filter === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <button class="cv-chip ${chip[1]}" id="cv-chip" title="${esc(c.error)}">${esc(chip[0])}</button>
    ${c.configured ? `<button class="ic${c.refreshing ? ' spin' : ''}" id="cv-refresh" title="Refresh Canvas" aria-label="Refresh Canvas">⟳</button>` : ''}</div>`;
}
function wireFilter(edit) {
  $$('[data-scope]').forEach(b => { b.onclick = () => { L.setFilter(b.dataset.scope); dashboard(edit); }; });
  $('#cv-chip').onclick = canvasDialog;
  const r = $('#cv-refresh'); if (r) r.onclick = () => { r.classList.add('spin'); loadCanvas(true); };
}
function canvasDialog() {
  const dlg = $('#dlg'), c = S.canvas, plugin = !!hooks.openCanvasSettings;
  dlg.className = 'wgadd';
  const where = plugin ? '<li>Open <b>Settings, Vault Dashboard, Canvas</b> and paste the token (field <b>C_API_HERE</b>) and your school address.</li>'
    : '<li>Open <b>start.cmd</b> in the dashboard folder. Paste the token after <b>set "C_API_HERE=</b> and your school address after <b>set "CANVAS_URL=</b>, save, and start the dashboard again.</li>';
  dlg.innerHTML = `<h2>Canvas</h2>${c.configured && !c.error
    ? `<p class="sub">Connected. ${c.items.length} assignments with due dates in ${c.courses.length} courses.${c.fetchedAt ? ' Updated ' + new Date(c.fetchedAt * 1000).toLocaleTimeString() + '.' : ''}</p><p class="tp-hint">Canvas items are read-only. They appear in the calendar, Due soon, charts and Progress. Use the filter at the top to show Overall, Personal or Canvas only.</p>`
    : c.error ? `<p class="sub" style="color:var(--r)">${esc(c.error)}</p>` : '<p class="sub">Not connected yet.</p>'}
    ${c.configured && !c.error ? '' : `<ol class="cv-steps"><li>In Canvas open <b>Account, Settings</b>, then <b>+ New Access Token</b> and copy it.</li>${where}</ol>`}
    <div class="foot">${plugin && !(c.configured && !c.error) ? '<button type="button" class="primary" id="cv-open">Open settings</button>' : ''}${c.configured ? '<button type="button" class="ghost" id="cv-now">Refresh now</button>' : ''}<button type="button" class="ghost" id="cv-x">Close</button></div>`;
  dlg.onclick = e => {
    if (e.target.closest('#cv-x')) dlg.close();
    else if (e.target.closest('#cv-now')) { loadCanvas(true); dlg.close(); }
    else if (e.target.closest('#cv-open')) {
      // Close every native modal first and open Obsidian's Settings on the next tick. Opening Obsidian's own modal while a
      // <dialog>.showModal() is still closing can leave the whole page inert (nothing clickable).
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      setTimeout(() => { try { hooks.openCanvasSettings(); } catch (err) { console.error('[vault-dashboard]', err); } }, 50);
    }
  };
  dlg.showModal();
}

let lastMode = null;   // the entrance animation plays when the view changes, not on every data refresh
export const leaveDashboard = () => { lastMode = null; };

/** The page before the vault has been read: heading and widget frames made of shimmering bubbles. */
export function dashboardSkeleton() {
  cleanupDashboard();
  lastMode = 'view';
  $('#main').innerHTML = headSkeleton()
    + `<div class="wgrid enter" data-skel style="--row:${L.GRID.row}px;--gap:${L.GRID.gap}px">${(L.getWidgets() || []).map((w, i) => frame(w, false, i, true)).join('')}</div>`;
}

/** Turns the skeleton page into the real one: each widget swaps its bubbles for content when it is ready, one after another. */
function hydrate(grid) {
  cleanupDashboard();
  grid.removeAttribute('data-skel');
  const head = $('.head-row');
  head.classList.remove('sk-head');
  head.innerHTML = `<div><h2>${esc(S.data.vault)}</h2><p class="sub">Everything in your vault at a glance.</p></div>${filterBar()}`;
  wireFilter(false);
  hyd.active = true; hyd.grid = grid;
  let n = 0;
  for (const w of L.getWidgets()) {
    if (defOf(w).dues && !S.canvas.loaded) hyd.waiting.add(w.id);   // dues also come from Canvas, which loads on its own
    else later(() => ready(w.id), still() ? 0 : 120 + n++ * 85);
  }
  if (hyd.waiting.size) later(() => releaseCanvas(true), 6000);     // Canvas is slow or offline: stop waiting
  if (!hyd.waiting.size && !n) hyd.active = false;
}

function ready(id) {
  const w = find(id), el = frameEl(id);
  if (!w || !el || !hyd.grid?.isConnected) return;
  hyd.waiting.delete(id);
  try { mount(w); } catch (e) { console.error('[vault-dashboard] widget failed:', w.type, e); $('.wg-body', el).innerHTML = '<p class="empty">This widget could not be drawn.</p>'; }
  el.classList.remove('is-loading'); el.classList.add('is-ready');
  const sk = $('.wg-sk', el);
  if (sk) { sk.classList.add('out'); setTimeout(() => sk.remove(), 520); }
  if (!$('.wg.is-loading', hyd.grid)) hyd.active = false;
}

/** Canvas data arrived: let the widgets that were waiting for it appear. Returns false when nothing was loading (the caller then redraws). */
export function releaseCanvas(force = false) {
  if (!hyd.active) return false;
  if (!force && !S.canvas.loaded) return true;
  [...hyd.waiting].forEach((id, i) => { hyd.waiting.delete(id); later(() => ready(id), still() ? 0 : i * 85); });
  refreshFilterBar();
  return true;
}

/** Redraws only the Canvas chip and scope switch (their state changes without the widgets needing to). */
export function refreshFilterBar() {
  const fb = $('.filterbar'); if (!fb || fb.closest('.sk-head')) return;
  fb.outerHTML = filterBar();
  wireFilter(!!$('.wgrid.edit'));
}

export function dashboard(edit) {
  const skel = $('.wgrid[data-skel]');
  if (skel && !edit && S.data) return hydrate(skel);
  cleanupDashboard();
  const mode = edit ? 'edit' : 'view', enter = lastMode !== mode;
  lastMode = mode;
  const ws = L.getWidgets(), d = S.data;
  $('#main').innerHTML = (edit
    ? `<div class="cust"><div><h2>Customize</h2><p class="sub">Drag ⠿ to reorder, drag a corner to resize, use ⚙ for options.</p></div>
        <div class="cust-a"><button class="ghost" id="wg-add">Add widget</button><button class="ghost" id="wg-reset">Reset layout</button><button class="primary" id="wg-done">Done</button></div></div><div class="filter-row">${filterBar()}</div>`
    : `<div class="head-row"><div><h2>${esc(d.vault)}</h2><p class="sub">Everything in your vault at a glance.</p></div>${filterBar()}</div>`)
    + `<div class="wgrid${edit ? ' edit' : ''}${enter ? ' enter' : ''}" style="--row:${L.GRID.row}px;--gap:${L.GRID.gap}px">${ws.map((w, i) => frame(w, edit, i)).join('')}</div>`
    + (ws.length ? '' : '<p class="empty">No widgets yet. Choose Customize, then Add widget.</p>');
  ws.forEach(mount);
  wireFilter(edit);
  if (edit) wireEdit();
}

function wireEdit() {
  const grid = $('.wgrid');
  $('#wg-add').onclick = addDialog;
  $('#wg-reset').onclick = () => { L.resetLayout(); dashboard(true); };
  $('#wg-done').onclick = () => { S.view = 'overview'; hooks.render(); };

  sortable = new Sortable(grid, {
    handle: '.wg-grip', animation: 200, ghostClass: 'wg-ghost',
    onStart: () => { closePop(); hooks.busy(true); },
    onEnd: () => { L.reorder($$('.wg', grid).map(e => e.dataset.id)); hooks.busy(false); },
  });

  grid.addEventListener('click', e => {
    const act = e.target.closest('[data-act]'), pop = e.target.closest('.wg-pop');
    if (act) {
      const id = act.closest('.wg').dataset.id;
      if (act.dataset.act === 'del') { cleanups.get(id)?.(); cleanups.delete(id); L.removeWidget(id); frameEl(id).remove(); popFor = null; }
      else popFor === id ? closePop() : openPop(id);
    } else if (pop) {
      const w = find(pop.closest('.wg').dataset.id), sz = e.target.closest('[data-w]'), o = e.target.closest('[data-o]');
      if (sz) apply(w, { w: Number(sz.dataset.w) });
      else if (o && o.tagName === 'BUTTON') apply(w, { opts: { ...w.opts, [o.dataset.o]: o.dataset.v } });
    }
  });
  grid.addEventListener('change', e => {
    const o = e.target.closest('select[data-o]');
    if (o) { const w = find(o.closest('.wg').dataset.id); apply(w, { opts: { ...w.opts, [o.dataset.o]: o.value } }); }
  });
  docClick = e => { if (popFor && !e.composedPath().some(el => el.matches?.('.wg-pop, [data-act="cfg"]'))) closePop(); };   // composedPath: the clicked button may already be re-rendered
  docKey = e => { if (e.key === 'Escape') closePop(); };
  document.addEventListener('click', docClick); document.addEventListener('keydown', docKey);

  grid.addEventListener('pointerdown', e => {          // resize by dragging the corner handle
    const rs = e.target.closest('.wg-rs'); if (!rs) return;
    e.preventDefault(); closePop();
    const el = rs.closest('.wg'), w = find(el.dataset.id), m = defOf(w).min, { cols, row, gap } = L.GRID;
    const colW = (grid.getBoundingClientRect().width - gap * (cols - 1)) / cols, r0 = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    hooks.busy(true); rs.setPointerCapture(e.pointerId);
    const move = ev => {
      w.w = clamp(Math.round((r0.width + ev.clientX - x0 + gap) / (colW + gap)), m.w, cols);
      w.h = clamp(Math.round((r0.height + ev.clientY - y0 + gap) / (row + gap)), m.h, 40);
      el.style.gridColumn = `span ${w.w}`; el.style.gridRow = `span ${w.h}`;
    };
    const up = () => { rs.removeEventListener('pointermove', move); rs.removeEventListener('pointerup', up); L.updateWidget(w.id, { w: w.w, h: w.h }); hooks.busy(false); };
    rs.addEventListener('pointermove', move); rs.addEventListener('pointerup', up);
  });
}

/* ---- per-widget options popover ---- */
function popHtml(w) {
  const def = defOf(w), o = { ...def.opts, ...w.opts };
  const row = opt => `<div class="pop-r"><span>${esc(opt.label)}</span>${opt.kind === 'select'
    ? `<select data-o="${opt.key}">${opt.choices.map(([v, n]) => `<option value="${v}"${String(o[opt.key]) === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`
    : `<div class="seg">${opt.choices.map(([v, n]) => `<button data-o="${opt.key}" data-v="${v}" class="${String(o[opt.key]) === v ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>`}</div>`;
  return `<div class="wg-pop"><div class="pop-r"><span>Width</span><div class="seg">${[['S', 4], ['M', 6], ['L', 8], ['Full', 12]].map(([n, c]) => `<button data-w="${c}" class="${w.w === c ? 'on' : ''}">${n}</button>`).join('')}</div></div>${(def.options || []).map(row).join('')}</div>`;
}
function openPop(id) { closePop(); frameEl(id).insertAdjacentHTML('beforeend', popHtml(find(id))); popFor = id; }
function closePop() { $('.wg-pop')?.remove(); popFor = null; }
function apply(w, patch) {
  L.updateWidget(w.id, patch);
  const el = frameEl(w.id);
  el.style.gridColumn = `span ${w.w}`; el.style.gridRow = `span ${w.h}`;
  $('.wg-t', el).textContent = titleOf(w);
  mount(w); openPop(w.id);
}

/* ---- add-widget gallery ---- */
function addDialog() {
  const dlg = $('#dlg');
  dlg.className = 'wgadd';
  dlg.innerHTML = `<h2>Add a widget</h2><p class="sub">You can add the same widget more than once.</p>
    <div class="wgpick">${Object.entries(WIDGETS).map(([k, d]) => `<button type="button" class="wgcard" data-t="${k}"><b>${esc(d.label)}</b><span>${esc(d.desc)}</span></button>`).join('')}</div>
    <div class="foot"><button type="button" class="ghost" id="wa-x">Cancel</button></div>`;
  dlg.onclick = e => {
    if (e.target.closest('#wa-x')) { dlg.close(); return; }
    const b = e.target.closest('[data-t]'); if (!b) return;
    const w = L.addWidget(b.dataset.t, WIDGETS[b.dataset.t]);
    dlg.close(); dashboard(true);
    frameEl(w.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  dlg.showModal();
}

export const initDashboard = () => L.loadLayout(WIDGETS);
