import { $, themeRoot } from './util.js';
import { getBackground, setBackground, removeBackground, previewTheme } from './api.js';
import { getTheme } from './layout.js';
import { applyTheme } from './theme.js';
import { hooks } from './state.js';

const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.avif,.bmp,.svg,image/*';
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' };
const BAD = "That file can't be shown as a background. Use PNG, JPG, WebP, GIF, AVIF, BMP or SVG (HEIC is not supported).";
let current = null;   // url of the wallpaper currently shown, so unchanged refreshes do nothing

export const hasWallpaper = () => !!current;

/** True when the browser can actually draw the file, so a broken image never replaces a good wallpaper. */
const canShow = f => new Promise(done => {
  const url = URL.createObjectURL(new Blob([f], { type: MIME[f.name.split('.').pop().toLowerCase()] || f.type }));
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); done(true); };
  img.onerror = () => { URL.revokeObjectURL(url); done(false); };
  img.src = url;
});
let msg = '';   // last problem with a wallpaper file, shown on the Settings page
export const getMsg = () => msg;
export const say = t => { msg = t; const m = $('#bg-msg'); if (m) m.textContent = t; };

export const chooseBackground = () => $('#bg-file').click();
export async function dropBackground() { await removeBackground(); current = null; say(''); await refreshBackground(); }

/** Wires the hidden file picker (the buttons that open it live on the Settings page). */
export function mountBackground() {
  current = null; msg = '';
  $('#bg-file').accept = ACCEPT;
  applyTheme(getTheme());
  $('#bg-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    say('');
    if (!(await canShow(f))) { say(BAD); e.target.value = ''; return; }
    try { await setBackground(f); current = null; await refreshBackground(); }
    catch (err) { say(err.message); }
    e.target.value = '';
  };
}

/** Looks for db_background.* and shows or clears it. Cheap to call on every refresh. */
export async function refreshBackground() {
  const bg = await getBackground().catch(() => null), url = bg ? bg.url : '';
  if (url === current) return;
  current = url;
  const layer = $('.vd-bg'), root = themeRoot();
  const done = () => { hooks.bgChanged?.(); previewTheme(getTheme()); };   // theme panel + Obsidian-wide mode need to know
  if (!bg) { root.classList.remove('has-bg'); layer.style.backgroundImage = ''; done(); return; }
  const img = new Image();
  img.onload = () => { if (current !== url) return; layer.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`; root.classList.add('has-bg'); say(''); done(); };
  img.onerror = () => { if (current !== url) return; root.classList.remove('has-bg'); layer.style.backgroundImage = ''; say(BAD); done(); };
  img.src = url;
}
