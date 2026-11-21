// Spark: a pixel helper along the bottom of the window. Click it for a speech-bubble chat with any agent.
// This file is the thin DOM layer: a ~10 fps timer feeds time and events into the brain (brain.ts) and draws its answer.
import { Menu } from 'obsidian';
import type { Agents } from '../agent/wire.ts';
import type { AgentDef } from '../agent/engine/types.ts';
import { ENGINE_LABEL } from '../agent/engine/types.ts';
import type { ChatController } from '../agent/engine/chat.ts';
import { lazyChat } from '../agent/lazychat.ts';
import { renderChat } from '../agent/chatdom.ts';
import { sparkSvg, outlined } from './sprite.ts';
import { frameRows } from './frames.ts';
import { frameAt } from './animate.ts';
import { createBrain, MIN_X, EDGE, TOP_EDGE } from './brain.ts';
import { canSayQuote, quoteDelay, QUOTE_SHOW_MS } from './quotes.ts';
import type { QuoteEvery } from './quotes.ts';
import type { SparkEvent, SparkMode, SparkState } from './brain.ts';
import type { SparkHandle } from './host.ts';
import { reduced } from '../ui/util.js';

export { sparkHost } from './host.ts';
export type { SparkHandle } from './host.ts';

export type OutlineKey = 'white' | 'black' | 'orange' | 'none';
export const OUTLINES: { key: OutlineKey; label: string; color: string | null }[] = [
  { key: 'white', label: 'White', color: '#ffffff' }, { key: 'black', label: 'Black', color: '#000000' },
  { key: 'orange', label: 'Orange', color: '#ff9d3c' }, { key: 'none', label: 'None', color: null },
];
export interface SparkSaved { mode: SparkMode; x: number; y?: number; outline?: OutlineKey }
const QUOTE_RETRY_MS = 30_000, HINT_MS = 12_000, TICK_MS = 100, SAVE_MS = 2000, DRAG_PX = 5, SIZE = 56, BUBBLE_W = 340, SPRITE_H = 52, ROOM_ABOVE = 240;

