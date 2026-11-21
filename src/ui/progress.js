import { $$, esc } from './util.js';
import { paintDef } from './fx.js';

/* Progress bars ("goals") and rings. Values glide from the previous number to the new one with CSS transitions;
   unchanged data starts at its final value, so refreshes do not replay the animation. */
const mem = new Map();
const RING_R = 34, CIRC = 2 * Math.PI * RING_R;

/** groups: [{label, done, total, pct (0-1), color?}] */
export function drawProgress(host, { id, type, groups, onPick }) {
  host.classList.remove('pg-bars', 'pg-rings');
  host.classList.add('pg', 'pg-' + type);
  if (!groups.length) { host.innerHTML = '<p class="empty">Nothing to show for this filter yet.</p>'; return () => {}; }
  const ringPaint = (g, i) => paintDef(`pr${String(id).replace(/\W/g, '')}${i}`, col(g));
  const prev = g => mem.get(id + '|' + g.label) ?? 0, pct = g => Math.round(g.pct * 100), col = g => g.color || 'var(--y)';
  host.innerHTML = type === 'rings'
    ? `<div class="rings">${groups.map((g, i) => `<div class="ring" data-i="${i}" title="${esc(g.label)}: ${g.done} of ${g.total}">
        <svg viewBox="0 0 80 80" role="img" aria-label="${esc(g.label)} ${pct(g)}%"><defs>${ringPaint(g, i).defs}</defs><circle class="ring-bg" cx="40" cy="40" r="${RING_R}"/>
        <circle class="ring-fg" cx="40" cy="40" r="${RING_R}" style="stroke:${ringPaint(g, i).paint};stroke-dasharray:${CIRC};stroke-dashoffset:${CIRC * (1 - prev(g))}"/>
        <text class="ring-t" x="40" y="46">${pct(g)}%</text></svg><div class="ring-l ell">${esc(g.label)}</div><div class="ring-s">${g.done}/${g.total}</div></div>`).join('')}</div>`
    : `<div class="goals">${groups.map((g, i) => `<div class="goal" data-i="${i}"><div class="goal-h"><span class="ell">${esc(g.label)}</span><b>${pct(g)}%</b></div>
        <div class="pb"><i class="pb-fill" style="width:${prev(g) * 100}%;--pc:${col(g)}"></i></div><div class="goal-s">${g.done} of ${g.total} done</div></div>`).join('')}</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('.pb-fill', host).forEach((el, i) => { el.style.width = groups[i].pct * 100 + '%'; });
    $$('.ring-fg', host).forEach((el, i) => { el.style.strokeDashoffset = CIRC * (1 - groups[i].pct); });
  }));
  groups.forEach(g => mem.set(id + '|' + g.label, g.pct));
  const click = e => { const t = e.target.closest('[data-i]'); if (t && onPick) onPick(groups[+t.dataset.i]); };
  host.addEventListener('click', click);
  return () => host.removeEventListener('click', click);
}
