import { isPageFragment } from "../rag/ragTable.ts";
import {
  clusterColumnStarts,
  findNearestColumn,
  type PdfTextItem,
} from "./pdfItems.ts";
import {
  buildGridBoundariesFromLines,
  type PdfPathLine,
} from "./pdfLines.ts";
import {
  groupVisualRows,
  segmentRowItems,
  type TableRegion,
} from "./tableRegionDetector.ts";

export interface TableGrid {
  region: TableRegion;
  matrix: (string | null)[][];
  warnings: string[];
  cellBBoxes?: ([number, number, number, number] | null)[][];
}

function inRegion(region: TableRegion, item: PdfTextItem): boolean {
  const [x0, y0, x1, y1] = region.bbox;
  return item.x >= x0 - 2 && item.x <= x1 + 2 && item.y >= y0 - 2 && item.y <= y1 + 2;
}

function joinCell(current: string | null, text: string): string {
  return [current, text].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function repairCellReadingOrder(text: string | null): string | null {
  if (!text) return text;
  return text
    .replace(/(\d+)\s*万\s*\.\s*(\d+)\s*人\s*(\d+)/g, "$1.$2$3万人")
    .replace(/万\s*(\d+)\s*\.\s*(\d+)\s*人/g, "$1.$2万人")
    .replace(/(\d+)\s*万\s*(\d+)\s*\.\s*人\s*(\d+)/g, "$1$2.$3万人")
    .replace(/岁\s*(\d+)\s*以下/g, "$1岁以下")
    .replace(/(\d+)\s*-\s*岁\s*(\d+)/g, "$1-$2岁");
}

function repairGridCells(matrix: (string | null)[][]): (string | null)[][] {
  return matrix.map((row) => row.map((cell) => repairCellReadingOrder(cell)));
}

export function buildTableGrid(
  region: TableRegion,
  items: PdfTextItem[],
  lines: PdfPathLine[] = []
): TableGrid {
  const warnings: string[] = [];
  const regionItems = items.filter((it) => inRegion(region, it));
  const filteredItems = regionItems.filter((it) => {
    if (!isPageFragment(it.text)) return true;
    warnings.push("page_footer_removed");
    return false;
  });

  const titleText = region.tableTitle?.trim();
  const rows = groupVisualRows(filteredItems).filter((row) => row.text !== titleText);
  const lineGrid = buildGridBoundariesFromLines(lines, region.bbox);
  const lineGridResult = lineGrid
    ? buildGridFromBoundaries(region, filteredItems, lineGrid.x, lineGrid.y, [...warnings])
    : null;
  const segmentItems = rows.flatMap((row) =>
    segmentRowItems(row).map((segment) => ({
      x: segment.x,
      height: segment.height,
    }))
  );
  const columns = clusterColumnStarts(segmentItems, { minCount: 2 });
  const matrix: (string | null)[][] = [];
  const boxes: ([number, number, number, number] | null)[][] = [];

  for (const row of rows) {
    const rowCells = new Array<string | null>(Math.max(columns.length, 1)).fill(null);
    const rowBoxes = new Array<[number, number, number, number] | null>(
      Math.max(columns.length, 1)
    ).fill(null);

    for (const segment of segmentRowItems(row)) {
      const col = findNearestColumn(segment.x, columns);
      if (col < 0) continue;
      rowCells[col] = joinCell(rowCells[col], segment.text);
      const box: [number, number, number, number] = [
        segment.x,
        segment.y,
        segment.x + segment.width,
        segment.y + segment.height,
      ];
      const prev = rowBoxes[col];
      rowBoxes[col] = prev
        ? [
            Math.min(prev[0], box[0]),
            Math.min(prev[1], box[1]),
            Math.max(prev[2], box[2]),
            Math.max(prev[3], box[3]),
          ]
        : box;
    }

    const occupied = rowCells.filter((cell) => cell != null && cell !== "").length;
    const prev = matrix[matrix.length - 1];
    const prevBoxes = boxes[boxes.length - 1];
    const occupiedCols = rowCells
      .map((cell, col) => (cell != null && cell !== "" ? col : -1))
      .filter((col) => col >= 0);
    if (prev && occupied > 0 && occupied < Math.max(2, columns.length / 2)) {
      const prevCols = prev
        .map((cell, col) => (cell != null && cell !== "" ? col : -1))
        .filter((col) => col >= 0);
      const maxPrevCol = Math.max(-1, ...prevCols);
      const canMerge = occupiedCols.every(
        (col) => prev[col] != null || col > maxPrevCol
      );
      let merged = false;
      for (const col of canMerge ? occupiedCols : []) {
        if (rowCells[col] != null && prev.some((cell) => cell != null && cell !== "")) {
          prev[col] = joinCell(prev[col], rowCells[col]!);
          const box = rowBoxes[col];
          const pbox = prevBoxes[col];
          if (box && pbox) {
            prevBoxes[col] = [
              Math.min(pbox[0], box[0]),
              Math.min(pbox[1], box[1]),
              Math.max(pbox[2], box[2]),
              Math.max(pbox[3], box[3]),
            ];
          } else if (box) {
            prevBoxes[col] = box;
          }
          merged = true;
        }
      }
      if (merged) continue;
    }

    matrix.push(rowCells);
    boxes.push(rowBoxes);
  }

  for (let r = 1; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c] == null && matrix[r - 1]?.[c]) {
        warnings.push("rowspan_filled");
        break;
      }
    }
  }

  const trimmedText = trimSparseColumns(
    matrix.filter((row) => row.some((cell) => cell != null && cell !== "")),
    boxes.filter((_, idx) => matrix[idx]?.some((cell) => cell != null && cell !== ""))
  );
  const textGrid: TableGrid = {
    region,
    matrix: repairGridCells(trimmedText.matrix),
    warnings: [...new Set(warnings)],
    cellBBoxes: trimmedText.boxes,
  };
  return chooseTableGrid(lineGridResult, textGrid);
}

