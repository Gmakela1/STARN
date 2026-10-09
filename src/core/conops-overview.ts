/**
 * Extracts the human-readable project overview from CONOPS Section 1:
 * the prose between the "## 1." heading and the first "###" subsection
 * (or the next "##" section). Returns null when absent or empty.
 */
export function extractConopsOverview(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(l => /^##\s+1\.\s/.test(l));
  if (start === -1) return null;

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{2,3}\s/.test(line)) break;
    body.push(line);
  }
  const text = body.join('\n').trim();
  return text.length > 0 ? text : null;
}
