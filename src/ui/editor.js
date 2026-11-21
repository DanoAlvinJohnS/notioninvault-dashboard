import { $, md, esc } from './util.js';

const TABLE = '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n';
const TOOLS = [
  ['H', 'Heading', t => t.line('## ')], ['B', 'Bold (Ctrl+B)', t => t.wrap('**', '**', 'bold')], ['I', 'Italic (Ctrl+I)', t => t.wrap('*', '*', 'italic')],
  ['•', 'Bulleted list', t => t.line('- ')], ['1.', 'Numbered list', t => t.line('1. ')], ['☐', 'Checklist', t => t.line('- [ ] ')],
  ['❝', 'Quote', t => t.line('> ')], ['</>', 'Code', t => t.wrap('`', '`', 'code')], ['Table', 'Insert table', t => t.block(TABLE)],
];

/* Markdown editor with a docs-style toolbar and live preview. Stores plain markdown, so Obsidian renders it natively. */
export function mountEditor(host) {
  host.innerHTML = `<div class="ed"><div class="ed-t">${TOOLS.map((t, i) => `<button type="button" data-i="${i}" title="${t[1]}">${esc(t[0])}</button>`).join('')}
    <span class="sp"></span><button type="button" data-prev title="Toggle preview">Preview</button></div>
    <textarea placeholder="Write details. Use the toolbar for bullets, tables and more."></textarea><div class="prose" hidden></div></div>`;
  const ta = $('textarea', host), pv = $('.prose', host), pb = $('[data-prev]', host);

  const tools = {
    wrap(a, b, ph) {
      const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || ph;
      ta.setRangeText(a + sel + b, s, e, 'select'); ta.setSelectionRange(s + a.length, s + a.length + sel.length);
    },
    line(prefix) {
      const s = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1, e = ta.selectionEnd;
      const text = ta.value.slice(s, e).split('\n').map(l => prefix + l).join('\n');
      ta.setRangeText(text, s, e, 'end');
    },
    block(text) {
      const before = ta.value.slice(0, ta.selectionStart);
      const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';   // blank line so tables parse
      ta.setRangeText(pre + text, ta.selectionStart, ta.selectionEnd, 'end');
    },
  };

  host.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.i) { TOOLS[b.dataset.i][2](tools); ta.focus(); }
    else if (b.hasAttribute('data-prev')) {
      const show = pv.hidden; pv.hidden = !show; ta.hidden = show; pb.classList.toggle('on', show);
      pb.textContent = show ? 'Edit' : 'Preview';
      if (show) pv.innerHTML = md(ta.value) || '<p class="empty">Nothing to preview yet.</p>';
      else ta.focus();
    }
  });

  ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && 'bi'.includes(e.key.toLowerCase())) { e.preventDefault(); e.key.toLowerCase() === 'b' ? tools.wrap('**', '**', 'bold') : tools.wrap('*', '*', 'italic'); return; }
    if (e.key !== 'Enter' || e.shiftKey) return;
    const pos = ta.selectionStart, ls = ta.value.lastIndexOf('\n', pos - 1) + 1, line = ta.value.slice(ls, pos);
    const m = line.match(/^(\s*)(- \[[ x]\] |[-*] |(\d+)\. )/);
    if (!m) return;
    e.preventDefault();
    if (line.trim() === m[2].trim()) ta.setRangeText('', ls, pos, 'end');          // empty item: end the list
    else ta.setRangeText('\n' + m[1] + (m[3] ? `${+m[3] + 1}. ` : m[2].replace('[x]', '[ ]')), pos, ta.selectionEnd, 'end');
  });

  return { get: () => ta.value };
}
