/* Skeleton "bubbles": grey shimmering shapes that stand in for a widget until its data is ready.
   Each widget type has a layout roughly the shape of the real thing, so the page does not jump when the content arrives. */
const sk = (w, h, r) => `<i class="sk" style="--w:${w};--h:${h}${r ? `;--r:${r}` : ''}"></i>`;
const times = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');

const LAYOUTS = {
  stats: () => `<div class="sk-stats">${times(5, () => `<div>${sk('58%', '30px', '12px')}${sk('72%', '11px')}</div>`)}</div>`,
  calendar: () => `<div class="sk-cal"><div class="sk-row">${sk('64px', '28px', '9px')}${sk('28px', '28px')}${sk('28px', '28px')}${sk('150px', '20px')}<span class="sk-fill"></span>${sk('112px', '28px', '9px')}</div>
    <div class="sk-grid">${times(35, i => `<div>${sk('22px', '22px')}${i % 4 === 1 ? sk('86%', '12px', '5px') : i % 7 === 3 ? sk('70%', '12px', '5px') + sk('86%', '12px', '5px') : ''}</div>`)}</div></div>`,
  due: () => `<div class="sk-list">${times(5, i => `<div class="sk-item">${sk('9px', '9px')}<div>${sk(`${78 - (i % 3) * 14}%`, '13px')}${sk('42%', '10px')}</div>${sk('36px', '11px')}</div>`)}</div>`,
  chart: () => `<div class="sk-bars">${times(6, i => `<div class="sk-hb">${sk('64px', '10px')}${sk(`${88 - i * 11}%`, '20px', '8px')}</div>`)}</div>`,
  progress: () => `<div class="sk-list">${times(3, () => `<div class="sk-goal"><div class="sk-row">${sk('90px', '13px')}<span class="sk-fill"></span>${sk('30px', '13px')}</div>${sk('100%', '9px')}${sk('70px', '10px')}</div>`)}</div>`,
  graph: () => `<div class="sk-graph">${[[18, 30, 22], [48, 22, 34], [72, 36, 18], [30, 62, 28], [62, 58, 40], [84, 70, 20], [44, 82, 16], [12, 76, 14]].map(([x, y, d]) => `<i class="sk" style="--w:${d}px;--h:${d}px;left:${x}%;top:${y}%"></i>`).join('')}</div>`,
  board: () => `<div class="sk-board">${times(3, c => `<div>${sk('92px', '15px')}${times(2 + (c % 2), () => `<div class="sk-card">${sk('76%', '13px')}${sk('34%', '10px')}</div>`)}</div>`)}</div>`,
  folders: () => `<div class="sk-folders">${times(4, () => `<div class="sk-card">${sk('55%', '16px')}<div class="sk-row">${sk('52px', '20px')}${sk('64px', '20px')}</div>${sk('80%', '11px')}${sk('64%', '11px')}</div>`)}</div>`,
};
const fallback = () => `<div class="sk-list">${times(4, i => sk(`${90 - i * 12}%`, '14px'))}</div>`;

export const skeletonFor = type => (LAYOUTS[type] || fallback)();

/** Placeholder for the page heading (title, subtitle and the filter bar) while the vault is still being read. */
export const headSkeleton = () => `<div class="head-row sk-head"><div>${sk('220px', '30px', '12px')}${sk('300px', '13px')}</div><div class="filterbar">${sk('218px', '32px', '9px')}${sk('140px', '28px')}</div></div>`;
