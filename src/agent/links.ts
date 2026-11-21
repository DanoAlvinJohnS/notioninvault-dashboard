// Adds [[target]] to a note's "Related:" line (the convention task notes already use), or starts one at the end.
export function addRelatedLink(text: string, target: string): string {
  const tag = `[[${target}]]`;
  const lines = text.split('\n');
  const at = lines.findIndex(l => l.startsWith('Related:'));
  if (at >= 0) {
    if (lines[at].includes(tag)) return text;
    lines[at] = lines[at].replace(/\s+$/, '') + `, ${tag}`;
    return lines.join('\n');
  }
  if (text.includes(tag)) return text;
  return text.replace(/\s+$/, '') + `\n\nRelated: ${tag}\n`;
}
