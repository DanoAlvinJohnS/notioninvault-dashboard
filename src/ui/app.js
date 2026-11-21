import { $, $$, esc } from './util.js';
import { api, setService } from './api.js';
import { S, hooks, setData } from './state.js';
import { dashboard, dashboardSkeleton, initDashboard, cleanupDashboard, leaveDashboard, releaseCanvas } from './dashboard.js';
import { startCanvas, stopCanvas } from './canvasdata.js';
import { mountBackground, refreshBackground } from './background.js';
import { settingsPage } from './settingspage.js';
import { mountScrollFx } from './scrollfx.js';
import { adoptTheme, getTheme, isDirty, revertTheme } from './layout.js';
import { applyTheme, clearTheme } from './theme.js';
import { openNote, openFolder, openCanvas, refreshDrawer } from './drawer.js';
import { openNewTask } from './newtask.js';
import { mountChat } from './chat.js';
import { reviewPage } from './review.js';

const SKELETON = `<div class="vd-bg"></div><div class="vd-fx" aria-hidden="true"></div><div class="vd-scroll"><div class="app">
  <main id="main"></main>
</div></div>
<header class="dock">
  <nav class="dock-nav" aria-label="Pages">
      <button data-v="overview" data-tip="Overview" aria-label="Overview" class="on" aria-current="page"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg></button>
      <button data-v="chat" data-tip="Claude" aria-label="Claude"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>
      <button data-v="review" data-tip="Review" aria-label="Review"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg><span class="dock-badge" hidden></span></button>
      <button data-v="customize" data-tip="Customize" aria-label="Customize"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg></button>
      <button data-v="settings" data-tip="Settings" aria-label="Settings"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button>
  </nav>
  <span class="dock-sep" aria-hidden="true"></span>
  <button class="primary" id="newBtn" data-tip="New task" aria-label="New task"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button>
  <span class="dock-stat" data-state="wait" tabindex="0"><span class="sync" id="sync" role="status">Connecting…</span></span>
</header>
<aside class="drawer" id="drawer" aria-label="Details"></aside>
<dialog id="dlg"></dialog>
<datalist id="titles"></datalist>
<input type="file" id="bg-file" hidden>`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Mounts the dashboard into `root` (an Obsidian view's contentEl). Returns a cleanup function. */
export function mountApp(root, svc) {
  setService(svc);
  hooks.globalTheme = true;   // shows the "apply to all of Obsidian" switch in the theme editor
  root.classList.add('vd-root');
  root.innerHTML = SKELETON;
  let ver = '', busy = false, ready = false, booted = false, shown = null, stopFx = null, swapTimer = 0, syncTimer = 0;
  const chat = mountChat(root);
  /** The status dot at the end of the dock: its text appears as a tooltip. state = ok | wait | bad */
  const say = (text, state) => { const el = $('#sync', root); el.textContent = text; el.parentElement.dataset.state = state; };

  /** Draws the page that S.view names. Before the vault has been read, Overview and Customize show skeleton bubbles. */
  function render() {
    $$('.dock-nav button', root).forEach(b => { const on = b.dataset.v === S.view; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const changed = shown !== S.view;
    if (changed) { cleanupDashboard(); leaveDashboard(); }
    shown = S.view;
    root.dataset.page = S.view;
    $('#main').dataset.view = S.view;
    if (S.view === 'chat') { chat.show(); return; }   // claude.ai lives outside the scrolling page and stays loaded
    chat.hide();
    if (S.view === 'review') reviewPage();
    else if (S.view === 'settings') settingsPage({ enter: changed });
    else if (!S.data) dashboardSkeleton();
    else dashboard(S.view === 'customize');
  }
  /** Switching pages: the headings rise in and the page starts at the top. */
  function go(view) {
    if (S.view === view) return;
    if (S.view === 'settings' && isDirty()) {   // a preview that was never applied goes away when you leave
      applyTheme(revertTheme());
      say('Unapplied settings were discarded', 'wait');
      clearTimeout(syncTimer); syncTimer = setTimeout(() => say('Synced with vault', 'ok'), 3500);
    }
    S.view = view;
    const main = $('#main'); main.classList.add('swap');
    clearTimeout(swapTimer); swapTimer = setTimeout(() => main.classList.remove('swap'), 800);
    $('.vd-scroll').scrollTop = 0;
    render();
  }

  async function load() {
    const first = !ready;
    if (!booted) {
      booted = true;
      await initDashboard();              // the saved layout and theme first, so the skeleton already has your look
      applyTheme(getTheme());
      mountBackground();
      stopFx = mountScrollFx(root);
      hooks.canvasChanged = () => { if (S.view === 'overview' && S.data && !releaseCanvas()) render(); refreshDrawer(); };
      startCanvas();                      // Canvas loads alongside the vault, not after it
      refreshBackground().catch(e => console.error('[vault-dashboard]', e));
      render();                           // layout appears at once as skeleton bubbles
    }
    const v = (await api('/api/version')).version;   // read first, so a change during the fetch is caught next tick
    const [index] = await Promise.all([api('/api/index'), first && getTheme().anim !== 'off' ? sleep(450) : null]);   // let the skeleton be seen, not flash
    setData(index);
    ready = true;
    await refreshBackground();
    ver = v;
    $('#titles').innerHTML = S.data.notes.map(n => `<option value="${esc(n.title)}">`).join('');
    say('Synced with vault', 'ok');
    // the Overview is rebuilt on every change in the vault; the other pages are left alone while you work in them
    if (first || S.view === 'overview') render();
    refreshDrawer();
  }

  Object.assign(hooks, {
    adoptTheme: t => { adoptTheme(t); applyTheme(getTheme()); hooks.bgChanged?.(); render(); },
    openGraph: () => svc.openGraph(), render, reload: load, openNote, openFolder, openCanvas, newTask: openNewTask, busy: v => { busy = v; },
    openTheme: () => go('settings'),
    openReview: () => go('review'),
    /** Called by the agent queue with the number of pending proposals. */
    reviewChanged: n => { badge(n); if (S.view === 'review') reviewPage(); },
    bgChanged: () => { if (S.view === 'settings') settingsPage({ enter: false }); },
  });
  const badge = n => { const el = $('.dock-badge', root); if (!el) return; el.textContent = n > 99 ? '99+' : String(n); el.hidden = !n; };
  if (svc.queue) svc.queue.list('pending').then(p => badge(p.length)).catch(() => {});
  $$('.dock-nav button', root).forEach(b => b.onclick = () => go(b.dataset.v));
  $('#newBtn').onclick = () => openNewTask();

  load().catch(e => { say('Could not read the vault', 'bad'); console.error('[vault-dashboard]', e); });
  /* Vault changes are picked up once they settle: typing in a note bumps the version on every keystroke, and re-reading the
     vault and redrawing every widget each second while you type is what made Obsidian stutter. Nothing runs while the dashboard
     tab is out of sight (or the Claude page is open); the change is picked up as soon as the Overview is shown again. */
  const QUIET = 1200;
  let seen = '', since = 0, loading = false;
  const timer = setInterval(async () => {
    if (loading || document.hidden || busy || S.view === 'chat' || $('#dlg').open || root.checkVisibility?.() === false) return;
    try {
      const v = (await api('/api/version')).version;
      if (v === ver) return;
      if (v !== seen) { seen = v; since = Date.now(); return; }   // still changing
      if (Date.now() - since < QUIET) return;
      loading = true; await load();
    } catch (e) { say('Could not read the vault', 'bad'); console.error('[vault-dashboard]', e); }
    finally { loading = false; }
  }, 400);

  return () => { chat.destroy(); clearInterval(timer); clearTimeout(swapTimer); clearTimeout(syncTimer); if (isDirty()) revertTheme(); stopFx?.(); stopCanvas(); cleanupDashboard(); leaveDashboard(); root.classList.remove('vd-root', 'has-bg'); delete root.dataset.page; clearTheme(root); hooks.openTheme = hooks.adoptTheme = hooks.bgChanged = hooks.canvasChanged = hooks.openReview = hooks.reviewChanged = null; root.innerHTML = ''; };
}
