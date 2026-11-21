import { marked } from 'marked';
import DOMPurify from 'dompurify';
/** The element that carries theme state (the Obsidian view in the plugin, <body> in the browser). */
export const themeRoot = () => document.querySelector('.vd-root') || document.body;
/** Current value of a theme variable (e.g. '--y'), falling back to `d`. Used where SVG/JS needs a real colour. */
export const cssVar = (k, d = '') => getComputedStyle(themeRoot()).getPropertyValue(k).trim() || d;
/** True only when the person chose "Follow system setting" under Motion AND their OS asks for reduced motion.
    (By default the dashboard animates anyway: a Windows machine with "Animation effects" off would otherwise freeze every effect.) */
export const reduced = () => themeRoot().dataset.motion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const iso = d => d.toLocaleDateString('en-CA');
export const today = () => iso(new Date());
export const fmt = d => new Date(d + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const longDay = d => new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
export const obs = (vault, p) => `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(p.replace(/\.md$/, ''))}`;
export const md = src => DOMPurify.sanitize(marked.parse(src || '', { gfm: true, breaks: true }));
export const STATUS = { todo: 'To do', doing: 'Doing', done: 'Done' };

/** Numbers in `.stats b` count up from 0 (used when the dashboard first appears; skipped if animation is off or the OS asks for less motion). */
export function countUp(host, ms = 700) {
  if (host.closest('.vd-root')?.dataset.anim === 'off' || reduced()) return;
  const els = [...host.querySelectorAll('.stats b')], finals = els.map(e => Number(e.textContent) || 0), t0 = performance.now();
  els.forEach(e => { e.textContent = '0'; });
  const tick = now => {
    const p = Math.min(1, (now - t0) / ms), k = 1 - (1 - p) ** 3;
    els.forEach((e, i) => { e.textContent = String(Math.round(finals[i] * k)); });
    if (p < 1 && host.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
