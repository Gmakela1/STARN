/**
 * Headless parser for docs/BOM.md — the Tier 1 Master Procurement Ledger.
 * Parses the pipe-table into typed items, computes financial rollups, and
 * supports surgical single-row updates that leave all other content intact.
 */

export interface BomItem {
  id: string;
  description: string;
  subsystem: string;
  qty: number;
  source: string;
  tracking: string;
  status: string;
  estUnit: number | null;
  estTotal: number | null;
  actualTotal: number | null;
  variance: number | null;
}

export interface BomFinancials {
  totalEstimated: number;
  totalActual: number;
  netVariance: number;
  /** Percent of line items with status beyond "Identified". */
  procurementProgressPercent: number;
}

export const BOM_STATUSES = ['Identified', 'Ordered', 'Shipped', 'Received', 'Bench Tested'] as const;

function parseMoney(cell: string): number | null {
  const cleaned = cell.replace(/[*`]/g, '').trim();
  if (!cleaned || cleaned === '—' || cleaned === '-' || cleaned.toLowerCase() === 'n/a') return null;
  const match = cleaned.replace(/,/g, '').match(/-?\+?\$?\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return cleaned.startsWith('-') || cleaned.includes('-$') ? -Math.abs(value) : value;
}

function splitRow(line: string): string[] {
  // Strip leading/trailing pipe then split on unescaped pipes.
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(c => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')) || c === '');
}

interface LedgerRow {
  lineIndex: number;
  cells: string[];
}

/** Finds the master ledger table rows (the table whose header contains "Item #"). */
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
    // Table ends at first non-table line after header
    if (i > headerIndex && lines[i].trim().startsWith('|')) {
      rows.push({ lineIndex: i, cells });
    }
  }

  // Trim rows that belong to a different table (after a gap)
  if (headerIndex >= 0 && rows.length > 0) {
    const contiguous: LedgerRow[] = [];
    let expected = headerIndex + 1;
    for (const row of rows) {
      // allow separator row right after header
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

function rowToItem(cells: string[]): BomItem | null {
  if (cells.length < 11) return null;
  const id = cells[0].replace(/\*/g, '').trim();
  if (!id) return null;
  return {
    id,
    description: cells[1],
    subsystem: cells[2],
    qty: parseInt(cells[3], 10) || 0,
    source: cells[4],
    tracking: cells[5],
    status: cells[6],
    estUnit: parseMoney(cells[7]),
    estTotal: parseMoney(cells[8]),
    actualTotal: parseMoney(cells[9]),
    variance: parseMoney(cells[10])
  };
}

export function parseBomDocument(markdown: string): { items: BomItem[]; financials: BomFinancials } {
  const lines = markdown.split('\n');
  const { rows } = findLedgerRows(lines);

  const items: BomItem[] = [];
  for (const row of rows) {
    const item = rowToItem(row.cells);
    if (item) items.push(item);
  }

  const totalEstimated = items.reduce((sum, i) => sum + (i.estTotal ?? 0), 0);
  const totalActual = items.reduce((sum, i) => sum + (i.actualTotal ?? 0), 0);
  const netVariance = items.reduce((sum, i) => sum + (i.variance ?? 0), 0);
  const committed = items.filter(i => i.status.trim().toLowerCase() !== 'identified').length;
  const procurementProgressPercent = items.length > 0 ? Math.round((committed / items.length) * 100) : 0;

  return {
    items,
    financials: {
      totalEstimated: Math.round(totalEstimated * 100) / 100,
      totalActual: Math.round(totalActual * 100) / 100,
      netVariance: Math.round(netVariance * 100) / 100,
      procurementProgressPercent
    }
  };
}

export interface BomItemUpdate {
  qty?: number;
  tracking?: string;
  status?: string;
  actualTotal?: number | null;
}

function formatMoney(value: number | null): string {
  if (value === null) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

/**
 * Surgically updates a single ledger row by item ID, preserving all other
 * lines byte-for-byte. Recomputes the row's variance when actualTotal changes.
 */
export function updateBomRow(markdown: string, itemId: string, updates: BomItemUpdate): string {
  const lines = markdown.split('\n');
  const { rows } = findLedgerRows(lines);

  const target = rows.find(r => r.cells[0].replace(/\*/g, '').trim() === itemId);
  if (!target) {
    throw new Error(`BOM item "${itemId}" not found in ledger`);
  }

  const cells = [...target.cells];
  if (updates.qty !== undefined) cells[3] = String(updates.qty);
  if (updates.tracking !== undefined) cells[5] = updates.tracking;
  if (updates.status !== undefined) cells[6] = updates.status;
  if (updates.actualTotal !== undefined) {
    cells[9] = formatMoney(updates.actualTotal);
    const est = parseMoney(cells[8]);
    if (updates.actualTotal !== null && est !== null) {
      const diff = Math.round((updates.actualTotal - est) * 100) / 100;
      cells[10] = diff === 0 ? '$0.00' : diff > 0 ? `+$${diff.toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`;
    } else {
      cells[10] = '—';
    }
  }

  lines[target.lineIndex] = `| ${cells.join(' | ')} |`;
  return lines.join('\n');
}
