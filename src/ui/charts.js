import { esc, reduced } from './util.js';
import { paintDef, fxMode } from './fx.js';

/* Animated SVG charts (bar, horizontal bar, line, pie, donut). No library: every frame is redrawn from interpolated values,
   so the same code runs in the browser dashboard and inside Obsidian. */
/* Colours are CSS variable references (not resolved values), so a recoloured theme or a running colour effect reaches the SVG without a redraw. */
const palette = () => ['var(--o)', 'var(--y)', 'var(--g)', '#4aa3ff', 'var(--r)', '#b58cff', '#35d0c6', '#ff8fc7'];
const DUR = 650, STAGGER = 55, SWEEP = 950;
const ease = t => 1 - Math.pow(1 - t, 3);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const trunc = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
const nice = v => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
const mem = new Map();   // widget id -> last drawn values, so unchanged data does not replay the animation

const text = (x, y, s, cls = 'ct', anchor = 'middle') => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s)}</text>`;
const pt = (cx, cy, r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

function smooth(p) {   // Catmull-Rom spline -> cubic Béziers
  if (p.length < 2) return '';
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] || p[i], b = p[i], c = p[i + 1], e = p[i + 2] || c;
    d += `C${b[0] + (c[0] - a[0]) / 6},${b[1] + (c[1] - a[1]) / 6} ${c[0] - (e[0] - b[0]) / 6},${c[1] - (e[1] - b[1]) / 6} ${c[0]},${c[1]}`;
  }
  return d;
}
function arc(cx, cy, R, r, a0, a1) {
  if (a1 - a0 < 0.0005) return '';
  a1 = Math.min(a1, a0 + Math.PI * 2 - 0.0005);
  const big = a1 - a0 > Math.PI ? 1 : 0, [x0, y0] = pt(cx, cy, R, a0), [x1, y1] = pt(cx, cy, R, a1);
  if (!r) return `M${cx},${cy}L${x0},${y0}A${R},${R} 0 ${big} 1 ${x1},${y1}Z`;
  const [x2, y2] = pt(cx, cy, r, a1), [x3, y3] = pt(cx, cy, r, a0);
  return `M${x0},${y0}A${R},${R} 0 ${big} 1 ${x1},${y1}L${x2},${y2}A${r},${r} 0 ${big} 0 ${x3},${y3}Z`;
}

/** Usable size of a host: its box minus padding (otherwise the svg overflows and the host starts scrolling). */
function inner(host) {
  const cs = getComputedStyle(host), px = k => parseFloat(cs[k]) || 0;
  return [host.clientWidth - px('paddingLeft') - px('paddingRight'), host.clientHeight - px('paddingTop') - px('paddingBottom')];
}

/** data: [{label, value, color?}].  Returns a function that stops animations and listeners. */
export function drawChart(host, { id, type, data, onPick, center }) {
  host._stop?.();
  host.classList.add('ch'); host.classList.remove('pie', 'side', 'stack', 'clk');   // add/remove, never overwrite: the host is the widget body
  if (!data.length) { host.innerHTML = '<p class="empty">Nothing to chart yet.</p>'; host._stop = null; return () => {}; }

  const n = data.length, to = data.map(d => d.value), labels = data.map(d => d.label), pie = type === 'pie' || type === 'donut';
  const prev = mem.get(id), sameType = prev?.type === type;
  const from = sameType ? labels.map(l => prev.values[l] ?? 0) : to.map(() => 0);
  const unchanged = sameType && Object.keys(prev.values).length === n && labels.every((l, i) => prev.values[l] === to[i]);
  mem.set(id, { type, values: Object.fromEntries(labels.map((l, i) => [l, to[i]])) });
  const total = to.reduce((a, b) => a + b, 0) || 1, max = nice(Math.max(...to, 1));
  const PALETTE = palette();
  const color = (d, i) => d.color || (pie ? PALETTE[i % PALETTE.length] : PALETTE[0]);
  const tipText = i => `${labels[i]}: ${to[i]}${pie ? ` (${Math.round(to[i] / total * 100)}%)` : ''}`;
  let [W, H] = inner(host);
  const base = 'c' + String(id).replace(/\W/g, '');
  let fdefs = '';   // gradient paints for the colour effect, collected while a frame is drawn
  const fill = (k, c, o) => { const p = paintDef(base + k, c, o); fdefs += p.defs; return p.paint; };

  const gridLines = m => [0, .5, 1].map(f => { const y = m.t + (H - m.t - m.b) * (1 - f); return `<line class="cg" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>${text(m.l - 6, y + 4, Math.round(max * f), 'ct', 'end')}`; }).join('');

  function bars(v) {
    const m = { l: 34, r: 8, t: 16, b: 28 }, iw = W - m.l - m.r, ih = Math.max(40, H - m.t - m.b), band = iw / n, bw = Math.min(48, band * .62);
    let s = gridLines(m);
    data.forEach((d, i) => {
      const h = ih * v[i] / max, x = m.l + band * i + (band - bw) / 2, y = m.t + ih - h;
      s += `<rect class="cb" data-i="${i}" data-tip="${esc(tipText(i))}" x="${x}" y="${y}" width="${bw}" height="${Math.max(0, h)}" rx="5" fill="${fill('b' + i, color(d, i))}"/>`;
      if (bw >= 16 && v[i] >= .5) s += text(x + bw / 2, y - 5, Math.round(v[i]), 'cv');
      s += text(m.l + band * i + band / 2, H - 9, trunc(labels[i], Math.floor(band / 6.4)));
    });
    return s;
  }
  function hbars(v) {
    const lab = Math.min(Math.max(...labels.map(l => l.length)) * 6.4 + 12, W * .45), m = { l: lab, r: 40, t: 6, b: 6 };
    const iw = Math.max(20, W - m.l - m.r), row = (H - m.t - m.b) / n, bh = Math.min(22, row * .62);
    return data.map((d, i) => {
      const y = m.t + row * i + (row - bh) / 2, w = iw * v[i] / max;
      return text(m.l - 8, y + bh / 2 + 4, trunc(labels[i], Math.floor((lab - 12) / 6.2)), 'ct', 'end')
        + `<rect class="cb" data-i="${i}" data-tip="${esc(tipText(i))}" x="${m.l}" y="${y}" width="${Math.max(0, w)}" height="${bh}" rx="5" fill="${fill('h' + i, color(d, i))}"/>`
        + text(m.l + w + 6, y + bh / 2 + 4, Math.round(v[i]), 'cv', 'start');
    }).join('');
  }
  function lines(v) {
    const m = { l: 34, r: 14, t: 16, b: 28 }, iw = W - m.l - m.r, ih = Math.max(40, H - m.t - m.b), base = m.t + ih, c = PALETTE[0], gid = 'g' + String(id).replace(/\W/g, '');
    const lp = fill('line', c, { box: { x: m.l, y: m.t, w: iw, h: ih } });
    const pts = v.map((val, i) => [m.l + (n > 1 ? iw * i / (n - 1) : iw / 2), base - ih * val / max]);
    let s = gridLines(m) + `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>`;
    if (n > 1) s += `<path d="${smooth(pts)}L${pts[n - 1][0]},${base}L${pts[0][0]},${base}Z" fill="url(#${gid})"/><path d="${smooth(pts)}" fill="none" stroke="${lp}" stroke-width="2.5" stroke-linecap="round"/>`;
    pts.forEach(([x, y], i) => {
      s += `<circle class="cb cp" data-i="${i}" data-tip="${esc(tipText(i))}" cx="${x}" cy="${y}" r="4.5" fill="${lp}"/>`;
      if (n <= 8 || i % 2 === 0) s += text(x, H - 9, trunc(labels[i], Math.floor(iw / n / 6.4)));
    });
    return s;
  }
  /* Modern donut / pie: rounded, gapped slices with a soft gradient; hovering a slice (or a legend row) lifts it,
     dims the others and swaps the centre text to that slice. */
  const gid = 'p' + String(id).replace(/\W/g, '');
  const centre = { big: center?.text ?? String(total === 1 && !to.some(Boolean) ? 0 : total), sub: center?.sub ?? 'total' };
  function pies(v, sweep) {
    const side = W >= 380, aw = side ? W * .5 : W, ah = side ? H : Math.max(80, H * .62);
    const R = Math.max(24, Math.min(aw, ah) / 2 - 10), cx = aw / 2, cy = ah / 2, donut = type === 'donut';
    const th = R * .3, Rm = R - th / 2, sum = v.reduce((x, y) => x + y, 0) || 1, gap = Math.min(.06, .6 / n);
    let a = 0, defs = '', shapes = '';
    data.forEach((d, i) => {
      const span = v[i] / sum * Math.PI * 2 * sweep, c = color(d, i); let a0 = a + gap / 2, a1 = a + span - gap / 2; a += span;
      if (span < .004) return;
      const pf = fxMode() !== 'off' ? paintDef(gid + i, c) : null;   // colour effect: its gradient replaces the soft default one
      defs += pf ? pf.defs : `<linearGradient id="${gid}${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".7"/></linearGradient>`;
      const ref = pf ? pf.paint : `url(#${gid}${i})`;
      if (donut) {
        const cap = th / 2 / Rm; a0 += cap; a1 = Math.max(a0 + .001, a1 - cap);          // round caps stick out by half the thickness, so trim the arc
        const [x0, y0] = pt(cx, cy, Rm, a0), [x1, y1] = pt(cx, cy, Rm, a1);
        shapes += `<path class="ch-ring" data-i="${i}" data-tip="${esc(tipText(i))}" style="--w:${th}" d="M${x0},${y0}A${Rm},${Rm} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}" stroke="${ref}"/>`;
      } else {
        const mid = (a0 + a1) / 2, e = a1 > a0 ? a1 : a0 + .001;
        shapes += `<path class="ch-wedge" data-i="${i}" data-tip="${esc(tipText(i))}" style="--dx:${Math.sin(mid) * 7}px;--dy:${-Math.cos(mid) * 7}px" d="${arc(cx, cy, R - 5, 0, a0, e)}" fill="${ref}" stroke="${c}"/>`;
      }
    });
    const mid = donut ? text(cx, cy + 2, centre.big, 'cbig') + text(cx, cy + 22, centre.sub, 'csub') : '';
    const legend = `<ul class="ch-leg">${data.map((d, i) => `<li data-i="${i}"><i style="--pc:${color(d, i)};background:var(--pc)"></i><span class="ell">${esc(labels[i])}</span><b>${to[i]}</b><em>${Math.round(to[i] / total * 100)}%</em></li>`).join('')}</ul>`;
    return { side, html: `<svg width="${aw}" height="${ah}" viewBox="0 0 ${aw} ${ah}"><defs>${defs}</defs>${shapes}${mid}</svg>${legend}` };
  }

  function render(ms) {
    [W, H] = inner(host);
    if (W < 40 || H < 40) return;
    const v = pie && !sameType ? to : to.map((t, i) => from[i] + (t - from[i]) * ease(clamp((ms - i * STAGGER) / DUR)));
    let html;
    host.classList.remove('pie', 'side', 'stack');
    if (pie) { const p = pies(v, sameType ? 1 : ease(clamp(ms / SWEEP))); host.classList.add('pie', p.side ? 'side' : 'stack'); html = p.html; }
    else { fdefs = ''; const body = (type === 'bar' ? bars : type === 'line' ? lines : hbars)(v); html = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${fdefs}</defs>${body}</svg>`; }
    host.innerHTML = html + '<div class="ch-tip" hidden></div>';
    if (onPick) host.classList.add('clk');
  }

  let raf = 0, animating = false;
  const total_ms = Math.max(DUR + STAGGER * (n - 1), pie && !sameType ? SWEEP : 0);
  if (unchanged || reduced()) render(Infinity);
  else {
    render(0); animating = true;
    const t0 = performance.now();
    const tick = now => { const ms = Math.max(0, now - t0); if (ms >= total_ms) { animating = false; render(Infinity); return; } render(ms); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }

  const onMove = e => {
    const t = e.target.closest?.('[data-tip]'), tp = host.querySelector('.ch-tip');
    if (!tp) return;
    if (!t) { tp.hidden = true; return; }
    const r = host.getBoundingClientRect();
    tp.textContent = t.dataset.tip; tp.hidden = false;
    tp.style.left = Math.min(e.clientX - r.left + 12, r.width - 24) + 'px'; tp.style.top = (e.clientY - r.top + 14) + 'px';
  };
  const onLeave = () => { const tp = host.querySelector('.ch-tip'); if (tp) tp.hidden = true; unfocus(); };
  const focus = i => {   // pies: lift slice i, dim the rest, show its value in the centre
    host.classList.add('hot');
    host.querySelectorAll('[data-i]').forEach(el => el.classList.toggle('on', +el.dataset.i === i));
    const big = host.querySelector('.cbig'), sub = host.querySelector('.csub');
    if (big) { big.textContent = String(to[i]); sub.textContent = labels[i]; }
  };
  function unfocus() {
    if (!host.classList.contains('hot')) return;
    host.classList.remove('hot');
    host.querySelectorAll('[data-i].on').forEach(el => el.classList.remove('on'));
    const big = host.querySelector('.cbig'), sub = host.querySelector('.csub');
    if (big) { big.textContent = centre.big; sub.textContent = centre.sub; }
  }
  const onOver = e => { if (!pie) return; const t = e.target.closest?.('[data-i]'); if (t) focus(+t.dataset.i); else unfocus(); };
  const onClick = e => { const t = e.target.closest?.('[data-i]'); if (t && onPick) onPick(data[+t.dataset.i]); };
  host.addEventListener('pointermove', onMove); host.addEventListener('pointerleave', onLeave); host.addEventListener('pointerover', onOver); host.addEventListener('click', onClick);
  let [lw, lh] = inner(host);
  const ro = new ResizeObserver(() => {
    const [w, h] = inner(host);
    if (w === lw && h === lh) return;
    lw = w; lh = h;
    if (!animating) render(Infinity);          // a running animation reads the new size on its next frame
  });
  ro.observe(host);

  const stop = () => { cancelAnimationFrame(raf); ro.disconnect(); host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerleave', onLeave); host.removeEventListener('pointerover', onOver); host.removeEventListener('click', onClick); host._stop = null; };
  host._stop = stop;
  return stop;
}
