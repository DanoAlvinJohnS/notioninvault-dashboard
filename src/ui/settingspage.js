import { $, $$, esc, themeRoot, cssVar, reduced } from './util.js';
import { getTheme, setTheme, resetTheme, commitTheme, revertTheme, isDirty } from './layout.js';
import { applyTheme, DEFAULT_THEME, PRESETS, STYLES, ANIMS, NAVS, FXS, INERTIAS, MOTIONS } from './theme.js';
import { chooseBackground, dropBackground, hasWallpaper, getMsg } from './background.js';
import { hooks } from './state.js';
import { paintDef } from './fx.js';

/* The Settings page. Everything is a compact "label | control" row inside a small card, in two fixed columns.
   Changes are a LIVE PREVIEW: they show at once but are only saved when "Apply changes" is pressed (the bar at the top
   stays in view while you scroll). "Revert", or leaving the page, goes back to what was last applied.
   Rows that depend on another choice (Cycle length only matters for the moving effects) are dimmed, never hidden. */

const FONTS = [['', 'Default'], ['system-ui', 'System UI'], ['Segoe UI', 'Segoe UI'], ['Arial', 'Arial'], ['Helvetica', 'Helvetica'], ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'],
  ['Verdana', 'Verdana'], ['Trebuchet MS', 'Trebuchet MS'], ['Tahoma', 'Tahoma'], ['Consolas', 'Consolas'], ['Courier New', 'Courier New'], ['ui-monospace', 'Monospace'], ['__custom', 'Custom…']];
const FX_HINT = {
  off: 'Colors stay solid.',
  shift: 'Every accent color slowly drifts lighter and darker, then back to itself.',
  gradient: 'Solid colors become a gradient, with a soft color wash behind the page.',
  flow: 'A gradient that keeps drifting through the buttons, bars and charts, with a flowing color wash behind the whole page.',
};
// settings that must survive choosing a preset (a preset changes the look, not how things move)
const KEEP = ['global', 'css', 'anim', 'motion', 'fx', 'fxTo', 'fxAmt', 'fxSpeed', 'fxAngle', 'bgMove', 'inertia', 'inertiaAmt'];

/** `when(dep, values)`: the row only matters while setting `dep` has one of `values` (otherwise it is dimmed). */
const when = (dep, vals) => ({ dep, vals });
const range = (key, label, min, max, unit, step = 1, w) => ({ t: 'range', key, label, min, max, unit, step, when: w });
const color = (key, label, v, fb, w) => ({ t: 'color', key, label, v, fb, when: w });
const select = (key, label, opts, w) => ({ t: 'select', key, label, opts, when: w });
const hint = text => ({ t: 'hint', text });
const FX_ON = when('fx', ['shift', 'gradient', 'flow']);

