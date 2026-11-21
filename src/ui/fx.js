import { themeRoot, cssVar, reduced } from './util.js';

/* Colour effects for things drawn as SVG (charts, rings).
   HTML elements get their effect from the stylesheet (see "Colour effects" in styles.css); SVG cannot use a CSS background,
   so a shape asks here for a paint: the plain colour when the effect is off or only "shifts" (the colour itself is a live CSS
   variable then), or a <linearGradient> when the effect is "gradient" or "flow". */

export const fxMode = () => { const m = themeRoot().dataset.fx; return m === 'gradient' || m === 'flow' ? m : 'off'; };

/** The second colour of a gradient: a lighter version of `c`, or a blend towards the custom colour. Same maths as the stylesheet. */
export const second = c => `color-mix(in srgb, ${c}, var(--fx-tint, #fff) calc(var(--fx-k, 30) * 1%))`;

/** id must be unique in the document. o.box = {x, y, w, h} switches to user-space units (needed for flat shapes such as a line
    chart's stroke, whose bounding box can have no height). Returns { defs, paint }: put defs inside <defs>, use paint as fill/stroke. */
export function paintDef(id, c, o = {}) {
  const mode = fxMode();
  if (mode === 'off') return { defs: '', paint: c };
  const gid = 'fx-' + String(id).replace(/\W/g, '');
  const b = o.box, u = b ? 'userSpaceOnUse' : 'objectBoundingBox', X = b ? b.x : 0, Y = b ? b.y : 0, W = b ? b.w : 1, H = b ? b.h : 1;
  let x1, y1, x2, y2;
  if (mode === 'flow') { x1 = X; y1 = Y; x2 = X + W; y2 = Y; }   // flow always runs sideways
  else {
    const a = (parseFloat(cssVar('--fx-ang', '115')) || 115) * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    x1 = X + W * (.5 - dx / 2); y1 = Y + H * (.5 - dy / 2); x2 = X + W * (.5 + dx / 2); y2 = Y + H * (.5 + dy / 2);
  }
  const stops = `<stop offset="0" style="stop-color:${c}"/><stop offset="1" style="stop-color:${second(c)}"/>`;
  let anim = '';
  if (mode === 'flow' && !reduced()) {
    const dur = Math.max(1, parseFloat(cssVar('--fx-dur', '10')) || 10);
    anim = `<animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="${-2 * W} 0" dur="${dur}s" repeatCount="indefinite"/>`;
  }
  return {
    defs: `<linearGradient id="${gid}" gradientUnits="${u}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${mode === 'flow' ? ' spreadMethod="reflect"' : ''}>${stops}${anim}</linearGradient>`,
    paint: `url(#${gid})`,
  };
}
