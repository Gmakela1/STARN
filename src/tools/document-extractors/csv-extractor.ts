export interface CsvExtractorOptions {
  maxRows?: number;
}

export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (char === '\n' && !insideQuotes) {
      currentRow.push(currentField.trim());
      if (currentRow.some(f => f.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(f => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function formatCsvAsTable(csvText: string, options?: CsvExtractorOptions): string {
  const maxRows = options?.maxRows ?? 250;
  const rows = parseCsvRows(csvText);

  if (rows.length === 0) {
    return '(Empty CSV table)';
  }

  const totalRows = rows.length;
  const displayRows = rows.slice(0, maxRows);
  const colCount = Math.max(...displayRows.map(r => r.length));

  // Normalize column count for every row
  const normalized = displayRows.map(r => {
    const copy = [...r];
    while (copy.length < colCount) copy.push('');
    return copy.map(cell => cell.replace(/\|/g, '\\|')); // escape pipes
  });

  const header = normalized[0];
  const separator = new Array(colCount).fill('---');
  const dataRows = normalized.slice(1);

  const lines: string[] = [];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${separator.map(s => `---|`).join('')}`);

  for (const r of dataRows) {
    lines.push(`| ${r.join(' | ')} |`);
  }

  if (totalRows > maxRows) {
    lines.push(`\n*(Table truncated: showing ${maxRows} of ${totalRows} rows)*`);
  }

  return lines.join('\n');
}
