// Spark's poses as pixel rows (14 wide, 13 tall). Pure: no DOM.
import { SPARK_ROWS, LEGS } from './sprite.ts';

export type Pose = 'idle' | 'walk' | 'run' | 'sit' | 'sleep' | 'think' | 'talk' | 'happy' | 'wave';
export const POSES: Pose[] = ['idle', 'walk', 'run', 'sit', 'sleep', 'think', 'talk', 'happy', 'wave'];

const W = 14;
const BLANK = '.'.repeat(W);
const body = (): string[] => [...SPARK_ROWS];
const put = (rows: string[], y: number, x: number, c: string): string[] => {
  const r = [...rows]; r[y] = r[y].slice(0, x) + c + r[y].slice(x + 1); return r;
};
// Shift rows [from, to] sideways by n (positive = right), padding with blanks.
const shift = (rows: string[], from: number, to: number, n: number): string[] =>
  rows.map((r, y) => y < from || y > to ? r : n >= 0 ? BLANK.slice(0, n) + r.slice(0, W - n) : r.slice(-n) + BLANK.slice(0, -n));
const withLegs = (rows: string[], legs: string): string[] => [...rows, legs];
const OPEN_EYES = SPARK_ROWS[6];
const CLOSED = SPARK_ROWS[6].replace(/k/g, 'o');

function build(p: Pose, i: number): string[] {
  switch (p) {
    case 'idle': return withLegs(body(), LEGS[i]);
    case 'walk': return i === 0 ? withLegs(body(), LEGS[0]) : withLegs(shift(body(), 0, 3, 1), LEGS[1]);
    case 'run': return i === 0
      ? withLegs(shift(body(), 0, 3, -1), '..dd......dd..')
      : withLegs(shift(body(), 0, 3, -2), '....dddddd....');
    case 'sit': return [BLANK, ...body()];
    case 'sleep': {
      let r = body(); r[6] = OPEN_EYES.replace(/k/g, 'd');
      r = put(r, i === 0 ? 1 : 0, 13, 'w');
      return withLegs(r, LEGS[0]);
    }
    case 'think': {
      let r = body(); r[6] = CLOSED; r = put(r, 5, 4, 'k'); r = put(r, 5, 9, 'k');
      for (let d = 0; d <= i; d++) r = put(r, 2 - d, 13, 'w');
      return withLegs(r, LEGS[0]);
    }
    case 'talk': {
      let r = put(put(body(), 7, 6, 'd'), 7, 7, 'd');
      if (i === 0) r = put(put(r, 8, 6, 'd'), 8, 7, 'd');
      return withLegs(r, LEGS[0]);
    }
    case 'happy': {
      let r = body(); r[6] = CLOSED; r = put(r, 5, 4, 'k'); r = put(r, 5, 9, 'k');
      for (const x of [3, 5, 8, 10]) r = put(r, 6, x, 'k');
      r = withLegs(r, LEGS[0]);
      return i === 0 ? r : [...r.slice(1), BLANK];
    }
    case 'wave': {
      let r = put(body(), 2, 11, '.');
      const [y, x] = [[1, 12], [0, 12], [0, 13]][i];
      r = put(r, y, x, 'o');
      return withLegs(r, LEGS[0]);
    }
  }
}

const COUNT: Record<Pose, number> = { idle: 2, walk: 2, run: 2, sit: 1, sleep: 2, think: 3, talk: 2, happy: 2, wave: 3 };
export const frameCount = (p: Pose): number => COUNT[p];
export function frameRows(p: Pose, i: number): string[] {
  const n = COUNT[p];
  return build(p, ((i % n) + n) % n);
}
