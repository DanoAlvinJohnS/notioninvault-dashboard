// Spark's pixels as data (original character). Pure: no DOM.
export const SPARK_ROWS: string[] = [
  '......dd......',
  '......oo......',
  '..o...oo...o..',
  '...o.oooo.o...',
  '....oooooo....',
  '.oooooooooooo.',
  'ooookooookoooo',
  '.oooooooooooo.',
  '....oooooo....',
  '...o.oooo.o...',
  '..o...oo...o..',
  '......oo......',
];
export const LEGS: [string, string] = ['....dd..dd....', '...dd....dd...'];
export const PALETTE: Record<string, string> = { o: '#d97757', d: '#a9553a', k: '#2a1d17', w: '#fff3e6' };

export function sparkSvgFrame(frame: 0 | 1, scale = 4): string {
  return sparkSvg([...SPARK_ROWS, LEGS[frame]], scale);
}

/** Rows 2 wider and 2 taller: every transparent cell touching a body pixel (8 neighbours) becomes `l` (outline). */
export function outlined(rows: string[]): string[] {
  const h = rows.length, w = rows[0]?.length ?? 0;
  const body = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== '.';
  const out: string[] = [];
  for (let y = -1; y <= h; y++) {
    let line = '';
    for (let x = -1; x <= w; x++) {
      if (body(x, y)) { line += rows[y][x]; continue; }
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && body(x + dx, y + dy)) { near = true; break; }
      line += near ? 'l' : '.';
    }
    out.push(line);
  }
  return out;
}

/** `outline`: colour for `l` cells; null/undefined skips them. The viewBox follows the rows (14x13, or 16x15 once outlined). */
export function sparkSvg(rows: string[], scale = 4, outline?: string | null): string {
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x] === 'l' ? outline : PALETTE[row[x]];
      if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  });
  const w = rows[0]?.length ?? 0, h = rows.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges">${rects}</svg>`;
}