function chooseTableGrid(lineGrid: TableGrid | null, textGrid: TableGrid): TableGrid {
  if (!lineGrid || !lineGrid.matrix.length) return textGrid;
  if (!textGrid.matrix.length) return lineGrid;

  const lineStats = gridStats(lineGrid.matrix);
  const textStats = gridStats(textGrid.matrix);
  if (lineStats.effectiveCols >= textStats.effectiveCols + 2) return lineGrid;
  if (
    lineGrid.matrix.length >= textGrid.matrix.length * 1.4 &&
    lineStats.effectiveCols >= textStats.effectiveCols
  ) {
    return lineGrid;
  }
  if (
    lineStats.fillRate + 0.12 < textStats.fillRate &&
    lineStats.effectiveCols <= textStats.effectiveCols + 1
  ) {
    return {
      ...textGrid,
      warnings: [...new Set([...textGrid.warnings, "line_grid_skipped"])],
    };
  }
  if (lineStats.effectiveCols < textStats.effectiveCols) return textGrid;
  return lineGrid;
}

function gridStats(matrix: (string | null)[][]): {
  effectiveCols: number;
  fillRate: number;
} {
  const cols = Math.max(0, ...matrix.map((row) => row.length));
  let cells = 0;
  let filled = 0;
  for (const row of matrix) {
    for (let c = 0; c < cols; c++) {
      cells++;
      if (row[c] != null && row[c] !== "") filled++;
    }
  }

  let effectiveCols = 0;
  for (let c = 0; c < cols; c++) {
    const nonEmpty = matrix.filter((row) => row[c] != null && row[c] !== "").length;
    if (nonEmpty >= 2) effectiveCols++;
  }
  return {
    effectiveCols,
    fillRate: cells > 0 ? filled / cells : 0,
  };
}