export function createSpark(doc: Document, deps: {
  agents: Agents; openReview(): void; hide(): void; initial?: Partial<SparkSaved>; saveSpark(s: SparkSaved): void;
  /** Random comments from RANDOM WORDS.csv (see quotes.ts). */
  quotes?: { next(): string | null; enabled(): boolean; every(): QuoteEvery };
}): SparkHandle {
  const win = doc.defaultView ?? window;
  const { agents } = deps;
  const root = doc.body.createDiv({ cls: 'spark-root' });
  const anchor = root.createDiv({ cls: 'spark-anchor' });

  const bubble = anchor.createEl('section', { cls: 'spark-bubble', attr: { 'aria-label': 'Chat with an agent' } });
  bubble.hidden = true;
  const head = bubble.createDiv({ cls: 'spark-head' });
  const select = head.createEl('select', { cls: 'dropdown spark-agent', attr: { 'aria-label': 'Agent' } });
  const fresh = head.createEl('button', { text: 'New chat', cls: 'spark-new' });
  const close = head.createEl('button', { text: '×', cls: 'spark-close', attr: { 'aria-label': 'Close chat' } });
  const list = bubble.createDiv({ cls: 'va-list spark-list', attr: { 'aria-live': 'polite' } });
  const input = bubble.createEl('textarea', { cls: 'va-input spark-input', attr: { rows: '2', placeholder: 'Message the agent… (Enter to send)' } });

  const hint = anchor.createDiv({ cls: 'spark-hint' });
  hint.hidden = true;
  const tail = anchor.createDiv({ cls: 'spark-tail', attr: { 'aria-hidden': 'true' } });   // the pixel tail of whichever bubble is showing
  tail.hidden = true;
  // A div, not a button: Obsidian's button styling would draw a box behind the sprite.
  const me = anchor.createDiv({ cls: 'spark-me', attr: { role: 'button', tabindex: '0', 'aria-label': 'Spark — open chat' } });

  let open = false, dead = false, chat: ChatController | null = null, agentList: AgentDef[] = [];
  let raf = 0, wasBusy = false;

  // ---- brain + drawing ----
  const width = () => win.innerWidth;
  // Space above the ground line (the viewport top to Spark's feet): Spark's y is clamped into it.
  const ground = () => Math.max(0, root.getBoundingClientRect().bottom || win.innerHeight);
  const startMode = deps.initial?.mode ?? 'roam';
  const brain = createBrain({ x: deps.initial?.x ?? width() - 72, y: startMode === 'roam' ? 0 : deps.initial?.y ?? 0, mode: startMode, width: width(), height: win.innerHeight });
  let outline: OutlineKey = OUTLINES.some(o => o.key === deps.initial?.outline) ? deps.initial!.outline! : 'white';
  const send = (e: SparkEvent) => { if (!dead) brain.on(e); };
  let cursorX = width() / 2, drag: { x: number; y: number } | null = null;
  let shown = '', shownPose = '', hintCount = 0, hintSince = 0, poseSince = Date.now(), lastTick = Date.now();
  // random comments: when the next one is due, and the one on screen
  let lastTyped = 0, quote = '', quoteUntil = 0, nextQuoteAt = Date.now() + quoteDelay(deps.quotes?.every() ?? 'normal');
  const snapOf = () => { const s = brain.state(); return JSON.stringify({ mode: s.mode, x: s.mode === 'roam' ? 0 : Math.round(s.x), y: Math.round(s.y), outline }); };
  let saved = snapOf(), lastSave = 0;   // what is already stored

  const draw = (s: SparkState, now: number) => {
    if (s.pose !== shownPose) { shownPose = s.pose; poseSince = now; }
    const frame = frameAt(s.pose, now - poseSince, reduced());   // reduced motion: poses change, nothing loops
    if (s.hint !== hintCount) { hintCount = s.hint; hintSince = now; }
    const hintOn = s.hint > 0 && !open && now - hintSince < HINT_MS;   // the speech box fades away so it never lingers over the editor
    const x = Math.round(drag?.x ?? s.x), y = Math.round(drag?.y ?? s.y);
    const quoteOn = !hintOn && !open && !!quote && now < quoteUntil;
    const key = `${s.pose}|${frame}|${x}|${y}|${outline}|${s.facing}|${hintOn}|${open}|${quoteOn ? quote : ''}`;
    if (key === shown) return;
    shown = key;
    me.innerHTML = sparkSvg(outlined(frameRows(s.pose, frame)), 4, OUTLINES.find(o => o.key === outline)?.color ?? null);   // our own constant SVG, no user text
    anchor.style.setProperty('--spark-x', `${x}px`);
    anchor.style.setProperty('--spark-y', `${-y}px`);
    me.style.setProperty('--spark-facing', String(s.facing));
    // The bubble opens left of Spark, or right of it near the left edge (or when there is no room on the left).
    anchor.classList.toggle('spark-right', x < width() / 3 || x + SIZE < BUBBLE_W + 8);
    anchor.classList.toggle('spark-below', ground() - y - SPRITE_H < ROOM_ABOVE);   // near the top the bubbles open downwards
    hint.toggleClass('spark-quote', quoteOn);
    if (hintOn) { hint.setText(`${s.hint} change${s.hint > 1 ? 's' : ''} need${s.hint > 1 ? '' : 's'} your OK`); hint.hidden = false; }
    else if (quoteOn) { hint.setText(quote); hint.hidden = false; }   // setText: the file's text is never parsed as HTML
    else hint.hidden = true;
    tail.hidden = hint.hidden && bubble.hidden;
  };

  const persist = (force: boolean, now: number) => {
    const s = brain.state(), snap = snapOf();
    if (!force && (snap === saved || now - lastSave < SAVE_MS)) return;
    saved = snap; lastSave = now;
    deps.saveSpark({ mode: s.mode, x: Math.round(s.x), y: Math.round(s.y), outline });   // while roaming only the mode matters; x is kept for the next start
  };

  const tick = () => {
    if (dead) return;
    const now = Date.now(), dt = now - lastTick; lastTick = now;
    const s = brain.tick(dt, { width: width(), height: ground(), cursorX, reduced: reduced(), bubbleOpen: open });
    maybeQuote(s, now);
    draw(s, now);
    persist(false, now);
  };
  const say = (now: number): boolean => {
    const text = deps.quotes?.next() ?? null;
    if (!text) return false;
    quote = text; quoteUntil = now + QUOTE_SHOW_MS;
    return true;
  };
  const maybeQuote = (s: SparkState, now: number) => {
    const q = deps.quotes;
    if (!q || !q.enabled() || now < nextQuoteAt) return;
    if (!canSayQuote({ pose: s.pose, mode: s.mode, hint: s.hint, chatOpen: open, typedAgoMs: now - lastTyped })) { nextQuoteAt = now + QUOTE_RETRY_MS; return; }
    say(now);
    nextQuoteAt = now + quoteDelay(q.every());
  };
  // The timer only runs while Obsidian is visible: minimised or in the background, Spark costs nothing.
  let timer = 0;
  const resume = () => { if (!timer && !doc.hidden && !dead) { lastTick = Date.now(); timer = win.setInterval(tick, TICK_MS); } };
  const pause = () => { if (timer) { win.clearInterval(timer); timer = 0; } };
  const onVisibility = () => { if (doc.hidden) pause(); else { resume(); tick(); } };
  doc.addEventListener('visibilitychange', onVisibility);
  resume();
  tick();
  send({ type: 'start' });

  // Sit 16px above the status bar, whatever its height.
  const place = () => { const sb = doc.querySelector('.status-bar')?.getBoundingClientRect().height ?? 0; root.style.setProperty('--spark-bottom', `${Math.round(sb) + 16}px`); };
  place();
  win.addEventListener('resize', place);   // the next tick clamps Spark into the new width

  // ---- events: typing, cursor ----
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof Node && root.contains(e.target)) return;
    lastTyped = Date.now(); quoteUntil = 0;   // a comment on screen goes away as soon as you type
    send({ type: 'typing' });
  };
  const onMove = (e: PointerEvent) => { cursorX = e.clientX; };
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('pointermove', onMove, { passive: true });

  // ---- chat ----
  let refresh = false;   // the queue changed: re-read the cards
  const render = () => {
    raf = 0; const r = refresh; refresh = false;
    if (chat && open) renderChat(list, chat, { queue: agents.queue, openReview: seenReview, scrollEl: list, onApprove: () => send({ type: 'approved' }) }, r);
  };
  const schedule = () => { if (!raf) raf = win.requestAnimationFrame(render); };

  const onChatChange = () => {
    schedule();
    const busy = !!chat?.busy;
    if (busy === wasBusy) return;
    wasBusy = busy;
    send({ type: 'busy', on: busy });
    if (!busy && !open) send({ type: 'reply' });   // an answer arrived while the chat is closed
  };

  const pick = (name: string) => {
    const a = agentList.find(x => x.name === name);
    if (!a) return;
    chat?.stop();
    chat = lazyChat(agents);
    chat.onChange = onChatChange;
    chat.start(a);
    onChatChange();
  };

  const loadAgents = async () => {
    try { agentList = await agents.catalog(); } catch { agentList = []; }
    if (dead) return;
    const keep = select.value;
    select.empty();
    for (const a of agentList) select.createEl('option', { text: `${a.name} · ${ENGINE_LABEL[a.engine]}`, value: a.name, attr: { title: a.warning ?? a.description } });
    input.disabled = !agentList.length;
    if (!agentList.length) { list.empty(); list.createDiv({ cls: 'va-msg va-note', text: 'No agents yet. Add a file to .claude/agents/.' }); return; }
    const c = agentList.find(x => x.name === keep) ?? agentList.find(x => x.name === 'secretary') ?? agentList[0];
    select.value = c.name;
    if (!chat?.agent || chat.agent.name !== c.name || chat.agent.engine !== c.engine) pick(c.name);
    refresh = true; schedule();
  };

  const seenReview = () => { send({ type: 'newsSeen' }); deps.openReview(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) setOpen(false); };
  const setOpen = (v: boolean) => {
    open = v; bubble.hidden = !v; tail.hidden = !v && hint.hidden;
    if (v) { send({ type: 'newsSeen' }); doc.addEventListener('keydown', onKey); void loadAgents().then(() => { render(); if (open && !dead) input.focus(); }); }
    else doc.removeEventListener('keydown', onKey);
    tick();
  };

  // ---- pointer: click opens the chat, a drag of 5px or more moves Spark ----
  let press: { id: number; sx: number; sy: number; gx: number; gb: number } | null = null, justDragged = false;
  me.addEventListener('mousedown', e => e.preventDefault());   // never steal focus from the note being written
  me.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    justDragged = false;
    const r = anchor.getBoundingClientRect();   // where on Spark it was grabbed: left and bottom offsets
    press = { id: e.pointerId, sx: e.clientX, sy: e.clientY, gx: e.clientX - r.left, gb: r.bottom - e.clientY };
    try { me.setPointerCapture(e.pointerId); } catch { /* best effort */ }
  });
  me.addEventListener('pointermove', e => {
    if (!press || e.pointerId !== press.id) return;
    if (drag === null) {
      if (Math.hypot(e.clientX - press.sx, e.clientY - press.sy) < DRAG_PX) return;
      send({ type: 'dragStart' });
    }
    drag = {
      x: Math.min(Math.max(MIN_X, e.clientX - press.gx), Math.max(MIN_X, width() - EDGE)),
      y: Math.min(Math.max(0, ground() - TOP_EDGE), Math.max(0, ground() - e.clientY - press.gb)),
    };
    tick();
  });
  const endPress = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    press = null;
    if (drag !== null) {
      justDragged = true;
      send({ type: 'dragEnd', x: drag.x, y: drag.y });
      drag = null;
      persist(true, Date.now());
      tick();
    }
  };
  me.addEventListener('pointerup', endPress);
  me.addEventListener('pointercancel', endPress);
  me.onclick = () => { if (justDragged) { justDragged = false; return; } setOpen(!open); };
  me.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } });

  me.addEventListener('contextmenu', e => {
    e.preventDefault();
    const menu = new Menu(), mode = brain.state().mode;
    const set = (m: SparkMode) => { send({ type: 'mode', mode: m }); persist(true, Date.now()); tick(); };
    menu.addItem(i => i.setTitle('Sit here').setIcon('map-pin').onClick(() => set('sit')));
    menu.addItem(i => i.setTitle('Roam').setIcon('footprints').onClick(() => set('roam')));
    if (mode === 'sleep') menu.addItem(i => i.setTitle('Wake up').setIcon('sun').onClick(() => set('roam')));
    else menu.addItem(i => i.setTitle('Go to sleep').setIcon('moon').onClick(() => set('sleep')));
    for (const o of OUTLINES) menu.addItem(i => i.setTitle(`Outline: ${o.label}`).setChecked(o.key === outline).onClick(() => { outline = o.key; persist(true, Date.now()); tick(); }));
    menu.addItem(i => i.setTitle('Hide Spark').setIcon('eye-off').onClick(() => deps.hide()));
    menu.showAtMouseEvent(e);
  });

  close.onclick = () => setOpen(false);
  fresh.onclick = () => chat?.newChat();
  select.onchange = () => pick(select.value);
  select.onfocus = () => { void loadAgents(); };
  input.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const t = input.value; input.value = ''; chat?.send(t); }
  };
  hint.onclick = () => { if (hint.hasClass('spark-quote')) { quoteUntil = 0; tick(); } else seenReview(); };

  // The queue is read once so Spark does not run for changes that were already waiting when Obsidian opened.
  void agents.queue.list('pending').then(l => { if (dead) return; send({ type: 'pending', count: l.length }); send({ type: 'newsSeen' }); }).catch(() => {});
  const off = agents.onPending(n => {
    if (dead) return;
    send({ type: 'pending', count: n });
    if (open) { refresh = true; schedule(); }   // cards follow the queue
  });

  return {
    say() { const ok = say(Date.now()); tick(); return ok; },
    destroy() {
      persist(true, Date.now());
      dead = true;
      chat?.stop(); chat = null;
      pause();
      doc.removeEventListener('visibilitychange', onVisibility);
      if (raf) win.cancelAnimationFrame(raf);
      win.removeEventListener('resize', place);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('keydown', onKey);
      off();
      root.remove();
    },
  };
}
