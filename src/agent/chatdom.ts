// Draws one ChatController into an element. Shared by the Agents sidebar and Spark's speech bubble.
import type { ChatController } from './engine/chat.ts';
import type { ProposalQueue } from './proposals.ts';
import type { Proposal } from './types.ts';
import { summarize } from './summary.ts';
import { md } from '../ui/util.js';

export interface ChatUi { queue?: ProposalQueue; openReview(): void; scrollEl: HTMLElement; onApprove?(): void }

const rendering = new WeakMap<HTMLElement, number>();   // newest render per element, so a slow queue read never paints over a newer render
type Card = { host: HTMLElement; loaded: boolean };
const cardsOf = new WeakMap<HTMLElement, Map<string, Card>>();   // card nodes live across renders: no flicker, no read of the queue per streamed word

/** `refresh` re-reads the queue for every card (call it when the queue changed); otherwise only cards that have never been drawn are read. */
export function renderChat(el: HTMLElement, chat: ChatController, ui: ChatUi, refresh = false): void {
  const token = (rendering.get(el) ?? 0) + 1;
  rendering.set(el, token);
  const sc = ui.scrollEl;
  const atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 40;
  const old = cardsOf.get(el) ?? new Map<string, Card>(), cards = new Map<string, Card>();
  el.empty();
  if (!chat.messages.length) el.createDiv({ cls: 'va-msg va-note', text: chat.agent?.description || 'Ask the agent something.' });
  for (const m of chat.messages) {
    if (m.role === 'proposal') {
      if (!m.id) continue;
      const c = old.get(m.id) ?? { host: el.createDiv({ cls: 'va-msg chat-card' }), loaded: false };
      el.appendChild(c.host);
      cards.set(m.id, c);
      continue;
    }
    const d = el.createDiv({ cls: `va-msg va-${m.role}` });
    if (m.role === 'assistant') d.innerHTML = md(m.text);   // md() sanitises with DOMPurify
    else d.setText(m.text);
  }
  cardsOf.set(el, cards);
  if (chat.busy) el.createDiv({ cls: 'va-msg va-note va-busy', text: 'Thinking…' });
  if (atBottom) sc.scrollTop = sc.scrollHeight;
  const todo = [...cards].filter(([, c]) => refresh || !c.loaded);
  if (todo.length && ui.queue) void fillCards(el, token, todo, chat, ui, ui.queue, atBottom);
}

async function fillCards(el: HTMLElement, token: number, todo: [string, Card][], chat: ChatController, ui: ChatUi, queue: ProposalQueue, atBottom: boolean) {
  let all: Proposal[];
  try { all = await queue.list(); } catch { return; }
  if (rendering.get(el) !== token) return;
  for (const [id, c] of todo) { drawCard(c.host, all.find(p => p.id === id), chat, ui, queue); c.loaded = true; }
  if (atBottom) ui.scrollEl.scrollTop = ui.scrollEl.scrollHeight;   // the cards grew after the first scroll
}

function drawCard(host: HTMLElement, p: Proposal | undefined, chat: ChatController, ui: ChatUi, queue: ProposalQueue, err?: string) {
  host.empty();
  if (!p) { host.createDiv({ cls: 'chat-card-state', text: 'No longer in the queue' }); return; }
  const s = summarize(p);
  host.createDiv({ cls: 'chat-card-title', text: s.title });
  if (s.detail) host.createDiv({ cls: 'chat-card-detail', text: s.detail });
  host.createDiv({ cls: `chat-card-state chat-card-${p.status}`, text: s.state });
  if (err) host.createDiv({ cls: 'chat-card-state chat-card-failed', text: err });
  if (s.final) return;
  const row = host.createDiv({ cls: 'chat-card-actions' });
  const approve = row.createEl('button', { text: 'Approve', cls: 'mod-cta' });
  const reject = row.createEl('button', { text: 'Reject' });
  const diff = row.createEl('button', { text: 'See full diff' });
  const run = (act: () => Promise<void>) => async () => {
    approve.disabled = reject.disabled = diff.disabled = true;
    let err: string | undefined;
    try { await act(); } catch (e: any) { err = String(e?.message ?? e); }
    try { drawCard(host, (await queue.list()).find(x => x.id === p.id), chat, ui, queue, err); } catch { /* next render will redraw */ }
  };
  approve.onclick = run(async () => { await queue.approve(p.id); ui.onApprove?.(); });
  reject.onclick = run(() => queue.reject(p.id));
  diff.onclick = () => ui.openReview();
}