function buildGridFromBoundaries(
  region: TableRegion,
  items: PdfTextItem[],
  xs: number[],
  ys: number[],
  warnings: string[]
): TableGrid {
  const cols = Math.max(1, xs.length - 1);
  const rows = Math.max(1, ys.length - 1);
  const matrix: (string | null)[][] = Array.from({ length: rows }, () =>
    new Array<string | null>(cols).fill(null)
  );
  const boxes: ([number, number, number, number] | null)[][] = Array.from(
    { length: rows },
    () => new Array<[number, number, number, number] | null>(cols).fill(null)
  );

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      boxes[r][c] = [xs[c], ys[r], xs[c + 1], ys[r + 1]];
    }
  }

  for (const item of items) {
    if (region.tableTitle && item.text.trim() === region.tableTitle.trim()) continue;
    if (isPageFragment(item.text)) {
      warnings.push("page_footer_removed");
      continue;
    }
    if (assignMarkerSequence(item, xs, ys, matrix)) continue;
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    const c = findInterval(cx, xs);
    const r = findInterval(cy, ys);
    if (r < 0 || c < 0) continue;
    matrix[r][c] = joinCell(matrix[r][c], item.text);
  }

  const cleaned = trimEmptyEdges(matrix, boxes);
  return {
    region,
    matrix: repairGridCells(cleaned.matrix),
    warnings: [...new Set(["line_grid", ...warnings])],
    cellBBoxes: cleaned.boxes,
  };
}

function assignMarkerSequence(
  item: PdfTextItem,
  xs: number[],
  ys: number[],
  matrix: (string | null)[][]
): boolean {
  const tokens = item.text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || !tokens.every((token) => /^[\u25cf\u25cb]$/.test(token))) {
    return false;
  }
  const r = findInterval(item.y + item.height / 2, ys);
  if (r < 0) return false;

  const start = findInterval(item.x + 1, xs);
  const end = findInterval(item.x + item.width - 1, xs);
  if (start < 0 || end < start) return false;
  const covered = Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
  if (!covered.length) return false;

  for (let i = 0; i < tokens.length; i++) {
    const coveredIndex =
      tokens.length === covered.length
        ? i
        : Math.min(covered.length - 1, Math.round((i * (covered.length - 1)) / (tokens.length - 1)));
    const c = covered[coveredIndex];
    matrix[r][c] = joinCell(matrix[r][c], tokens[i]);
  }
  return true;
}

function findInterval(value: number, boundaries: number[]): number {
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (value >= boundaries[i] - 2 && value <= boundaries[i + 1] + 2) return i;
  }
  return -1;
}

function trimEmptyEdges(
  matrix: (string | null)[][],
  boxes: ([number, number, number, number] | null)[][]
): {
  matrix: (string | null)[][];
  boxes: ([number, number, number, number] | null)[][];
} {
  let top = 0;
  let bottom = matrix.length;
  while (top < bottom && matrix[top].every((cell) => !cell)) top++;
  while (bottom > top && matrix[bottom - 1].every((cell) => !cell)) bottom--;
  const sliced = matrix.slice(top, bottom);
  const slicedBoxes = boxes.slice(top, bottom);
  if (!sliced.length) return { matrix: [], boxes: [] };

  let left = 0;
  let right = sliced[0].length;
  while (left < right && sliced.every((row) => !row[left])) left++;
  while (right > left && sliced.every((row) => !row[right - 1])) right--;
  return trimSparseColumns(
    sliced.map((row) => row.slice(left, right)),
    slicedBoxes.map((row) => row.slice(left, right))
  );
}

function trimSparseColumns(
  matrix: (string | null)[][],
  boxes: ([number, number, number, number] | null)[][]
): {
  matrix: (string | null)[][];
  boxes: ([number, number, number, number] | null)[][];
} {
  const cols = Math.max(0, ...matrix.map((row) => row.length));
  if (cols <= 2 || matrix.length < 3) return { matrix, boxes };
  const minNonEmpty = matrix.length >= 8 && cols >= 8
    ? Math.max(3, Math.ceil(matrix.length * 0.25))
    : 2;
  const keep = Array.from({ length: cols }, (_, col) => {
    const nonEmpty = matrix.filter((row) => row[col] != null && row[col] !== "").length;
    return nonEmpty >= minNonEmpty;
  });
  if (keep.filter(Boolean).length < 2) return { matrix, boxes };
  return {
    matrix: matrix.map((row) => row.filter((_, col) => keep[col])),
    boxes: boxes.map((row) => row.filter((_, col) => keep[col])),
  };
}
