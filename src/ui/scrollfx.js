import { $, reduced } from './util.js';
import { getTheme } from './layout.js';
import { onThemeApplied } from './theme.js';

/* Everything that reacts to scrolling the dashboard:
   1. the wallpaper slides at a fraction of the scroll speed ("Background follows scroll"), while the sidebar stays put,
      so the glass sidebar always has something moving behind it;
   2. optional scroll inertia: wheel scrolling glides to a stop instead of jumping ("Smooth"), and the cards also trail behind
      a fast scroll and settle back with an ease-out ("Lively"). Their lag is driven by the real scroll speed. */

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const LAG_MAX = 26;   // px a card can trail behind at most

/** Can something inside the scroll area (a widget body, a text box ...) take this wheel movement itself? Then we leave it alone. */
function innerScroller(el, root, dy) {
  for (let n = el; n && n !== root; n = n.parentElement) {
    if (n.nodeType !== 1) continue;
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) {
      if ((dy < 0 && n.scrollTop > 0) || (dy > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1)) return true;
    }
  }
  return false;
}

/** root = the .vd-root element. Returns a cleanup function; the returned `refresh` is also exposed as cleanup.refresh. */
export function mountScrollFx(root) {
  const sc = $('.vd-scroll', root), bg = $('.vd-bg', root), fx = $('.vd-fx', root), app = $('.app', root), main = $('#main', root);
  let move = 0, mode = 'off', amt = 50;       // theme values
  let cur = sc.scrollTop, target = cur, prevTop = cur, lag = 0, raf = 0, last = 0, gliding = false, selfTop = -1;
  let cards = [], dirty = true;

  const smoothOn = () => mode !== 'off' && !reduced();
  const lagOn = () => mode === 'lively' && !reduced();
  const maxTop = () => Math.max(0, sc.scrollHeight - sc.clientHeight);

  /* ---- wallpaper + sidebar height ---- */
  /* In "Obsidian-wide" mode the wallpaper is one fixed layer on <body> (.vd-gbg) instead of the dashboard's own, so it has to slide too. */
  const gbg = () => document.body.querySelector(':scope > .vd-gbg');
  let travelPx = 0;
  function layout() {
    const ph = sc.clientHeight, k = reduced() ? 0 : move / 100;
    travelPx = ph ? Math.max(0, sc.scrollHeight - ph) * k : 0;
    root.style.setProperty('--pane-h', ph + 'px');
    root.style.setProperty('--bg-h', ph + travelPx + 'px');   // the wallpaper and the colour wash (.vd-fx) share this height
    place();
  }
  let placeRaf = 0;
  const placeSoon = () => { if (!placeRaf) placeRaf = requestAnimationFrame(() => { placeRaf = 0; place(); }); };
  function place() {
    const y = sc.clientHeight ? -(sc.scrollTop * (reduced() ? 0 : move / 100)) : 0, t = `translate3d(0,${y.toFixed(1)}px,0)`;
    bg.style.transform = t; fx.style.transform = t;
    const g = gbg(); if (g) { g.style.setProperty('--gbg-extra', travelPx + 'px'); g.style.transform = t; }
  }

  /* ---- cards that trail behind a fast scroll ---- */
  function collect() {
    cards = [...main.querySelectorAll('.wg, .set-sec')].filter(el => !el.closest('.wgrid.edit')).map((el, i) => ({ el, d: 1 + (i % 3) * .4 }));
    dirty = false;
  }
  function drag() {
    if (dirty) collect();
    for (const c of cards) c.el.style.translate = Math.abs(lag) < .05 ? '' : `0 ${(lag * c.d).toFixed(2)}px`;
  }

  function tick(now) {
    raf = 0;
    const dt = clamp((now - (last || now - 16.7)) / 16.7, .5, 3); last = now;
    if (gliding) {
      const k = 1 - Math.pow(1 - (.21 - amt * .0016), dt);   // strength 10 -> quick, 100 -> long glide
      cur += (target - cur) * k;
      if (Math.abs(target - cur) < .4) { cur = target; gliding = false; }
      selfTop = cur; sc.scrollTop = cur;
    }
    const top = sc.scrollTop, v = (top - prevTop) / dt; prevTop = top;   // real speed, whatever caused the scroll
    if (lagOn()) {
      lag += (clamp(v * 1.1, -LAG_MAX, LAG_MAX) - lag) * (1 - Math.pow(1 - .13, dt));
      drag();
    } else if (lag) { lag = 0; drag(); }
    if (gliding || Math.abs(v) > .05 || Math.abs(lag) > .05) raf = requestAnimationFrame(tick);
    else { last = 0; lag = 0; drag(); }
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  function onWheel(e) {
    if (!smoothOn() || e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaMode === 2 ? e.deltaY * sc.clientHeight : e.deltaY;
    if (innerScroller(e.target, sc, dy)) return;
    e.preventDefault();
    if (!gliding) { cur = sc.scrollTop; target = cur; }
    target = clamp(target + dy, 0, maxTop());
    gliding = true; kick();
  }
  let scrollTimer = 0;
  function onScroll() {
    placeSoon();
    if (!scrollTimer) root.classList.add('vd-scrolling');
    clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { scrollTimer = 0; root.classList.remove('vd-scrolling'); }, 140);
    if (gliding && Math.abs(sc.scrollTop - selfTop) > 3) { gliding = false; cur = target = sc.scrollTop; }   // the user took over (scrollbar, keys, drag)
    else if (!gliding) { cur = target = sc.scrollTop; }
    if (lagOn()) kick();
  }

  /* ---- theme + size changes ---- */
  function read(t) {
    move = t.bgMove; mode = t.inertia; amt = t.inertiaAmt;
    if (!lagOn()) { lag = 0; dirty = true; drag(); }
    layout();
  }
  const off = onThemeApplied(read);
  read(getTheme());

  sc.addEventListener('wheel', onWheel, { passive: false });
  sc.addEventListener('scroll', onScroll, { passive: true });
  const ro = new ResizeObserver(layout);
  ro.observe(sc); ro.observe(app);
  const mo = new MutationObserver(() => { dirty = true; });
  mo.observe(main, { childList: true, subtree: true });

  const stop = () => {
    off(); clearTimeout(scrollTimer); cancelAnimationFrame(placeRaf); root.classList.remove('vd-scrolling'); ro.disconnect(); mo.disconnect(); cancelAnimationFrame(raf);
    sc.removeEventListener('wheel', onWheel); sc.removeEventListener('scroll', onScroll);
    root.style.removeProperty('--pane-h'); root.style.removeProperty('--bg-h'); bg.style.transform = ''; fx.style.transform = '';
    const g = gbg(); if (g) { g.style.transform = ''; g.style.removeProperty('--gbg-extra'); }
    cards.forEach(c => { c.el.style.translate = ''; });
  };
  return stop;
}
