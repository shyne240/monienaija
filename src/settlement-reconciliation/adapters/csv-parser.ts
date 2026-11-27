/**
 * Deterministic RFC-4180 CSV parser for external settlement/statement exports.
 * Supports quoted fields, embedded commas, CRLF/LF newlines, and header normalization.
 */
export interface ParsedCsvTable {
  readonly headers: readonly string[];
  readonly normalizedHeaders: readonly string[];
  readonly rows: readonly {
    readonly rowNumber: number;
    readonly values: Readonly<Record<string, string>>;
  }[];
}

export function normalizeCsvHeader(header: string): string {
  return header
    .trim()
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseCsvTable(content: string): ParsedCsvTable {
  const cleaned = content.replace(/^\uFEFF/, '');
  const rawRows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (ch === '\r') {
      if (cleaned[i + 1] === '\n') i += 1;
      currentRow.push(currentField.trim());
      currentField = '';
      if (currentRow.some((cell) => cell.length > 0)) {
        rawRows.push(currentRow);
      }
      currentRow = [];
    } else if (ch === '\n') {
      currentRow.push(currentField.trim());
      currentField = '';
      if (currentRow.some((cell) => cell.length > 0)) {
        rawRows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += ch;
    }
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: unterminated quoted field');
  }
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rawRows.push(currentRow);
    }
  }

  if (rawRows.length === 0) {
    return { headers: [], normalizedHeaders: [], rows: [] };
  }

  const headers = rawRows[0]!;
  const normalizedHeaders = headers.map(normalizeCsvHeader);
  const rows = rawRows.slice(1).map((cells, idx) => {
    const values: Record<string, string> = {};
    for (let col = 0; col < normalizedHeaders.length; col += 1) {
      const key = normalizedHeaders[col];
      if (!key) continue;
      values[key] = cells[col] ?? '';
    }
    return {
      rowNumber: idx + 1,
      values,
    };
  });

  return { headers, normalizedHeaders, rows };
}

export function detectFileFormat(fileName: string, content: string): 'JSON' | 'CSV' {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'JSON';
  }
  if (/\.json$/i.test(fileName.trim())) {
    return 'JSON';
  }
  return 'CSV';
}
