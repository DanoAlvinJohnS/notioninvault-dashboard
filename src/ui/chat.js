/* Claude page: claude.ai (your Pro account) shown inside the dashboard in one webview.
   - Uses Obsidian desktop's <webview>, which behaves like a small browser tab. The sign-in is kept between sessions
     (its own storage partition, separate from the rest of Obsidian).
   - The page is created the first time you open it and then kept alive, so switching pages does not lose a conversation.
   - Reading the vault: the paperclip on the left opens a picker (a note, a folder or the whole vault); the plugin hands the
     choice to Claude as an attachment. A folder goes as one Markdown file with every note under its path.
   - Dragging a file or a note over the page does NOT go through the webview (that was very slow: the page inside a webview
     tracks every mouse move out-of-process). A transparent drop layer catches the drag instead.
   - Obsidian mobile cannot embed web pages, so there it offers to open claude.ai in your browser instead. */
import { droppedFile, pickForClaude } from './api.js';

const CLAUDE = { name: 'Claude', url: 'https://claude.ai/new', hue: '#d97757' };
const PARTITION = 'persist:vault-dashboard-ai';   // unchanged, so an existing sign-in is kept
const MAX_BYTES = 15 * 1024 * 1024;   // what one drop may carry into the page
const MIME = { md: 'text/markdown', txt: 'text/plain', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', csv: 'text/csv', json: 'application/json', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const mimeOf = name => MIME[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
const CLIP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';

/** The same user agent Obsidian already has, minus the "Obsidian/…" and "Electron/…" tokens that some sign-in pages reject. */
const userAgent = () => navigator.userAgent.replace(/\s(?:obsidian|electron)\/[\d.]+/gi, '');
const isMobile = () => document.body.classList.contains('is-mobile');

function toBase64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Runs inside the chat page: puts the files into its message box the way a paste would, then tries a drop, then the file input. */
const ATTACH = items => `(async () => {
  try {
    const files = ${JSON.stringify(items)}.map(i => { const b = atob(i.b64), u = new Uint8Array(b.length); for (let k = 0; k < b.length; k++) u[k] = b.charCodeAt(k); return new File([u], i.name, { type: i.type }); });
    const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
    const box = document.querySelector('[contenteditable="true"], textarea');
    if (box) {
      box.focus();
      const paste = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      box.dispatchEvent(paste);
      if (paste.defaultPrevented) return 'ok';
    }
    const target = (box && (box.closest('form') || box.parentElement)) || document.body;
    let handled = false;
    for (const t of ['dragenter', 'dragover', 'drop']) { const ev = new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }); target.dispatchEvent(ev); handled = handled || ev.defaultPrevented; }
    if (handled) return 'ok';
    const input = document.querySelector('input[type="file"]');
    if (input) { input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; }
    return 'none';
  } catch (e) { return 'error'; }
})()`;

/** root = the .vd-root element. Returns { show, hide, destroy }. */
export function mountChat(root) {
  const doc = root.ownerDocument;
  const host = doc.createElement('section');
  host.className = 'chat';
  host.hidden = true;
  host.setAttribute('aria-label', 'Claude');
  host.innerHTML = `<div class="chat-views"><div class="chat-page"></div></div>
    <nav class="chat-rail" aria-label="Claude tools"><button type="button" data-share data-tip="Add notes from your vault" aria-label="Add notes from your vault" style="--hue:${CLAUDE.hue}"><span>${CLIP}</span></button></nav>
    <div class="chat-drop" aria-hidden="true"><div><b>Attach to Claude</b><small>Drop a file or a note to attach it</small></div></div>
    <div class="chat-toast" role="status" aria-live="polite"></div>`;
  root.appendChild(host);
  const box = host.querySelector('.chat-page'), share = host.querySelector('[data-share]'), drop = host.querySelector('.chat-drop'), toast = host.querySelector('.chat-toast');

  let wv = null, state = null, failed = false, shown = false, toastTimer = 0;

  const say = (kind, title, body, actions = []) => {
    state?.remove();
    const el = state = doc.createElement('div');
    el.className = `chat-state ${kind}`;
    el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    const h = doc.createElement('b'); h.textContent = title; el.appendChild(h);
    if (body) { const t = doc.createElement('p'); t.textContent = body; el.appendChild(t); }
    if (actions.length) {
      const row = doc.createElement('div'); row.className = 'chat-actions';
      for (const [label, fn] of actions) { const b = doc.createElement('button'); b.className = 'ghost'; b.textContent = label; b.onclick = fn; row.appendChild(b); }
      el.appendChild(row);
    }
    box.appendChild(el);
  };
  const clear = () => { state?.remove(); state = null; };
  const note = text => {
    toast.textContent = text; toast.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('on'), 3600);
  };
  const external = () => window.open(CLAUDE.url, '_blank');

  function open() {
    if (isMobile()) { say('info', 'Claude needs Obsidian on desktop', 'Obsidian mobile cannot show web pages inside a note view.', [['Open Claude in your browser', external]]); return; }
    const retry = () => { failed = false; say('info', 'Opening Claude…'); try { wv.loadURL(CLAUDE.url); } catch { wv.setAttribute('src', CLAUDE.url); } };
    wv = doc.createElement('webview');
    wv.setAttribute('partition', PARTITION);
    wv.setAttribute('useragent', userAgent());
    wv.setAttribute('allowpopups', '');          // sign-in providers open a small window
    wv.className = 'chat-view';
    wv.addEventListener('did-start-loading', () => { if (!failed && !wv.dataset.ready) say('info', 'Opening Claude…'); });
    wv.addEventListener('dom-ready', () => { wv.dataset.ready = '1'; });
    wv.addEventListener('did-stop-loading', () => { if (!failed) clear(); });
    wv.addEventListener('did-fail-load', e => {
      if (!e.isMainFrame || e.errorCode === -3) return;   // -3 = cancelled by a redirect, not a real failure
      failed = true;
      say('bad', 'Claude could not load', 'Check your internet connection, then try again.', [['Try again', retry], ['Open in browser', external]]);
    });
    box.appendChild(wv);
    wv.setAttribute('src', CLAUDE.url);           // set last, once the partition is in place
    say('info', 'Opening Claude…');
  }

  /** items = [{ name, type, data: ArrayBuffer }] → into Claude's message box. */
  async function attach(items, label) {
    if (!wv?.dataset.ready) { note('Claude is still loading. Try again in a moment.'); return; }
    if (items.reduce((n, i) => n + i.data.byteLength, 0) > MAX_BYTES) { note('That is too large to attach this way (15 MB limit).'); return; }
    const out = await wv.executeJavaScript(ATTACH(items.map(i => ({ name: i.name, type: i.type, b64: toBase64(i.data) }))));
    note(out === 'ok' ? `Attached ${label} to Claude` : 'Claude did not take the file. Use its own + button instead.');
  }

  share.addEventListener('click', async () => {
    try {
      const v = await pickForClaude();
      if (!v) return;
      await attach([{ name: v.name, type: mimeOf(v.name), data: v.data }], v.count === 1 ? v.name : `${v.count} notes`);
      if (v.skipped) note(`Attached ${v.count} notes. ${v.skipped} more did not fit; pick a smaller folder for those.`);
    } catch (err) { console.error('[vault-dashboard] share failed', err); note('Could not read that from the vault.'); }
  });

  /* ---- drag and drop ---- */
  const dragKinds = dt => { const t = [...(dt?.types || [])]; return t.includes('Files') || t.includes('text/plain') || t.includes('text/uri-list') || t.some(x => x.includes('obsidian')); };
  const arm = e => { if (shown && !isMobile() && dragKinds(e.dataTransfer)) drop.classList.add('on'); };
  const disarm = () => drop.classList.remove('on', 'over');
  // dragstart: the drag began in Obsidian itself (file explorer), so the layer is up before the pointer reaches the page
  doc.addEventListener('dragstart', arm, true);
  doc.addEventListener('dragenter', arm, true);
  doc.addEventListener('dragend', disarm, true);
  doc.addEventListener('drop', disarm, true);
  drop.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; drop.classList.add('over'); });
  drop.addEventListener('dragleave', e => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('over'); if (!e.relatedTarget) disarm(); });
  drop.addEventListener('drop', async e => {
    e.preventDefault(); e.stopPropagation();
    const dt = e.dataTransfer, files = [...dt.files], hint = dt.getData('text/plain') || dt.getData('text/uri-list') || '';
    disarm();
    if (!wv?.dataset.ready) { note('Claude is still loading. Try again in a moment.'); return; }
    try {
      const items = [];
      for (const f of files) items.push({ name: f.name, type: f.type || mimeOf(f.name), data: await f.arrayBuffer() });
      if (!items.length) {
        const v = await droppedFile(hint).catch(() => null);
        if (v) items.push({ name: v.name, type: mimeOf(v.name), data: v.data });
      }
      if (!items.length) {   // not a file: a piece of text, so put it into the message box
        if (hint.trim()) { wv.focus(); wv.insertText(hint); } else note('Nothing to attach from that drop.');
        return;
      }
      await attach(items, items.length === 1 ? items[0].name : items.length + ' files');
    } catch (err) { console.error('[vault-dashboard] attach failed', err); note('Could not attach that file.'); }
  });

  return {
    show() { host.hidden = false; shown = true; if (!wv && !state) open(); },   // nothing loads until the page is first shown
    hide() { host.hidden = true; shown = false; disarm(); },
    destroy() {
      doc.removeEventListener('dragstart', arm, true); doc.removeEventListener('dragenter', arm, true);
      doc.removeEventListener('dragend', disarm, true); doc.removeEventListener('drop', disarm, true);
      clearTimeout(toastTimer);
      try { wv?.remove(); } catch { /* already gone */ }
      host.remove();
    },
  };
}
