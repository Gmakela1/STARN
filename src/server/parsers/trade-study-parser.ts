export interface TradeStudyCandidate {
  candidate: string;
  specs: string;
  satisfies: 'compliant' | 'warning' | 'non_compliant';
  leadTime: string;
  source: string;
  estPrice: number | null;
}

export interface SubsystemTradeStudy {
  subsystemId: string;
  subsystemName: string;
  requirements: string[];
  candidates: TradeStudyCandidate[];
  rationale: string;
}

function parseCompliance(cell: string): 'compliant' | 'warning' | 'non_compliant' {
  if (cell.includes('✅') || /satisfies|yes|pass/i.test(cell)) return 'compliant';
  if (cell.includes('⚠️') || /warning|partial|risk/i.test(cell)) return 'warning';
  if (cell.includes('❌') || /no|fail|non-compliant/i.test(cell)) return 'non_compliant';
  return 'compliant';
}

function parsePrice(cell: string): number | null {
  const match = cell.match(/\$([0-9,.]+)/);
  if (!match) return null;
  const num = Number(match[1].replace(/,/g, ''));
  return Number.isNaN(num) ? null : num;
}

/**
 * Parses docs/TRADE_STUDY.md into structured subsystem trade studies with
 * candidate alternatives, requirements traceability, and selection rationales.
 */
export function parseTradeStudyDocument(markdown: string): SubsystemTradeStudy[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const results: SubsystemTradeStudy[] = [];

  let currentSubsystem: SubsystemTradeStudy | null = null;
  let inTable = false;
  let inRationale = false;
  const rationaleLines: string[] = [];

  const finalizeCurrent = () => {
    if (currentSubsystem) {
      if (rationaleLines.length > 0) {
        currentSubsystem.rationale = rationaleLines.join('\n').trim();
        rationaleLines.length = 0;
      }
      if (currentSubsystem.candidates.length > 0 || currentSubsystem.requirements.length > 0) {
        results.push(currentSubsystem);
      }
      currentSubsystem = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Section header: ## SS-01: Traction Motor or ## SS-01 Traction Motor
    const sectionMatch = trimmed.match(/^##\s+(SS-\d+)[-:\s]*(.*)$/i);
    if (sectionMatch) {
      finalizeCurrent();
      currentSubsystem = {
        subsystemId: sectionMatch[1].toUpperCase(),
        subsystemName: sectionMatch[2].trim(),
        requirements: [],
        candidates: [],
        rationale: ''
      };
      inTable = false;
      inRationale = false;
      continue;
    }

    if (!currentSubsystem) continue;

    // Requirement bullet: - **Requirement SS-01.a:** 6.0 kW...
    if (trimmed.startsWith('-') && /requirement/i.test(trimmed)) {
      currentSubsystem.requirements.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }

    // Rationale header
    if (/^###\s+.*rationale/i.test(trimmed) || /^###\s+.*selection/i.test(trimmed)) {
      inTable = false;
      inRationale = true;
      continue;
    }

    // Another subheader inside section
    if (trimmed.startsWith('###')) {
      inTable = false;
      inRationale = false;
      continue;
    }

    // Markdown table row
    if (trimmed.startsWith('|')) {
      const cells = trimmed
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(c => c.trim());

      // Header or divider row
      if (cells.some(c => /candidate/i.test(c)) || cells.every(c => /^[-:\s]+$/.test(c))) {
        inTable = true;
        inRationale = false;
        continue;
      }

      if (inTable && cells.length >= 5) {
        // Candidate | Specs | Satisfies? | Lead Time | Source | Est. Price
        const candidate = cells[0];
        const specs = cells[1] ?? '';
        const satisfies = parseCompliance(cells[2] ?? '');
        const leadTime = cells[3] ?? '';
        const source = cells[4] ?? '';
        const estPrice = cells[5] ? parsePrice(cells[5]) : null;

        currentSubsystem.candidates.push({
          candidate,
          specs,
          satisfies,
          leadTime,
          source,
          estPrice
        });
        continue;
      }
    }

    if (inRationale && trimmed.length > 0) {
      rationaleLines.push(trimmed);
    }
  }

  finalizeCurrent();
  return results;
}
