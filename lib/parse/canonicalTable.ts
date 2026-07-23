import type { TableModel } from "../types.ts";
import type {
  IgnoredTableFragment,
  RawTableCell,
  RawTableV2,
  TableBBox,
} from "./tableStructure.ts";

export interface CanonicalColumn {
  index: number;
  name: string;
  headerPath: string[];
}

export interface CanonicalCell {
  value: string;
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
  sourcePage: number;
  sourceBBox: TableBBox;
}

export interface CanonicalRow {
  rowId: string;
  sourcePage: number;
  cells: CanonicalCell[];
}

export interface CanonicalTable {
  logicalTableId: string;
  title?: string;
  pageStart: number;
  pageEnd: number;
  sourceBBox: TableBBox;
  columns: CanonicalColumn[];
  rows: CanonicalRow[];
  physicalBoundaries: {
    horizontal: number[];
    vertical: number[];
  };
  warnings: string[];
}

export type CanonicalizationResult =
  | { kind: "table"; table: CanonicalTable }
  | {
      kind: "paragraph_fallback";
      page: number;
      text: string;
      warning: "insufficient_table_structure";
    };

export function canonicalizeRawTable(raw: RawTableV2): CanonicalizationResult {
  const rowCount = raw.gridEvidence.horizontalBoundaries.length - 1;
  const colCount = raw.gridEvidence.verticalBoundaries.length - 1;
  if (!hasTableStructure(raw, rowCount, colCount)) {
    return {
      kind: "paragraph_fallback",
      page: raw.page,
      text: orderedText(raw.cells, raw.ignoredFragments),
      warning: "insufficient_table_structure",
    };
  }

  const slots = buildSlots(raw.cells, rowCount, colCount);
  const headerRowCount = detectHeaderRowCount(raw.cells, rowCount);
  const columns = Array.from({ length: colCount }, (_, colIndex) => {
    const headerPath: string[] = [];
    let previousOwner: RawTableCell | undefined;
    for (let rowIndex = 0; rowIndex < headerRowCount; rowIndex++) {
      const owner = slots[rowIndex]?.[colIndex];
      const value = owner?.text.trim();
      if (owner && owner !== previousOwner && value) headerPath.push(value);
      previousOwner = owner;
    }
    return {
      index: colIndex,
      name: headerPath.at(-1) ?? `列${colIndex + 1}`,
      headerPath: headerPath.length ? headerPath : [`列${colIndex + 1}`],
    };
  });
  const rows = Array.from(
    { length: rowCount - headerRowCount },
    (_, offset): CanonicalRow => {
      const physicalRow = headerRowCount + offset;
      return {
        rowId: `p${raw.page}-row-${offset}`,
        sourcePage: raw.page,
        cells: Array.from({ length: colCount }, (_, colIndex) => {
          const owner = slots[physicalRow]?.[colIndex];
          return ownerToCanonicalCell(owner, raw.page, physicalRow, colIndex);
        }),
      };
    }
  );

  return {
    kind: "table",
    table: {
      logicalTableId: `p${raw.page}-${bboxKey(raw.bbox)}`,
      title: raw.title,
      pageStart: raw.page,
      pageEnd: raw.page,
      sourceBBox: raw.bbox,
      columns,
      rows,
      physicalBoundaries: {
        horizontal: raw.gridEvidence.horizontalBoundaries,
        vertical: raw.gridEvidence.verticalBoundaries,
      },
      warnings: [...raw.warnings],
    },
  };
}

export function buildTableModelFromCanonical(table: CanonicalTable): TableModel {
  const headers = table.columns.map((column) => column.name);
  const rows = table.rows.map((row) => row.cells.map((cell) => cell.value));
  return {
    tableId: table.logicalTableId,
    title: table.title,
    headers,
    headerPaths: table.columns.map((column) => [...column.headerPath]),
    rows,
    markdown: buildMarkdown(headers, rows),
  };
}

function hasTableStructure(
  raw: RawTableV2,
  rowCount: number,
  colCount: number
): boolean {
  if (rowCount < 2 || colCount < 2) return false;
  if (raw.extractionMethod === "lines" && raw.gridEvidence.lineCoverage >= 0.8) {
    return true;
  }
  if (rowCount < 3) return false;
  let occupiedRows = 0;
  for (let row = 0; row < rowCount; row++) {
    const occupiedColumns = new Set<number>();
    for (const cell of raw.cells) {
      if (cell.rowStart <= row && row < cell.rowEnd && cell.text.trim()) {
        for (let col = cell.colStart; col < cell.colEnd; col++) {
          occupiedColumns.add(col);
        }
      }
    }
    if (occupiedColumns.size >= 2) occupiedRows++;
  }
  return occupiedRows / rowCount >= 0.8;
}

function buildSlots(
  cells: RawTableCell[],
  rowCount: number,
  colCount: number
): Array<Array<RawTableCell | undefined>> {
  const slots = Array.from(
    { length: rowCount },
    () => Array<RawTableCell | undefined>(colCount)
  );
  for (const cell of cells) {
    for (let row = cell.rowStart; row < cell.rowEnd; row++) {
      for (let col = cell.colStart; col < cell.colEnd; col++) {
        slots[row][col] = cell;
      }
    }
  }
  return slots;
}

function detectHeaderRowCount(cells: RawTableCell[], rowCount: number): number {
  const firstBandEnd = Math.max(
    1,
    ...cells.filter((cell) => cell.rowStart === 0).map((cell) => cell.rowEnd)
  );
  return Math.min(firstBandEnd, Math.max(1, rowCount - 1));
}

function ownerToCanonicalCell(
  owner: RawTableCell | undefined,
  sourcePage: number,
  physicalRow: number,
  colIndex: number
): CanonicalCell {
  return {
    value: owner?.text.trim() ?? "",
    rowStart: owner?.rowStart ?? physicalRow,
    rowEnd: owner?.rowEnd ?? physicalRow + 1,
    colStart: owner?.colStart ?? colIndex,
    colEnd: owner?.colEnd ?? colIndex + 1,
    sourcePage,
    sourceBBox: owner?.bbox ?? [0, 0, 0, 0],
  };
}

function orderedText(
  cells: RawTableCell[],
  ignoredFragments: IgnoredTableFragment[]
): string {
  return [
    ...cells.map((cell) => ({ text: cell.text, bbox: cell.bbox })),
    ...ignoredFragments.map((fragment) => ({
      text: fragment.text,
      bbox: fragment.bbox,
    })),
  ]
    .sort((left, right) =>
      left.bbox[1] - right.bbox[1] || left.bbox[0] - right.bbox[0]
    )
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join(" ");
}

function bboxKey(bbox: TableBBox): string {
  return bbox.map((value) => Math.round(value * 10)).join("-");
}

function buildMarkdown(headers: string[], rows: string[][]): string {
  const escape = (value: string) => value.replace(/\|/g, "\\|").trim() || " ";
  return [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) =>
      `| ${headers.map((_, index) => escape(row[index] ?? "")).join(" | ")} |`
    ),
  ].join("\n");
}
