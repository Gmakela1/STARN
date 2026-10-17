export interface CharterSection {
  heading: string;
  body: string;
}

/**
 * Extracts the charter subsections from CONOPS Section 1.
 * Subsections titled "### System-Level Capabilities" are excluded
 * (Architecture depends on them, but they are not part of the project charter).
 * Any prose before the first subsection becomes an initial `{ heading: 'Overview', body: ... }`.
 * If Section 1 has no subsections, the entire prose is returned as a single 'Overview' entry.
 */
export function extractConopsCharter(markdown: string): CharterSection[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(l => /^##\s+1\.\s/.test(l));
  if (start === -1) return [];

  // Find where Section 1 ends (next top-level section /^##\s+[2-9]\./ or next /^##\s/)
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+[^#]/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const section1Lines = lines.slice(start + 1, end);
  const result: CharterSection[] = [];

  // Collect any intro prose before the first ###
  const firstSubIdx = section1Lines.findIndex(l => /^###\s+/.test(l));

  if (firstSubIdx === -1) {
    const text = section1Lines.join('\n').trim();
    if (text.length > 0) {
      result.push({ heading: 'Overview', body: text });
    }
    return result;
  }

  const introText = section1Lines.slice(0, firstSubIdx).join('\n').trim();
  if (introText.length > 0) {
    result.push({ heading: 'Overview', body: introText });
  }

  // Parse ### subsections
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentHeading !== null) {
      const trimmedBody = currentBody.join('\n').trim();
      const isSystemLevel = /^system-level\s+capabilities/i.test(currentHeading.trim());
      if (!isSystemLevel && trimmedBody.length > 0) {
        result.push({ heading: currentHeading, body: trimmedBody });
      }
    }
    currentHeading = null;
    currentBody = [];
  };

  for (let i = firstSubIdx; i < section1Lines.length; i++) {
    const line = section1Lines[i];
    const match = line.match(/^###\s+(.*)$/);
    if (match) {
      flush();
      currentHeading = match[1].trim();
    } else {
      currentBody.push(line);
    }
  }
  flush();

  return result;
}

/**
 * Extracts the human-readable project overview from CONOPS Section 1:
 * - If intro prose exists before the first ### subsection, returns that.
 * - Otherwise falls back to the Purpose section body.
 * - Otherwise falls back to the first available charter subsection body.
 * Returns null when absent or empty.
 */
export function extractConopsOverview(markdown: string): string | null {
  const charter = extractConopsCharter(markdown);
  if (charter.length === 0) return null;

  // 1. If an explicit 'Overview' intro section exists, prefer that
  const overview = charter.find(s => s.heading.toLowerCase() === 'overview');
  if (overview && overview.body.trim().length > 0) {
    return overview.body.trim();
  }

  // 2. Otherwise look for Purpose
  const purpose = charter.find(s => s.heading.toLowerCase() === 'purpose');
  if (purpose && purpose.body.trim().length > 0) {
    return purpose.body.trim();
  }

  // 3. Otherwise first available subsection
  return charter[0].body.trim() || null;
}
