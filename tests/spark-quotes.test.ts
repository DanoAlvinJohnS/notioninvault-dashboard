import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuotes, createPicker, quoteDelay, canSayQuote, STARTER_CSV, QUOTE_EVERY } from '../src/spark/quotes.ts';

test('every quoted value is one quote; commas between quotes separate them', () => {
  assert.deepEqual(parseQuotes('"content 1", "content 2"\n"content 3"'), ['content 1', 'content 2', 'content 3']);
});

test('a comma inside quotes stays part of the quote', () => {
  assert.deepEqual(parseQuotes('"Honey never spoils, even after 3,000 years.", "Next"'), ['Honey never spoils, even after 3,000 years.', 'Next']);
});

test('text outside quotes is ignored', () => {
  assert.deepEqual(parseQuotes('RANDOM WORDS\nquote, another\n"kept" junk, "also kept"'), ['kept', 'also kept']);
});

test('doubled quote marks inside a quote are a literal quote', () => {
  assert.deepEqual(parseQuotes('"She said ""hi"" to me"'), ['She said "hi" to me']);
});

test('whitespace is tidied, empty quotes dropped, duplicates kept once', () => {
  assert.deepEqual(parseQuotes('"  spaced\n  out  ", "", "   ", "same", "same"'), ['spaced out', 'same']);
});

test('an unclosed quote at the end is ignored', () => {
  assert.deepEqual(parseQuotes('"ok", "never closed'), ['ok']);
});

test('the starter file parses into several quotes', () => {
  assert.ok(parseQuotes(STARTER_CSV).length >= 5);
});

test('picker never repeats until every quote was used, then reshuffles', () => {
  let n = 0;
  const p = createPicker(() => ((n = (n * 7 + 3) % 10) / 10));
  p.set(['a', 'b', 'c']);
  const round1 = [p.next(), p.next(), p.next()];
  assert.deepEqual([...round1].sort(), ['a', 'b', 'c']);
  const round2 = [p.next(), p.next(), p.next()];
  assert.deepEqual([...round2].sort(), ['a', 'b', 'c']);
  assert.notEqual(round2[0], round1[2], 'no immediate repeat across the reshuffle');
});

test('picker with no quotes returns null and follows a new list', () => {
  const p = createPicker(() => 0.5);
  assert.equal(p.next(), null);
  p.set(['x']);
  assert.equal(p.next(), 'x');
  p.set(['y', 'z']);
  assert.ok(['y', 'z'].includes(p.next()!));
});

test('quoteDelay stays inside the chosen range', () => {
  for (const r of [0, 0.5, 0.999]) {
    const ms = quoteDelay('normal', () => r);
    assert.ok(ms >= QUOTE_EVERY.normal[0] * 60_000 && ms <= QUOTE_EVERY.normal[1] * 60_000, String(ms));
  }
  assert.ok(quoteDelay('often', () => 0) < quoteDelay('rare', () => 0));
});

test('Spark only speaks when it would not interrupt', () => {
  const ok = { pose: 'idle', mode: 'roam', hint: 0, chatOpen: false, typedAgoMs: 60_000 } as const;
  assert.equal(canSayQuote(ok), true);
  assert.equal(canSayQuote({ ...ok, pose: 'walk' }), true);
  assert.equal(canSayQuote({ ...ok, pose: 'sit', mode: 'sit' }), true);
  assert.equal(canSayQuote({ ...ok, pose: 'sleep' }), false);
  assert.equal(canSayQuote({ ...ok, mode: 'sleep' }), false);
  assert.equal(canSayQuote({ ...ok, pose: 'run' }), false);
  assert.equal(canSayQuote({ ...ok, pose: 'think' }), false);
  assert.equal(canSayQuote({ ...ok, hint: 2 }), false);
  assert.equal(canSayQuote({ ...ok, chatOpen: true }), false);
  assert.equal(canSayQuote({ ...ok, typedAgoMs: 3000 }), false);
});
