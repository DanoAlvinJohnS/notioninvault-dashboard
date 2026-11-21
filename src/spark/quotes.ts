// Spark's random thoughts: quotes read from "RANDOM WORDS.csv" in the vault root. Pure: no DOM, no Obsidian.
// Only text inside double quotes counts: "content 1", "content 2". A comma inside the quotes is part of the quote;
// "" inside a quote is a literal quote mark (the CSV rule); anything outside quotes is ignored.
import type { Pose } from './frames.ts';
import type { SparkMode } from './brain.ts';

export const QUOTES_FILE = 'RANDOM WORDS.csv';
export type QuoteEvery = 'often' | 'normal' | 'rare';
/** Minutes between random comments: [min, max]. */
export const QUOTE_EVERY: Record<QuoteEvery, [number, number]> = { often: [1, 3], normal: [3, 7], rare: [10, 20] };
export const QUOTE_SHOW_MS = 8000;
const QUIET_AFTER_TYPING_MS = 10_000;

export const STARTER_CSV = `"Drink some water! Your brain is mostly water, after all.", "One task at a time. You've got this."
"Fun fact: honey never spoils, even after 3,000 years.", "Have you stretched today?"
"Small notes add up to big ideas.", "Did you know? Octopuses have three hearts."
"Take a short break, then come back stronger."
`;

export function parseQuotes(text: string): string[] {
  const out: string[] = [], seen = new Set<string>();
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '"') { i++; continue; }
    let j = i + 1, value = '', closed = false;
    while (j < text.length) {
      if (text[j] === '"') {
        if (text[j + 1] === '"') { value += '"'; j += 2; continue; }   // "" = a literal quote mark
        closed = true; j++; break;
      }
      value += text[j++];
    }
    if (!closed) break;   // an unfinished quote at the end is ignored
    const tidy = value.replace(/\s+/g, ' ').trim();
    if (tidy && !seen.has(tidy)) { seen.add(tidy); out.push(tidy); }
    i = j;
  }
  return out;
}

/** A shuffled bag: every quote once before any repeats, and never the same quote twice in a row. */
export function createPicker(random: () => number = Math.random) {
  let all: string[] = [], bag: string[] = [], last: string | null = null;
  const refill = () => {
    bag = [...all];
    for (let i = bag.length - 1; i > 0; i--) { const k = Math.floor(random() * (i + 1)); [bag[i], bag[k]] = [bag[k], bag[i]]; }
    if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  };
  return {
    set(list: string[]) { all = [...list]; refill(); },
    next(): string | null {
      if (!all.length) return null;
      if (!bag.length) refill();
      return (last = bag.pop()!);
    },
  };
}

export function quoteDelay(every: QuoteEvery, random: () => number = Math.random): number {
  const [lo, hi] = QUOTE_EVERY[every] ?? QUOTE_EVERY.normal;
  return Math.round((lo + random() * (hi - lo)) * 60_000);
}

/** Spark only speaks when it would not interrupt anything. */
export function canSayQuote(s: { pose: Pose; mode: SparkMode; hint: number; chatOpen: boolean; typedAgoMs: number }): boolean {
  if (s.chatOpen || s.hint > 0 || s.mode === 'sleep' || s.typedAgoMs < QUIET_AFTER_TYPING_MS) return false;
  return s.pose === 'idle' || s.pose === 'walk' || s.pose === 'sit';
}
