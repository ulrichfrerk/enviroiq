type RawSqlResult = { rows?: Record<string, unknown>[] } | Record<string, unknown>[];

export function sqlRow(result: unknown, index = 0): Record<string, unknown> {
  const raw = result as RawSqlResult;
  if (raw && "rows" in raw && Array.isArray((raw as { rows?: unknown[] }).rows)) {
    return (raw as { rows: Record<string, unknown>[] }).rows[index] || {};
  }
  if (Array.isArray(raw)) {
    return (raw as Record<string, unknown>[])[index] || {};
  }
  return {};
}

export function sqlRows(result: unknown): Record<string, unknown>[] {
  const raw = result as RawSqlResult;
  if (raw && "rows" in raw && Array.isArray((raw as { rows?: unknown[] }).rows)) {
    return (raw as { rows: Record<string, unknown>[] }).rows;
  }
  if (Array.isArray(raw)) {
    return raw as Record<string, unknown>[];
  }
  return [];
}

export function numCol(row: Record<string, unknown>, col: string): number {
  return parseFloat(String(row[col] ?? "0")) || 0;
}

export function intCol(row: Record<string, unknown>, col: string): number {
  return parseInt(String(row[col] ?? "0"), 10) || 0;
}

export function strCol(row: Record<string, unknown>, col: string): string {
  return String(row[col] ?? "");
}
