import type { RawTable } from "../parse/tablesSidecar.ts";

export interface TableSetMetrics {
  tableCount: number;
  totalRows: number;
  maxEffectiveColumns: number;
  emptyCellRate: number;
  missingHeaderTables: number;
}

export interface TableComparisonSummary {
  coord: TableSetMetrics;
  python: TableSetMetrics;
  deltas: {
    tableCount: number;
    totalRows: number;
    maxEffectiveColumns: number;
    emptyCellRate: number;
    missingHeaderTables: number;
  };
}

function effectiveColumns(rows: (string | null)[][]): number {
  let max = 0;
  for (const row of rows) {
    const count = row.filter((cell) => (cell ?? "").trim() !== "").length;
    max = Math.max(max, count);
  }
  return max;
}

function hasMissingHeaders(table: RawTable): boolean {
  const first = table.rows[0] ?? [];
  return first.length === 0 || first.some((cell) => (cell ?? "").trim() === "");
}

export function summarizeTableSet(tables: RawTable[]): TableSetMetrics {
  let totalCells = 0;
  let emptyCells = 0;
  let maxEffectiveColumns = 0;

  for (const table of tables) {
    const cols = Math.max(0, ...table.rows.map((row) => row.length));
    maxEffectiveColumns = Math.max(maxEffectiveColumns, effectiveColumns(table.rows));
    for (const row of table.rows) {
      for (let i = 0; i < cols; i++) {
        totalCells++;
        if ((row[i] ?? "").trim() === "") emptyCells++;
      }
    }
  }

  return {
    tableCount: tables.length,
    totalRows: tables.reduce((sum, table) => sum + table.rows.length, 0),
    maxEffectiveColumns,
    emptyCellRate:
      totalCells === 0 ? 0 : Number((emptyCells / totalCells).toFixed(4)),
    missingHeaderTables: tables.filter(hasMissingHeaders).length,
  };
}

export function summarizeTableComparison(
  coordTables: RawTable[],
  pythonTables: RawTable[]
): TableComparisonSummary {
  const coord = summarizeTableSet(coordTables);
  const python = summarizeTableSet(pythonTables);
  return {
    coord,
    python,
    deltas: {
      tableCount: coord.tableCount - python.tableCount,
      totalRows: coord.totalRows - python.totalRows,
      maxEffectiveColumns: coord.maxEffectiveColumns - python.maxEffectiveColumns,
      emptyCellRate: Number((coord.emptyCellRate - python.emptyCellRate).toFixed(4)),
      missingHeaderTables: coord.missingHeaderTables - python.missingHeaderTables,
    },
  };
}
