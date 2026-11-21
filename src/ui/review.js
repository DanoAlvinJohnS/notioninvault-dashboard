/* Review page: every change an agent wants waits here until you approve it. Nothing in the vault changes before that.
   - Tasks and moves/renames can be corrected before approving (title, due date, status, links, target path).
   - Note rewrites show a line diff against the note as it is now.
   - If the note changed after the agent proposed something, approving reports it as stale and leaves your note alone. */
import { $, esc } from './util.js';
import { api } from './api.js';
import { lineDiff } from '../agent/diff.ts';

const KIND = { task: 'New task', task_update: 'Update task', edit: 'Rewrite note', link: 'Add link', move: 'Move file', rename: 'Rename file', delete: 'Move to trash', create_note: 'New note' };
const STATE = { approved: 'Approved', rejected: 'Rejected', stale: 'Stale', failed: 'Failed' };
const CONTEXT = 3;
let drawing = 0, msg = null;

const tell = (text, kind = 'ok') => { msg = { text, kind }; };

/** The diff with long unchanged runs folded to "… N unchanged lines …". */
function diffHtml(before, after) {
  const d = lineDiff(before, after), keep = d.map((x, i) => x.op !== ' ' || d.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some(y => y.op !== ' '));
  let out = '', skipped = 0;
  d.forEach((x, i) => {
    if (!keep[i]) { skipped++; return; }
    if (skipped) { out += `<div class="rv-fold">… ${skipped} unchanged line${skipped > 1 ? 's' : ''} …</div>`; skipped = 0; }
    out += `<div class="rv-ln rv-${x.op === '+' ? 'add' : x.op === '-' ? 'del' : 'same'}"><span>${x.op}</span>${esc(x.line) || '&nbsp;'}</div>`;
  });
  if (skipped) out += `<div class="rv-fold">… ${skipped} unchanged line${skipped > 1 ? 's' : ''} …</div>`;
  return `<div class="rv-diff">${out}</div>`;
}

