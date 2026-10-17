import {
  BomItem,
  BomFinancials,
  BOM_STATUSES,
  parseBomDocument
} from './bom-parser.js';

export { BomItem, BomFinancials, BOM_STATUSES, parseBomDocument };

export interface BomItemPatch {
  description?: string;
  qty?: number;
  source?: string;
  tracking?: string;
  status?: string;
  estUnit?: number | null;
  actualTotal?: number | null;
}

export function escapeTablePipes(str: string): string {
  return str.replace(/(?<!\\)\|/g, '\\|');
}

function parseMoney(cell: string): number | null {
  const cleaned = cell.replace(/[*`]/g, '').trim();
  if (!cleaned || cleaned === '—' || cleaned === '-' || cleaned.toLowerCase() === 'n/a') return null;
  const match = cleaned.replace(/,/g, '').match(/-?\+?\$?\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return cleaned.startsWith('-') || cleaned.includes('-$') ? -Math.abs(value) : value;
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map(c => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')) || c === '');
}

interface LedgerRow {
  lineIndex: number;
  cells: string[];
}

function findLedgerRows(lines: string[]): { headerIndex: number; rows: LedgerRow[] } {
  let headerIndex = -1;
  const rows: LedgerRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) continue;
    const cells = splitRow(line);
    if (headerIndex === -1) {
      if (cells.some(c => /item\s*#/i.test(c))) headerIndex = i;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    if (i > headerIndex && lines[i].trim().startsWith('|')) {
      rows.push({ lineIndex: i, cells });
    }
  }

  if (headerIndex >= 0 && rows.length > 0) {
    const contiguous: LedgerRow[] = [];
    let expected = headerIndex + 1;
    for (const row of rows) {
      while (expected < row.lineIndex) {
        const between = lines[expected].trim();
        if (between.startsWith('|') && isSeparatorRow(splitRow(between))) {
          expected++;
          continue;
        }
        break;
      }
      if (row.lineIndex !== expected) break;
      contiguous.push(row);
      expected = row.lineIndex + 1;
    }
    return { headerIndex, rows: contiguous };
  }

  return { headerIndex, rows };
}

export function updateBomItemInMarkdown(
  markdown: string,
  itemId: string,
  updates: BomItemPatch
): string {
  const lines = markdown.split('\n');
  const { rows } = findLedgerRows(lines);

  const cleanItemId = itemId.replace(/\*/g, '').trim().toLowerCase();
  const target = rows.find(r => r.cells[0].replace(/\*/g, '').trim().toLowerCase() === cleanItemId);

  if (!target) {
    throw new Error(`BOM item "${itemId}" not found in ledger`);
  }

  const cells = [...target.cells];

  if (updates.description !== undefined) {
    cells[1] = escapeTablePipes(updates.description);
  }
  if (updates.qty !== undefined) {
    cells[3] = String(updates.qty);
  }
  if (updates.source !== undefined) {
    cells[4] = escapeTablePipes(updates.source);
  }
  if (updates.tracking !== undefined) {
    cells[5] = escapeTablePipes(updates.tracking);
  }
  if (updates.status !== undefined) {
    cells[6] = updates.status;
  }
  if (updates.estUnit !== undefined) {
    cells[7] = formatMoney(updates.estUnit);
  }

  // Recalculate estTotal if qty or estUnit updated
  if (updates.qty !== undefined || updates.estUnit !== undefined) {
    const qty = updates.qty !== undefined ? updates.qty : (parseInt(cells[3], 10) || 0);
    const estU = updates.estUnit !== undefined ? updates.estUnit : parseMoney(cells[7]);
    if (estU !== null && qty > 0) {
      cells[8] = formatMoney(qty * estU);
    }
  }

  if (updates.actualTotal !== undefined) {
    cells[9] = formatMoney(updates.actualTotal);
  }

  // Recalculate variance (actualTotal - estTotal)
  const currentActual = parseMoney(cells[9]);
  const currentEstTotal = parseMoney(cells[8]);
  if (currentActual !== null && currentEstTotal !== null) {
    const diff = Math.round((currentActual - currentEstTotal) * 100) / 100;
    cells[10] = diff === 0 ? '$0.00' : diff > 0 ? `+$${diff.toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`;
  } else {
    cells[10] = '—';
  }

  lines[target.lineIndex] = `| ${cells.join(' | ')} |`;

  // Now recalculate Financial & Procurement Rollup section
  const interimDoc = lines.join('\n');
  const parsed = parseBomDocument(interimDoc);
  const items = parsed.items;

  const totalEst = items.reduce((sum, i) => sum + (i.estTotal ?? 0), 0);
  const totalAct = items.reduce((sum, i) => sum + (i.actualTotal ?? 0), 0);
  const totalVar = Math.round((totalAct - totalEst) * 100) / 100;

  const committedCount = items.filter(i => {
    const s = i.status.trim().toLowerCase();
    return s !== 'identified' && s !== '';
  }).length;

  const verifiedCount = items.filter(i => {
    const s = i.status.trim().toLowerCase();
    return s === 'received' || s === 'bench tested' || s === 'consumed';
  }).length;

  const progressPercent = items.length > 0 ? Math.round((committedCount / items.length) * 100) : 0;
  const verifiedPercent = items.length > 0 ? Math.round((verifiedCount / items.length) * 100) : 0;

  // Replace financial lines in place
  let inFinancials = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^##\s*2\.\s*Financial/i)) {
      inFinancials = true;
      continue;
    }
    if (inFinancials) {
      if (line.startsWith('## ') || line.startsWith('---')) {
        inFinancials = false;
        continue;
      }
      if (line.includes('Total Estimated Budget:')) {
        lines[i] = `- **Total Estimated Budget:** $${totalEst.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      } else if (line.includes('Total Actual Committed Spend:')) {
        lines[i] = `- **Total Actual Committed Spend:** $${totalAct.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      } else if (line.includes('Net Budget Variance:')) {
        const sign = totalVar > 0 ? '+' : totalVar < 0 ? '-' : '';
        const onTrack = totalVar <= 0 ? ' (on track)' : ' (over budget)';
        lines[i] = `- **Net Budget Variance:** ${sign}$${Math.abs(totalVar).toFixed(2)}${onTrack}`;
      } else if (line.includes('Procurement Progress:')) {
        lines[i] = `- **Procurement Progress:** ${committedCount} of ${items.length} line items committed (${progressPercent}%) | ${verifiedCount} Verified / Bench Tested (${verifiedPercent}%)`;
      }
    }
  }

  return lines.join('\n');
}
