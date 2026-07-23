export type TableBBox = [number, number, number, number];

export interface TableGridEvidence {
  horizontalBoundaries: number[];
  verticalBoundaries: number[];
  lineCoverage: number;
}

export interface RawTableCell {
  text: string;
  bbox: TableBBox;
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
  sourceOrder: number[];
}

export interface IgnoredTableFragment {
  text: string;
  bbox: TableBBox;
  reason: string;
}

export interface RawTableV2 {
  schemaVersion: 2;
  page: number;
  bbox: TableBBox;
  title?: string;
  extractionMethod: "lines" | "text" | "fitz";
  gridEvidence: TableGridEvidence;
  cells: RawTableCell[];
  ignoredFragments: IgnoredTableFragment[];
  warnings: string[];
}

export function parseRawTableV2(value: unknown): RawTableV2 {
  if (!isRecord(value) || value.schemaVersion !== 2) {
    throw new Error("invalid_raw_table_schema");
  }
  if (!Number.isInteger(value.page) || Number(value.page) < 1) {
    throw new Error("invalid_raw_table_page");
  }
  const bbox = parseBBox(value.bbox, "invalid_raw_table_bbox");
  if (
    value.extractionMethod !== "lines"
    && value.extractionMethod !== "text"
    && value.extractionMethod !== "fitz"
  ) {
    throw new Error("invalid_raw_table_extraction_method");
  }
  if (!isRecord(value.gridEvidence)) {
    throw new Error("invalid_raw_table_grid_evidence");
  }
  const horizontalBoundaries = parseBoundaries(
    value.gridEvidence.horizontalBoundaries
  );
  const verticalBoundaries = parseBoundaries(
    value.gridEvidence.verticalBoundaries
  );
  const lineCoverage = Number(value.gridEvidence.lineCoverage);
  if (!Number.isFinite(lineCoverage) || lineCoverage < 0 || lineCoverage > 1) {
    throw new Error("invalid_raw_table_line_coverage");
  }
  if (!Array.isArray(value.cells)) {
    throw new Error("invalid_raw_table_cells");
  }
  const cells = value.cells.map((cell) =>
    parseCell(cell, horizontalBoundaries.length - 1, verticalBoundaries.length - 1)
  );
  assertNoCellOverlap(cells);
  if (!Array.isArray(value.ignoredFragments) || !Array.isArray(value.warnings)) {
    throw new Error("invalid_raw_table_diagnostics");
  }

  return {
    schemaVersion: 2,
    page: Number(value.page),
    bbox,
    title: typeof value.title === "string" && value.title.trim()
      ? value.title.trim()
      : undefined,
    extractionMethod: value.extractionMethod,
    gridEvidence: {
      horizontalBoundaries,
      verticalBoundaries,
      lineCoverage,
    },
    cells,
    ignoredFragments: value.ignoredFragments.map(parseIgnoredFragment),
    warnings: value.warnings.map((warning) => {
      if (typeof warning !== "string") throw new Error("invalid_raw_table_warning");
      return warning;
    }),
  };
}

function parseCell(value: unknown, rowCount: number, colCount: number): RawTableCell {
  if (!isRecord(value) || typeof value.text !== "string") {
    throw new Error("invalid_raw_table_cell");
  }
  const rowStart = parseIndex(value.rowStart);
  const rowEnd = parseIndex(value.rowEnd);
  const colStart = parseIndex(value.colStart);
  const colEnd = parseIndex(value.colEnd);
  if (
    rowStart >= rowEnd
    || colStart >= colEnd
    || rowEnd > rowCount
    || colEnd > colCount
  ) {
    throw new Error("invalid_raw_table_cell_span");
  }
  if (
    !Array.isArray(value.sourceOrder)
    || value.sourceOrder.some((entry) => !Number.isInteger(entry) || Number(entry) < 0)
  ) {
    throw new Error("invalid_raw_table_source_order");
  }
  return {
    text: value.text,
    bbox: parseBBox(value.bbox, "invalid_raw_table_cell_bbox"),
    rowStart,
    rowEnd,
    colStart,
    colEnd,
    sourceOrder: value.sourceOrder.map(Number),
  };
}

function assertNoCellOverlap(cells: RawTableCell[]): void {
  const occupied = new Set<string>();
  for (const cell of cells) {
    for (let row = cell.rowStart; row < cell.rowEnd; row++) {
      for (let col = cell.colStart; col < cell.colEnd; col++) {
        const slot = `${row}:${col}`;
        if (occupied.has(slot)) throw new Error("overlapping_raw_table_cells");
        occupied.add(slot);
      }
    }
  }
}

function parseIgnoredFragment(value: unknown): IgnoredTableFragment {
  if (
    !isRecord(value)
    || typeof value.text !== "string"
    || typeof value.reason !== "string"
    || !value.reason.trim()
  ) {
    throw new Error("invalid_raw_table_ignored_fragment");
  }
  return {
    text: value.text,
    bbox: parseBBox(value.bbox, "invalid_raw_table_ignored_bbox"),
    reason: value.reason,
  };
}

function parseBBox(value: unknown, errorCode: string): TableBBox {
  if (
    !Array.isArray(value)
    || value.length !== 4
    || value.some((entry) => !Number.isFinite(Number(entry)))
  ) {
    throw new Error(errorCode);
  }
  const bbox = value.map(Number) as TableBBox;
  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) throw new Error(errorCode);
  return bbox;
}

function parseBoundaries(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error("invalid_raw_table_boundaries");
  }
  const boundaries = value.map(Number);
  if (
    boundaries.some((entry) => !Number.isFinite(entry))
    || boundaries.some((entry, index) => index > 0 && entry <= boundaries[index - 1])
  ) {
    throw new Error("invalid_raw_table_boundaries");
  }
  return boundaries;
}

function parseIndex(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("invalid_raw_table_cell_index");
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