async function preview(p) {
  const a = p.args;
  switch (p.kind) {
    case 'task': return `<div class="rv-form">
        <label>Title <input data-f="title" value="${esc(a.title)}"></label>
        <label>Due <input type="date" data-f="due" value="${esc(a.due ?? '')}"></label>
        <label>Status <select data-f="status">${['todo', 'doing', 'done'].map(s => `<option ${(a.status ?? 'todo') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Links <input data-f="links" value="${esc((a.links ?? []).join(', '))}" placeholder="Note names, comma separated"></label>
        ${a.details ? `<p class="rv-details">${esc(a.details)}</p>` : ''}${a.canvas_id ? `<p class="rv-meta">From Canvas (${esc(a.canvas_id)})</p>` : ''}</div>`;
    case 'task_update': return `<p class="rv-path">${esc(a.path)}</p><div class="rv-form">
        <label>Due <input type="date" data-f="due" value="${esc(a.due ?? '')}"></label>
        <label>Status <select data-f="status"><option value="">(unchanged)</option>${['todo', 'doing', 'done'].map(s => `<option ${a.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Link <input data-f="add_link" value="${esc(a.add_link ?? '')}"></label></div>`;
    case 'edit': {
      let now = '';
      try { now = (await api('/api/note?path=' + encodeURIComponent(a.path))).content; } catch { return `<p class="rv-path">${esc(a.path)}</p><p class="rv-warn">This note no longer exists.</p>`; }
      return `<p class="rv-path">${esc(a.path)}</p>${diffHtml(now, a.new_body)}`;
    }
    case 'link': return `<p class="rv-path">${esc(a.from)} → [[${esc(a.to)}]]</p>`;
    case 'move': case 'rename': return `<p class="rv-path">${esc(a.path)} →</p><div class="rv-form"><label>New path <input data-f="new_path" value="${esc(a.new_path)}"></label></div>`;
    case 'delete': return `<p class="rv-path">Move ${esc(a.path)} to Obsidian's trash (you can restore it from there).</p>`;
    case 'create_note': return `<p class="rv-path">${esc(a.path)}${a.from ? ` <span class="rv-meta">and trash ${esc(a.from)}</span>` : ''}</p><pre class="rv-new">${esc(a.body)}</pre>`;
    default: return '';
  }
}

const card = async p => `<article class="wg rv-card" data-id="${esc(p.id)}">
    <div class="rv-top"><span class="rv-chip">${esc(p.agent)}</span><b>${KIND[p.kind] ?? p.kind}</b><time>${new Date(p.created).toLocaleString()}</time></div>
    ${p.reason ? `<p class="rv-reason">${esc(p.reason)}</p>` : ''}
    ${await preview(p)}
    <div class="rv-actions"><button class="primary" data-a="approve">Approve</button><button class="ghost" data-a="reject">Reject</button>
      <span class="rv-rej" hidden><input placeholder="Why? (optional, the agent will see it)"><button class="ghost" data-a="reject-ok">Reject</button></span></div>
  </article>`;

const recent = list => list.length ? `<details class="rv-recent"><summary>Recent decisions (${list.length})</summary>${list.map(p => `
    <div class="rv-row rv-${p.status}"><span class="rv-state">${STATE[p.status] ?? p.status}</span><b>${KIND[p.kind] ?? p.kind}</b>
      <span>${esc(p.args.title ?? p.args.path ?? p.args.from ?? '')}</span>${p.note || p.error ? `<em>${esc(p.note ?? p.error)}</em>` : ''}</div>`).join('')}</details>` : '';

const linksOf = v => v.split(',').map(s => s.trim().replace(/^\[\[|\]\]$/g, '')).filter(Boolean);

/** Draws the Review page into #main. */
export async function reviewPage() {
  const main = $('#main'), me = ++drawing;
  let all;
  try { all = await api('/api/proposals'); }
  catch (e) { main.innerHTML = `<section class="rv"><h2>Review</h2><p class="rv-sub">${esc(e.message)}</p></section>`; return; }
  const pending = all.filter(p => p.status === 'pending').sort((a, b) => b.created - a.created);
  const decided = all.filter(p => p.status !== 'pending').sort((a, b) => (b.decided ?? 0) - (a.decided ?? 0));
  const cards = (await Promise.all(pending.map(card))).join('');
  if (me !== drawing) return;   // a newer draw started while this one was loading
  main.innerHTML = `<section class="rv">
    <header class="rv-head"><div><h2>Review</h2><p class="rv-sub">${pending.length ? `${pending.length} change${pending.length > 1 ? 's' : ''} waiting for your OK` : 'Nothing waiting. Changes your agents propose appear here.'}</p></div>
      <button class="primary" data-a="all" ${pending.length ? '' : 'disabled'}>Approve all</button></header>
    ${msg ? `<p class="rv-msg rv-${msg.kind}" role="status">${esc(msg.text)}</p>` : ''}
    <div class="rv-list">${cards}</div>${recent(decided.slice(0, 30))}</section>`;
  msg = null;
  wire(main);
}

const result = r => r.status === 'approved' ? tell('Done.') : r.status === 'stale' ? tell(`Not applied: ${r.error}. Ask the agent again if you still want it.`, 'warn') : tell(`Failed: ${r.error}`, 'bad');

function wire(main) {
  // buttons are disabled while a request runs, so a double click cannot approve twice
  const run = async (fn) => { main.querySelectorAll('.rv button').forEach(b => { b.disabled = true; }); try { await fn(); } catch (e) { tell(e.message, 'bad'); } reviewPage(); };
  main.querySelector('[data-a="all"]')?.addEventListener('click', () => run(async () => {
    const rs = await api('/api/proposals/approve-all', {});
    const bad = rs.filter(r => r.status !== 'approved');
    bad.length ? tell(`${rs.length - bad.length} applied, ${bad.length} not applied (see Recent decisions).`, 'warn') : tell(`${rs.length} applied.`);
  }));
  main.querySelectorAll('.rv-card').forEach(c => {
    const id = c.dataset.id;
    c.querySelector('[data-a="approve"]').onclick = () => run(async () => result(await api('/api/proposals/approve', { id })));
    c.querySelector('[data-a="reject"]').onclick = () => { const r = c.querySelector('.rv-rej'); r.hidden = false; r.querySelector('input').focus(); };
    c.querySelector('[data-a="reject-ok"]').onclick = () => run(async () => { await api('/api/proposals/reject', { id, note: c.querySelector('.rv-rej input').value }); tell('Rejected.'); });
    c.querySelectorAll('[data-f]').forEach(inp => inp.onchange = async () => {
      const f = inp.dataset.f, v = f === 'links' ? linksOf(inp.value) : inp.value;
      try { await api('/api/proposals/edit', { id, patch: { [f]: v === '' && f === 'status' ? undefined : v } }); inp.classList.remove('rv-err'); }
      catch (e) { inp.classList.add('rv-err'); inp.title = e.message; }
    });
  });
}
