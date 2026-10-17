import { BomItem, BomFinancials, BOM_STATUSES } from '../server/parsers/bom-parser.js';
import { SubsystemTradeStudy } from '../server/parsers/trade-study-parser.js';

export interface BomData {
  items: BomItem[];
  financials: BomFinancials;
  tradeStudy?: string | null;
}

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPartsTable(data: BomData): string {
  const lines: string[] = [];
  lines.push('========================================================================================');
  lines.push('                           BOM & PARTS PROCUREMENT LEDGER                               ');
  lines.push('========================================================================================');
  lines.push('ITEM #     | DESCRIPTION                    | QTY | STATUS       | TRACKING             | ACTUAL   ');
  lines.push('-----------+--------------------------------+-----+--------------+----------------------+----------');

  for (const item of data.items) {
    const id = item.id.padEnd(10).slice(0, 10);
    const desc = item.description.padEnd(30).slice(0, 30);
    const qty = String(item.qty).padStart(3).slice(0, 3);
    const st = item.status.padEnd(12).slice(0, 12);
    const trk = (item.tracking || '—').padEnd(20);
    const act = money(item.actualTotal).padStart(8).slice(0, 8);
    lines.push(`${id} | ${desc} | ${qty} | ${st} | ${trk} | ${act}`);
  }

  lines.push('----------------------------------------------------------------------------------------');
  lines.push(`Total Estimated Budget: ${money(data.financials.totalEstimated)}`);
  lines.push(`Total Actual Committed: ${money(data.financials.totalActual)}`);
  lines.push(`Net Budget Variance:    ${money(data.financials.netVariance)}`);
  lines.push(`Procurement Progress:   ${data.financials.procurementProgressPercent}% committed`);
  lines.push('========================================================================================');

  return lines.join('\n');
}

export function parsePartsUpdateArgs(argStr: string): {
  itemId?: string;
  status?: string;
  actualTotal?: number;
  tracking?: string;
} {
  const trimmed = argStr.trim();
  if (!trimmed) return {};

  // Tokenize respecting quotes
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(trimmed)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[0]);
  }

  if (tokens.length === 0) return {};

  const itemId = tokens[0];
  let status: string | undefined;
  let actualTotal: number | undefined;
  let trackingParts: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    const matchStatus = BOM_STATUSES.find(s => s.toLowerCase() === tok.toLowerCase());
    if (matchStatus && !status) {
      status = matchStatus;
      continue;
    }

    const cleanNum = tok.replace(/^\$/, '');
    if (!isNaN(Number(cleanNum)) && actualTotal === undefined) {
      actualTotal = Number(cleanNum);
      continue;
    }

    trackingParts.push(tok);
  }

  return {
    itemId,
    status,
    actualTotal,
    tracking: trackingParts.length > 0 ? trackingParts.join(' ') : undefined
  };
}

export function formatTradeStudySummary(studies: SubsystemTradeStudy[]): string {
  const lines: string[] = [];
  lines.push('========================================================================================');
  lines.push('                         SUBSYSTEM CANDIDATE TRADE STUDIES                              ');
  lines.push('========================================================================================');

  if (studies.length === 0) {
    lines.push('No candidate trade studies found in docs/TRADE_STUDY.md.');
    return lines.join('\n');
  }

  for (const study of studies) {
    lines.push(`\n## ${study.subsystemId}: ${study.subsystemName}`);
    if (study.requirements.length > 0) {
      lines.push('Requirements: ' + study.requirements.join(' | '));
    }
    lines.push('----------------------------------------------------------------------------------------');
    lines.push('CANDIDATE                      | SPECS                     | LEAD TIME  | PRICE    ');
    lines.push('-------------------------------+---------------------------+------------+----------');

    for (const c of study.candidates) {
      const name = c.candidate.padEnd(30).slice(0, 30);
      const specs = c.specs.padEnd(25).slice(0, 25);
      const lead = c.leadTime.padEnd(10).slice(0, 10);
      const price = money(c.estPrice).padStart(8).slice(0, 8);
      lines.push(`${name} | ${specs} | ${lead} | ${price}`);
    }

    if (study.rationale) {
      lines.push(`Selection Rationale: ${study.rationale}`);
    }
  }

  lines.push('========================================================================================');
  return lines.join('\n');
}
