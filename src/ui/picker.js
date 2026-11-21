import { $, $$, esc } from './util.js';
import { S } from './state.js';

/* "Connect to notes": chips + search box + hierarchy browser.
   Folders are listed most-connected first. Click a row to highlight it; the two buttons then enable.
   A folder connects through its most-connected note (Obsidian can only link notes, not folders). */
export function mountConnect(host, links, root) {
  const direct = {};
  S.data.notes.forEach(n => (direct[n.folder] ??= []).push(n));
  const open = new Set();
  let sel = null, q = '';

  host.innerHTML = `<div class="chips" data-chips></div>
    <input data-in placeholder="Search or browse notes, press Enter to add" autocomplete="off" style="margin-top:8px">
    <div class="pick" hidden><div class="pick-b"></div>
      <div class="pick-f"><button type="button" class="ghost" data-sel disabled>Select folder</button><button type="button" class="ghost" data-more disabled>Add more</button></div></div>`;
  const chips = $('[data-chips]', host), input = $('[data-in]', host), pick = $('.pick', host), body = $('.pick-b', host), bSel = $('[data-sel]', host), bMore = $('[data-more]', host);

  const byDeg = (a, b) => b.deg - a.deg || a.name?.localeCompare(b.name) || 0;
  const folderRow = (f, d) => `<div class="pr${sel === 'f:' + f.id ? ' sel' : ''}" style="--d:${d}" data-k="f:${esc(f.id)}"><button type="button" class="car" data-t="${esc(f.id)}" aria-label="Expand">${open.has(f.id) ? '▾' : '▸'}</button><span class="ell">${esc(f.name)}</span><small>${f.count}</small><em title="Connections">${f.deg}</em></div>`;
  const noteRow = (n, d) => `<div class="pr note${sel === 'n:' + n.path ? ' sel' : ''}" style="--d:${d}" data-k="n:${esc(n.path)}"><span class="car"></span><span class="ell">${esc(n.title)}</span><em title="Connections">${n.deg}</em></div>`;
  function tree(f, d) {
    let h = folderRow(f, d);
    if (open.has(f.id)) {
      h += f.subs.map(id => S.folders[id]).sort(byDeg).map(c => tree(c, d + 1)).join('');
      h += (direct[f.id] || []).slice().sort((a, b) => b.deg - a.deg).map(n => noteRow(n, d + 1)).join('');
    }
    return h;
  }
  function draw() {
    const top = body.scrollTop;
    if (q) {
      const hits = S.data.notes.filter(n => n.title.toLowerCase().includes(q)).sort((a, b) => b.deg - a.deg).slice(0, 40);
      body.innerHTML = hits.map(n => noteRow(n, 0)).join('') || '<p class="empty">No matching notes</p>';
    } else body.innerHTML = Object.values(S.folders).filter(f => f.parent === null).sort(byDeg).map(f => tree(f, 0)).join('');
    body.scrollTop = top;
    bSel.disabled = bMore.disabled = !sel;
    bSel.textContent = sel?.startsWith('n:') ? 'Select note' : 'Select folder';
  }
  function drawChips() {
    chips.innerHTML = links.map((l, i) => `<span class="chip link" data-x="${i}" title="Remove"><span class="ell">${esc(l.label)}</span> ×</span>`).join('');
  }
  function add(title, label) {
    if (title && !links.some(l => l.title === title)) { links.push({ title, label: label || title }); drawChips(); }
  }
  function addSelected() {
    if (!sel) return;
    const [kind, id] = [sel.slice(0, 1), sel.slice(2)];
    if (kind === 'f') { const f = S.folders[id]; add(f.hub.title, `${f.name} → ${f.hub.title}`); }
    else add(S.by[id].title);
    sel = null;
  }

  input.addEventListener('focus', () => { pick.hidden = false; draw(); });
  input.addEventListener('input', () => { q = input.value.trim().toLowerCase(); sel = null; pick.hidden = false; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !pick.hidden) { e.stopPropagation(); e.preventDefault(); pick.hidden = true; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!q) return;
    const hit = S.data.notes.find(n => n.title.toLowerCase() === q) || S.data.notes.filter(n => n.title.toLowerCase().includes(q)).sort((a, b) => b.deg - a.deg)[0];
    if (hit) { add(hit.title); input.value = ''; q = ''; draw(); }
  });
  body.addEventListener('click', e => {
    const car = e.target.closest('.car[data-t]'), row = e.target.closest('.pr');
    if (car) { const id = car.dataset.t; open.has(id) ? open.delete(id) : open.add(id); draw(); return; }
    if (row) { sel = row.dataset.k; draw(); }
  });
  bSel.onclick = () => { addSelected(); pick.hidden = true; draw(); };
  bMore.onclick = () => { addSelected(); draw(); };
  chips.addEventListener('click', e => { const c = e.target.closest('[data-x]'); if (c) { links.splice(+c.dataset.x, 1); drawChips(); } });
  root._ac?.abort(); const ac = root._ac = new AbortController();   // one listener per open dialog, not one per opening
  root.addEventListener('click', e => { if (!e.composedPath().includes(host)) pick.hidden = true; }, { signal: ac.signal });   // composedPath survives re-renders of the clicked row
  drawChips();
}
