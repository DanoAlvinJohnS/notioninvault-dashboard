import { $, $$, esc, themeRoot, cssVar } from './util.js';
import { getTheme, setTheme, resetTheme } from './layout.js';
import { applyTheme, DEFAULT_THEME, PRESETS, STYLES, ANIMS, NAVS } from './theme.js';
import { chooseBackground, dropBackground, hasWallpaper } from './background.js';
import { hooks } from './state.js';

const FONTS = [['', 'Default'], ['system-ui', 'System UI'], ['Segoe UI', 'Segoe UI'], ['Arial', 'Arial'], ['Helvetica', 'Helvetica'], ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'],
  ['Verdana', 'Verdana'], ['Trebuchet MS', 'Trebuchet MS'], ['Tahoma', 'Tahoma'], ['Consolas', 'Consolas'], ['Courier New', 'Courier New'], ['ui-monospace', 'Monospace'], ['__custom', 'Custom…']];
const RECOLOR = ['accent', 'accent2', 'good', 'bad'];   // charts and the graph read these as real colours, so they need a redraw
const range = (key, label, min, max, unit) => ({ t: 'range', key, label, min, max, unit });
const color = (key, label, v) => ({ t: 'color', key, label, v });
const SECTIONS = () => [
  ['Style', [{ t: 'select', key: 'style', label: 'Look', opts: STYLES }, { t: 'select', key: 'anim', label: 'Animations', opts: ANIMS }, { t: 'select', key: 'nav', label: 'Active menu icon', opts: NAVS },
    { t: 'hint', text: 'Soft light, Mono and Techy use solid surfaces and hide the wallpaper. Glass shows it.' }]],
  ['Wallpaper', [{ t: 'wallpaper' }, range('dim', 'Dim', 0, 80, '%'), range('bgBlur', 'Wallpaper blur', 0, 40, 'px')]],
  ['Glass', [{ t: 'hint', text: hasWallpaper() ? '' : 'Glass settings show once a wallpaper is set.' }, range('glass', 'Opacity', 0, 60, '%'), range('blur', 'Blur', 0, 60, 'px'), range('sat', 'Saturation', 100, 260, '%'),
    range('bord', 'Border strength', 0, 50, '%'), range('rad', 'Corner radius', 0, 32, 'px'), color('tint', 'Glass tint'), color('bc', 'Border colour')]],
  ['Colours', [color('bg', 'Background', '--bg'), color('panel', 'Cards', '--panel'), color('rail', 'Menu bar', '--panel'), color('text', 'Text', '--text'), color('muted', 'Muted text', '--muted'), color('head', 'Headings', '--text'), color('accent', 'Accent', '--y'),
    color('accent2', 'Accent 2', '--o'), color('good', 'Positive', '--g'), color('bad', 'Alert', '--r'), color('canvas', 'Canvas items', '--c')]],
  ['Fonts', [{ t: 'font', key: 'fontHead', label: 'Heading font' }, { t: 'font', key: 'fontBody', label: 'Body font' }, range('size', 'Text size', 12, 20, 'px'),
    { t: 'select', key: 'hw', label: 'Heading weight', opts: [['', 'Default'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold']] }, range('ls', 'Letter spacing', -5, 15, '%')]],
  ...(hooks.globalTheme ? [['Obsidian', [{ t: 'global' }]]] : []),
  ['Advanced', [{ t: 'css' }]],
];

/* a colour input needs #rrggbb, but "automatic" values are any CSS colour: let a canvas convert */
let cx;
function toHex(c, fallback = '#888888') {
  try {
    cx ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  } catch { return fallback; }
}

function control(it, t) {
  if (it.t === 'hint') return it.text ? `<p class="tp-hint">${esc(it.text)}</p>` : '';
  if (it.t === 'wallpaper') return `<div class="tp-wp"><button class="ghost" data-act="wp-change">Change background</button>${hasWallpaper() ? '<button class="link" data-act="wp-remove">Remove</button>' : ''}</div>`;
  if (it.t === 'range') return `<div class="tp-row"><label>${it.label}<span data-v="${it.key}">${t[it.key]}${it.unit}</span></label><input type="range" data-k="${it.key}" data-u="${it.unit}" min="${it.min}" max="${it.max}" value="${t[it.key]}"></div>`;
  if (it.t === 'color') {
    const auto = t[it.key] === '', val = auto ? toHex(it.v ? cssVar(it.v) : DEFAULT_THEME[it.key]) : t[it.key].length === 4 ? toHex(t[it.key]) : t[it.key];
    return `<div class="tp-row"><label>${it.label}<button class="tp-reset" data-reset="${it.key}" ${auto ? 'hidden' : ''}>Auto</button></label>
      <div class="tp-color"><input type="color" data-k="${it.key}" value="${val}"><input type="text" data-k="${it.key}" data-hex placeholder="auto" value="${esc(t[it.key])}" maxlength="7" spellcheck="false"></div></div>`;
  }
  if (it.t === 'font') {
    const known = FONTS.some(([v]) => v === t[it.key]), sel = known ? t[it.key] : '__custom';
    return `<div class="tp-row"><label>${it.label}</label><select data-k="${it.key}" data-fontsel>${FONTS.map(([v, n]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <input type="text" data-k="${it.key}" data-custom placeholder="Any installed font name" value="${esc(known ? '' : t[it.key])}" ${known ? 'hidden' : ''}></div>`;
  }
  if (it.t === 'select') return `<div class="tp-row"><label>${it.label}</label><select data-k="${it.key}">${it.opts.map(([v, n]) => `<option value="${v}"${v === t[it.key] ? ' selected' : ''}>${n}</option>`).join('')}</select></div>`;
  if (it.t === 'global') return `<label class="tp-switch"><input type="checkbox" data-k="global" ${t.global ? 'checked' : ''}> Apply this theme to all of Obsidian</label>
    <div class="tp-row"><label>Which parts</label><select data-k="scope"><option value="chrome"${t.scope === 'chrome' ? ' selected' : ''}>Sidebars, tabs and status bar (notes stay readable)</option><option value="all"${t.scope === 'all' ? ' selected' : ''}>Everything, including notes</option></select></div>
    <p class="tp-hint">Needs a wallpaper for the glass look. Colours and fonts apply without one. Switch it off to restore your normal Obsidian theme.</p>`;
  if (it.t === 'css') return `<div class="tp-row"><label>Extra CSS</label><textarea data-k="css" rows="6" spellcheck="false" placeholder="/* Your own CSS. Only applies to the dashboard unless the theme is applied to all of Obsidian. */">${esc(t.css)}</textarea></div>`;
  return '';
}

function build() {
  const p = $('#theme-panel'); if (!p) return;
  const t = getTheme(), top = p.scrollTop;
  p.innerHTML = `<div class="tp-head"><h2>Theme</h2><button class="x" data-act="close" aria-label="Close theme panel">×</button></div>
    <div class="tp-presets">${Object.keys(PRESETS).map(n => `<button class="ghost" data-preset="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    ${SECTIONS().map(([title, items]) => `<section class="tp-sec"><h4>${title}</h4>${items.map(i => control(i, t)).join('')}</section>`).join('')}
    <div class="tp-foot"><button class="ghost" data-act="reset">Reset theme</button></div>`;
  p.scrollTop = top;
}

let timer;
function apply(patch) {
  const th = setTheme(patch);
  applyTheme(th);
  if (Object.keys(patch).some(k => RECOLOR.includes(k))) { clearTimeout(timer); timer = setTimeout(() => hooks.render?.(), 150); }
  return th;
}
const open = () => { $('#theme-panel').classList.add('open'); build(); };
const close = () => $('#theme-panel')?.classList.remove('open');

export function mountThemePanel() {
  $('#theme-panel')?.remove();
  themeRoot().insertAdjacentHTML('beforeend', '<aside class="theme-panel" id="theme-panel" aria-label="Theme"></aside>');
  const p = $('#theme-panel');

  p.addEventListener('input', e => {
    const el = e.target, k = el.dataset.k; if (!k || el.dataset.fontsel !== undefined || el.dataset.hex !== undefined) return;
    if (el.type === 'range') { apply({ [k]: Number(el.value) }); $(`[data-v="${k}"]`, p).textContent = el.value + el.dataset.u; }
    else if (el.type === 'color') { apply({ [k]: el.value }); const row = el.closest('.tp-row'); $('[data-hex]', row).value = el.value; $('.tp-reset', row).hidden = false; }
    else if (el.tagName === 'TEXTAREA' || el.dataset.custom !== undefined) apply({ [k]: el.value });
  });
  p.addEventListener('change', e => {
    const el = e.target, k = el.dataset.k; if (!k) return;
    if (el.dataset.fontsel !== undefined) {
      const custom = $('[data-custom]', el.closest('.tp-row'));
      if (el.value === '__custom') { custom.hidden = false; custom.focus(); } else { custom.hidden = true; apply({ [k]: el.value }); }
    } else if (el.dataset.hex !== undefined) {
      const v = el.value.trim();
      if (v === '' || /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { apply({ [k]: v }); build(); } else build();
    } else if (el.type === 'checkbox') apply({ [k]: el.checked });
    else if (el.tagName === 'SELECT') { apply({ [k]: el.value }); if (k === 'style') { build(); hooks.render?.(); } }
  });
  p.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.reset) { apply({ [b.dataset.reset]: '' }); build(); }
    else if (b.dataset.preset) {
      const r = themeRoot(), { global, css } = getTheme();
      r.classList.add('vd-swap'); setTimeout(() => r.classList.remove('vd-swap'), 520);   // colours fade between looks
      apply({ ...DEFAULT_THEME, global, css, ...PRESETS[b.dataset.preset] }); build();
    }
    else if (b.dataset.act === 'reset') { applyTheme(resetTheme()); hooks.render?.(); build(); }
    else if (b.dataset.act === 'wp-change') chooseBackground();
    else if (b.dataset.act === 'wp-remove') dropBackground();
    else if (b.dataset.act === 'close') close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && p.classList.contains('open') && !$('dialog[open]')) close(); });
  hooks.openTheme = open;
  hooks.bgChanged = () => { if (p.classList.contains('open')) build(); };
}