const SECTIONS = () => [
  { id: 'presets', title: 'Presets', col: 'top', items: [{ t: 'presets' }] },
  { id: 'fx', title: 'Color effect', col: 'a', items: [
    select('fx', 'Effect', FXS), { t: 'fxhint' }, { t: 'fxpreview' },
    color('fxTo', 'Second color', null, '#ffffff', FX_ON),
    range('fxAmt', 'How far colors change', 10, 50, '%', 1, FX_ON),
    range('fxSpeed', 'Cycle length', 2, 60, 's', 1, when('fx', ['shift', 'flow'])),
    range('fxAngle', 'Gradient angle', 0, 360, '°', 5, when('fx', ['gradient'])),
  ] },
  { id: 'motion', title: 'Motion', col: 'a', items: [
    select('anim', 'Animations', ANIMS),
    select('motion', 'System reduced motion', MOTIONS), { t: 'motionhint' },
    range('bgMove', 'Background follows scroll', 0, 100, '%'),
    hint('Slides the wallpaper and the color gradient as you scroll. 0% keeps them still.'),
    select('inertia', 'Scroll inertia', INERTIAS),
    range('inertiaAmt', 'Inertia strength', 10, 100, '%', 1, when('inertia', ['smooth', 'lively'])),
  ] },
  { id: 'look', title: 'Look', col: 'a', items: [select('style', 'Look', STYLES), select('nav', 'Active menu icon', NAVS),
    hint('Soft light, Mono and Techy use solid surfaces and hide the wallpaper. Glass shows it.')] },
  { id: 'fonts', title: 'Fonts', col: 'a', items: [{ t: 'font', key: 'fontHead', label: 'Heading font' }, { t: 'font', key: 'fontBody', label: 'Body font' }, range('size', 'Text size', 12, 20, 'px'),
    select('hw', 'Heading weight', [['', 'Default'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold']]), range('ls', 'Letter spacing', -5, 15, '%')] },
  { id: 'wallpaper', title: 'Wallpaper', col: 'b', items: [{ t: 'wallpaper' }, range('dim', 'Dim', 0, 80, '%'), range('bgBlur', 'Blur', 0, 40, 'px')] },
  { id: 'glass', title: 'Glass', col: 'b', items: [hint(hasWallpaper() ? '' : 'Glass settings show once a wallpaper is set.'), range('glass', 'Opacity', 0, 60, '%'), range('blur', 'Blur', 0, 60, 'px'), range('sat', 'Saturation', 100, 260, '%'),
    range('bord', 'Border strength', 0, 50, '%'), range('rad', 'Corner radius', 0, 32, 'px'), color('tint', 'Glass tint'), color('bc', 'Border color')] },
  { id: 'colours', title: 'Colors', col: 'b', items: [color('bg', 'Background', '--bg'), color('panel', 'Cards', '--panel'), color('rail', 'Menu bar', '--panel'), color('text', 'Text', '--text'), color('muted', 'Muted text', '--muted'), color('head', 'Headings', '--text'),
    color('accent', 'Accent', '--y-b'), color('accent2', 'Accent 2', '--o-b'), color('good', 'Positive', '--g-b'), color('bad', 'Alert', '--r-b'), color('canvas', 'Canvas items', '--c-b')] },
  ...(hooks.globalTheme ? [{ id: 'obsidian', title: 'Obsidian', col: 'b', items: [{ t: 'global' }] }] : []),
  { id: 'advanced', title: 'Advanced', col: 'bottom', items: [{ t: 'css' }] },
];

/* a color input needs #rrggbb, but "automatic" values are any CSS color: let a canvas convert */
let cx;
function toHex(c, fallback = '#888888') {
  try {
    cx ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  } catch { return fallback; }
}

/** Sample widgets drawn with the real classes, so the color effect can be judged without leaving the page. */
function previewHtml() {
  const bars = [['var(--y)', 78], ['var(--o)', 56], ['var(--g)', 38], ['var(--c)', 66]];
  let defs = '', body = '';
  bars.forEach(([c, h], i) => {
    const p = paintDef('pv' + i, c), bh = h * .62; defs += p.defs;
    body += `<rect x="${8 + i * 30}" y="${64 - bh}" width="20" height="${bh}" rx="5" fill="${p.paint}"/>`;
  });
  const R = 22, C = 2 * Math.PI * R, ring = paintDef('pvring', 'var(--y)'); defs += ring.defs;
  body += `<circle cx="176" cy="32" r="${R}" fill="none" stroke="rgba(128,128,128,.22)" stroke-width="8"/>
    <circle cx="176" cy="32" r="${R}" fill="none" stroke="${ring.paint}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * .3}" transform="rotate(-90 176 32)"/>`;
  return `<div class="fx-row"><button type="button" class="primary" tabindex="-1">Primary action</button><span class="ev todo">To do</span><span class="ev doing">Doing</span><span class="ev done">Done</span><span class="ev is-canvas todo">Canvas</span></div>
    <div class="fx-mid"><div class="fx-bars">${[['var(--y)', 82], ['var(--o)', 58], ['var(--g)', 36]].map(([c, w]) => `<div class="pb"><i class="pb-fill" style="width:${w}%;--pc:${c}"></i></div>`).join('')}</div>
    <svg class="fx-svg" viewBox="0 0 210 68" role="img" aria-label="Sample chart"><defs>${defs}</defs>${body}</svg></div>`;
}

const motionHint = t => {
  const os = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (t.motion === 'system') return os ? 'Your system has reduced motion turned on, so every animation here is paused. Choose “Always animate” to see them.' : 'Animations pause only if you turn on reduced motion in your system.';
  return os ? 'Your system has reduced motion turned on, but this dashboard is set to animate anyway.' : '';
};

/* ---- rows ---- */
const rowAttrs = (it, t) => {
  if (!it.when) return '';
  const on = it.when.vals.includes(String(t[it.when.dep]));
  return ` data-dep="${it.when.dep}" data-on="${it.when.vals.join(',')}"${on ? '' : ' data-off inert'}`;
};
const row = (it, t, ctl, cls = '') => `<div class="tp-row${cls}"${rowAttrs(it, t)}><span class="tp-l" title="${esc(it.label)}">${esc(it.label)}</span>${ctl}</div>`;

function colorCtl(it, t) {
  const auto = t[it.key] === '', val = auto ? toHex(it.v ? cssVar(it.v) : (it.fb ?? DEFAULT_THEME[it.key])) : t[it.key].length === 4 ? toHex(t[it.key]) : t[it.key];
  return `<div class="tp-color"><input type="color" data-k="${it.key}" value="${val}" aria-label="${esc(it.label)}"><input type="text" data-k="${it.key}" data-hex placeholder="auto" value="${esc(t[it.key])}" maxlength="7" spellcheck="false" aria-label="${esc(it.label)} as hex"><button type="button" class="tp-reset" data-reset="${it.key}" title="Back to automatic" aria-label="Set ${esc(it.label)} back to automatic"${auto ? ' hidden' : ''}>↺</button></div>`;
}

function control(it, t) {
  if (it.t === 'hint') return it.text ? `<p class="tp-hint">${esc(it.text)}</p>` : '';
  if (it.t === 'fxhint') return `<p class="tp-hint" data-fxhint>${esc(FX_HINT[t.fx] || '')}</p>`;
  if (it.t === 'motionhint') { const h = motionHint(t); return `<p class="tp-hint warn" data-motionhint${h ? '' : ' hidden'}>${esc(h)}</p>`; }
  if (it.t === 'fxpreview') return `<div class="fx-prev" id="fx-prev" aria-label="Preview">${previewHtml()}</div>`;
  if (it.t === 'presets') return `<div class="tp-presets">${Object.keys(PRESETS).map(n => `<button type="button" class="ghost" data-preset="${esc(n)}">${esc(n)}</button>`).join('')}<span class="sk-fill"></span><button type="button" class="ghost" data-act="reset">Reset theme</button></div>`;
  if (it.t === 'wallpaper') return `<div class="tp-row"><span class="tp-l">Image</span><div class="tp-btns"><button type="button" class="ghost" data-act="wp-change">Change background</button>${hasWallpaper() ? '<button type="button" class="link" data-act="wp-remove">Remove</button>' : ''}</div></div><p class="bg-msg" id="bg-msg" role="alert">${esc(getMsg())}</p>`;
  if (it.t === 'range') return row(it, t, `<div class="tp-rng"><input type="range" data-k="${it.key}" data-u="${it.unit}" min="${it.min}" max="${it.max}" step="${it.step || 1}" value="${t[it.key]}" aria-label="${esc(it.label)}"><output data-v="${it.key}">${t[it.key]}${it.unit}</output></div>`);
  if (it.t === 'color') return row(it, t, colorCtl(it, t));
  if (it.t === 'font') {
    const known = FONTS.some(([v]) => v === t[it.key]), sel = known ? t[it.key] : '__custom';
    return row(it, t, `<div class="tp-ctl"><select data-k="${it.key}" data-fontsel aria-label="${esc(it.label)}">${FONTS.map(([v, n]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <input type="text" data-k="${it.key}" data-custom placeholder="Any installed font name" value="${esc(known ? '' : t[it.key])}" ${known ? 'hidden' : ''}></div>`);
  }
  if (it.t === 'select') return row(it, t, `<select data-k="${it.key}" aria-label="${esc(it.label)}">${it.opts.map(([v, n]) => `<option value="${v}"${v === t[it.key] ? ' selected' : ''}>${n}</option>`).join('')}</select>`);
  if (it.t === 'global') return `<div class="tp-row"><span class="tp-l">All of Obsidian</span><label class="tp-switch"><input type="checkbox" data-k="global" ${t.global ? 'checked' : ''}> Apply this theme</label></div>
    <div class="tp-row"><span class="tp-l">Which parts</span><select data-k="scope" aria-label="Which parts"><option value="chrome"${t.scope === 'chrome' ? ' selected' : ''}>Sidebars, tabs, status bar</option><option value="all"${t.scope === 'all' ? ' selected' : ''}>Everything, including notes</option></select></div>
    <p class="tp-hint">Needs a wallpaper for the glass look; colors and fonts apply without one. Turn it off to restore your normal Obsidian theme.</p>`;
  if (it.t === 'css') return `<div class="tp-row stack"><textarea data-k="css" rows="5" spellcheck="false" aria-label="Extra CSS" placeholder="/* Your own CSS. Only applies to the dashboard unless the theme is applied to all of Obsidian. */">${esc(t.css)}</textarea></div>`;
  return '';
}

const section = (s, i, t) => `<section class="set-sec${s.col === 'top' || s.col === 'bottom' ? ' wide' : ''}" id="sec-${s.id}" style="--i:${i}"><h3>${s.title}</h3>${s.items.map(it => control(it, t)).join('')}</section>`;

function pageHtml(t) {
  const secs = SECTIONS(); let i = 0;
  const out = c => secs.filter(s => s.col === c).map(s => section(s, i++, t)).join('');
  return `${out('top')}<div class="set-col">${out('a')}</div><div class="set-col">${out('b')}</div>${out('bottom')}`;
}

/* ---- the Apply bar ---- */
let flashT = 0;
function refreshBar(msg) {
  const bar = $('#set-bar'); if (!bar) return;
  const dirty = isDirty();
  bar.dataset.state = dirty ? 'dirty' : 'clean';
  $('#set-msg').textContent = msg || (dirty ? 'Previewing. Changes are not applied yet.' : 'All changes applied');
  $$('[data-act="apply"],[data-act="revert"]', bar).forEach(b => { b.disabled = !dirty; });
}
async function doApply() {
  const bar = $('#set-bar'); if (!bar) return;
  $$('button', bar).forEach(b => { b.disabled = true; });
  $('#set-msg').textContent = 'Applying…';
  try {
    applyTheme(await commitTheme());
    refreshBar('Applied ✓');
    clearTimeout(flashT); flashT = setTimeout(() => { if (!isDirty()) refreshBar(); }, 2600);
  } catch (e) {
    console.error('[vault-dashboard] theme not saved', e);
    refreshBar('Could not save. Try again.');
  }
}

function apply(patch) {
  const th = setTheme(patch);
  applyTheme(th);
  if (Object.keys(patch).some(k => k.startsWith('fx'))) { const pv = $('#fx-prev'); if (pv) pv.innerHTML = previewHtml(); }
  syncRows(document);
  refreshBar();
  return th;
}
/** Dims the rows that do not matter for the current choices, and updates the explanatory texts. */
function syncRows(root) {
  const t = getTheme();
  $$('.tp-row[data-dep]', root).forEach(r => { const on = r.dataset.on.split(',').includes(String(t[r.dataset.dep])); r.toggleAttribute('data-off', !on); r.toggleAttribute('inert', !on); });
  const h = $('[data-fxhint]', root); if (h) h.textContent = FX_HINT[t.fx] || '';
  const m = $('[data-motionhint]', root); if (m) { const x = motionHint(t); m.textContent = x; m.hidden = !x; }
}

/** Draws the page into #main. enter = play the pop-in (false when only refreshing after a change, so nothing replays). */
export function settingsPage({ enter = true } = {}) {
  const sc = $('.vd-scroll'), top = sc.scrollTop, t = getTheme();
  $('#main').innerHTML = `<div class="set-head"><h2>Settings</h2><p class="sub">Changes preview live. Press Apply changes to keep them.</p></div>
    <div class="set-bar" id="set-bar" data-state="clean"><i class="set-dot"></i><span class="set-msg" id="set-msg"></span><span class="sk-fill"></span><button type="button" class="ghost" data-act="revert">Revert</button><button type="button" class="primary" data-act="apply">Apply changes</button></div>
    <div class="set-page${enter ? '' : ' no-anim'}" id="set-page">${pageHtml(t)}</div>`;
  if (!enter) sc.scrollTop = top;
  $('#set-bar').onclick = e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.act === 'apply') doApply();
    else if (b.dataset.act === 'revert') { applyTheme(revertTheme()); again(); }
  };
  refreshBar();
  wire($('#set-page'));
}
const again = () => settingsPage({ enter: false });

function wire(p) {
  p.addEventListener('input', e => {
    const el = e.target, k = el.dataset.k; if (!k || el.dataset.fontsel !== undefined || el.dataset.hex !== undefined) return;
    if (el.type === 'range') { apply({ [k]: Number(el.value) }); $(`[data-v="${k}"]`, p).textContent = el.value + el.dataset.u; }
    else if (el.type === 'color') { apply({ [k]: el.value }); const c = el.closest('.tp-color'); $('[data-hex]', c).value = el.value; $('.tp-reset', c).hidden = false; }
    else if (el.tagName === 'TEXTAREA' || el.dataset.custom !== undefined) apply({ [k]: el.value });
  });
  p.addEventListener('change', e => {
    const el = e.target, k = el.dataset.k; if (!k) return;
    if (el.dataset.fontsel !== undefined) {
      const custom = $('[data-custom]', el.closest('.tp-ctl'));
      if (el.value === '__custom') { custom.hidden = false; custom.focus(); } else { custom.hidden = true; apply({ [k]: el.value }); }
    } else if (el.dataset.hex !== undefined) {
      const v = el.value.trim();
      if (v === '' || /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) apply({ [k]: v });
      again();
    } else if (el.type === 'checkbox') apply({ [k]: el.checked });
    else if (el.tagName === 'SELECT') {
      apply({ [k]: el.value });
      if (k === 'style') again();
    }
  });
  p.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.reset) { apply({ [b.dataset.reset]: '' }); again(); }
    else if (b.dataset.preset) {
      const r = themeRoot(), cur = getTheme(), keep = Object.fromEntries(KEEP.map(k => [k, cur[k]]));
      r.classList.add('vd-swap'); setTimeout(() => r.classList.remove('vd-swap'), 520);   // colors fade between looks
      apply({ ...DEFAULT_THEME, ...keep, ...PRESETS[b.dataset.preset] }); again();
    }
    else if (b.dataset.act === 'reset') { applyTheme(resetTheme()); again(); }
    else if (b.dataset.act === 'wp-change') chooseBackground();
    else if (b.dataset.act === 'wp-remove') dropBackground();
  });
}
