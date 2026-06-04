import {
  clusterColumnStarts,
  findNearestColumn,
  type PdfTextItem,
} from "./pdfItems.ts";
import { scoreTableRegion, shouldKeepAsTable } from "../rag/tableConfidence.ts";

export interface TableRegion {
  regionId: string;
  pageNumber: number;
  bbox: [number, number, number, number];
  tableTitle?: string;
  isContinuation?: boolean;
  confidence: number;
  reasons: string[];
}

export interface VisualRow {
  y: number;
  items: PdfTextItem[];
  text: string;
}

export interface RowSegment {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

const TITLE_RE =
  /^\s*(?:Table\s*\d+|\u9644\u8868\s*\d+|\u7eed\u8868|\u8868\s*[\d\u4e00-\u9fa5]*\s*[:\uff1a]?.*(?:\u8868|\u4e00\u89c8|\u7ed3\u6784|\u9762\u79ef|\u660e\u7ec6|\u7edf\u8ba1)|.*(?:\u914d\u7f6e\u6307\u6807\u8868|\u914d\u7f6e\u8981\u6c42\u8868|\u4ee3\u7801\u8868|\u5206\u7c7b\u8868|\u4e00\u89c8\u8868|\u7ed3\u6784\u8868|\u9762\u79ef\u8868|\u7b56\u7565\u8868))/i;

export function isTableTitleText(text: string): boolean {
  return TITLE_RE.test(text);
}

function rowTolerance(items: PdfTextItem[]): number {
  if (!items.length) return 8;
  const avgH = items.reduce((s, it) => s + it.height, 0) / items.length;
  return Math.max(avgH * 0.7, 6);
}

export function groupVisualRows(items: PdfTextItem[]): VisualRow[] {
  if (!items.length) return [];
  const tolerance = rowTolerance(items);
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: VisualRow[] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.y - last.y) <= tolerance) {
      last.items.push(it);
      last.y = (last.y * (last.items.length - 1) + it.y) / last.items.length;
    } else {
      rows.push({ y: it.y, items: [it], text: "" });
    }
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    row.text = row.items.map((it) => it.text).join(" ").trim();
  }
  return rows;
}

export function segmentRowItems(row: VisualRow): RowSegment[] {
  if (!row.items.length) return [];
  const avgH = row.items.reduce((sum, it) => sum + it.height, 0) / row.items.length;
  const gapTolerance = Math.max(avgH * 1.2, 8);
  const segments: RowSegment[] = [];

  for (const it of row.items) {
    const last = segments[segments.length - 1];
    const lastEnd = last ? last.x + last.width : -Infinity;
    if (last && it.x - lastEnd <= gapTolerance) {
      last.text = [last.text, it.text].filter(Boolean).join(" ").trim();
      last.width = Math.max(last.width, it.x + it.width - last.x);
      last.height = Math.max(last.height, it.height);
      last.items.push(it);
    } else {
      segments.push({
        text: it.text,
        x: it.x,
        y: it.y,
        width: it.width,
        height: it.height,
        items: [it],
      });
    }
  }

  return segments;
}

function rowToCells(row: VisualRow, columns: number[]): string[] {
  const cells = new Array(Math.max(columns.length, 1)).fill("");
  for (const segment of segmentRowItems(row)) {
    const col = findNearestColumn(segment.x, columns);
    if (col >= 0) cells[col] = [cells[col], segment.text].filter(Boolean).join(" ");
  }
  return cells.map((c) => c.trim());
}

function mergeSparseMatrix(matrix: string[][]): string[][] {
  const out: string[][] = [];
  for (const row of matrix) {
    const occupied = row.filter(Boolean).length;
    const prev = out[out.length - 1];
    if (prev && occupied > 0 && occupied < Math.max(2, row.length / 2)) {
      const occupiedCols = row
        .map((cell, col) => (cell ? col : -1))
        .filter((col) => col >= 0);
      const prevCols = prev
        .map((cell, col) => (cell ? col : -1))
        .filter((col) => col >= 0);
      const maxPrevCol = Math.max(-1, ...prevCols);
      const canMerge = occupiedCols.every((col) => prev[col] || col > maxPrevCol);
      if (canMerge) {
        for (const col of occupiedCols) {
          prev[col] = [prev[col], row[col]].filter(Boolean).join(" ").trim();
        }
        continue;
      }
    }
    out.push([...row]);
  }
  return out;
}

function bboxOfRows(rows: VisualRow[]): [number, number, number, number] {
  const all = rows.flatMap((r) => r.items);
  const x0 = Math.min(...all.map((it) => it.x));
  const y0 = Math.min(...all.map((it) => it.y));
  const x1 = Math.max(...all.map((it) => it.x + it.width));
  const y1 = Math.max(...all.map((it) => it.y + it.height));
  return [x0, y0, x1, y1];
}

function titleRowLikelyContinues(row: VisualRow): boolean {
  const text = row.text.trim();
  if (!text) return false;
  if (isTableTitleText(text)) return false;
  return text.length <= 90;
}

export function detectTableRegions(
  items: PdfTextItem[],
  pageNumber: number
): TableRegion[] {
  const rows = groupVisualRows(items);
  if (!rows.length) return [];

  const rowSegments = rows.map(segmentRowItems);
  const rowLooksTabular = rows.map((row, idx) => {
    const segments = rowSegments[idx];
    const xSpan =
      row.items.length > 0
        ? Math.max(...row.items.map((it) => it.x + it.width)) -
          Math.min(...row.items.map((it) => it.x))
        : 0;
    return segments.length >= 2 && xSpan >= 60;
  });

  const regions: TableRegion[] = [];
  let regionSeq = 0;
  const usedRows = new Set<number>();

  const pushRegion = (
    titleIndex: number | undefined,
    start: number,
    end: number
  ) => {
    const tableRows = rows.slice(start, end);
    const segmentItems = tableRows.flatMap((row) =>
      segmentRowItems(row).map((segment) => ({
        x: segment.x,
        height: segment.height,
      }))
    );
    const columns = clusterColumnStarts(segmentItems, { minCount: 2 });
    if (columns.length < 2 || columns.length > 24) return;

    const matrix = mergeSparseMatrix(tableRows.map((row) => rowToCells(row, columns)));
    const confidence = scoreTableRegion(matrix);
    const titleRow = titleIndex != null ? rows[titleIndex] : undefined;
    const titleBoost = titleRow ? 0.2 : 0;
    const score = Math.min(1, confidence.score + titleBoost);
    const keep =
      shouldKeepAsTable({ ...confidence, score }) &&
      (titleRow || confidence.tableTypeCandidates.length > 0 || confidence.score >= 0.5);
    if (!keep) return;

    const regionRows = titleRow ? [titleRow, ...tableRows] : tableRows;
    if (titleIndex != null) usedRows.add(titleIndex);
    for (let rowIndex = start; rowIndex < end; rowIndex++) usedRows.add(rowIndex);
    regions.push({
      regionId: `p${pageNumber}-r${regionSeq++}`,
      pageNumber,
      bbox: bboxOfRows(regionRows),
      tableTitle: titleRow?.text,
      isContinuation: !!titleRow && /续表/i.test(titleRow.text),
      confidence: score,
      reasons: [
        ...confidence.reasons,
        ...(titleRow ? ["table_title"] : []),
      ],
    });
  };

  for (let titleIndex = 0; titleIndex < rows.length; titleIndex++) {
    if (!isTableTitleText(rows[titleIndex].text)) continue;
    let start = titleIndex + 1;
    while (start < rows.length && !rowLooksTabular[start] && start <= titleIndex + 6) {
      start++;
    }
    if (start < rows.length && rowLooksTabular[start]) {
      let end = start + 1;
      let sparseGap = 0;
      while (end < rows.length) {
        if (isTableTitleText(rows[end].text)) break;
        if (rowLooksTabular[end]) {
          sparseGap = 0;
          end++;
          continue;
        }
        const nextIsTable = end + 1 < rows.length && rowLooksTabular[end + 1];
        if (sparseGap < 3 && (nextIsTable || titleRowLikelyContinues(rows[end]))) {
          sparseGap++;
          end++;
          continue;
        }
        break;
      }
      if (rowLooksTabular.slice(start, end).filter(Boolean).length >= 2) {
        pushRegion(titleIndex, start, end);
      }
    }

    let aboveEnd = titleIndex;
    while (
      aboveEnd > 0 &&
      !rowLooksTabular[aboveEnd - 1] &&
      aboveEnd >= titleIndex - 3
    ) {
      aboveEnd--;
    }
    let aboveStart = aboveEnd - 1;
    let aboveSparseGap = 0;
    while (aboveStart >= 0) {
      if (isTableTitleText(rows[aboveStart].text)) break;
      if (rowLooksTabular[aboveStart]) {
        aboveSparseGap = 0;
        aboveStart--;
        continue;
      }
      const prevIsTable = aboveStart > 0 && rowLooksTabular[aboveStart - 1];
      if (aboveSparseGap < 2 && (prevIsTable || titleRowLikelyContinues(rows[aboveStart]))) {
        aboveSparseGap++;
        aboveStart--;
        continue;
      }
      break;
    }
    const reverseStart = aboveStart + 1;
    if (rowLooksTabular.slice(reverseStart, aboveEnd).filter(Boolean).length >= 2) {
      pushRegion(titleIndex, reverseStart, aboveEnd);
    }
  }

  const globalSegmentItems = rowSegments.flatMap((segments) =>
    segments.map((segment) => ({ x: segment.x, height: segment.height }))
  );
  const columns = clusterColumnStarts(globalSegmentItems, { minCount: 3 });
  if (columns.length < 2 || columns.length > 24) return regions;

  const multiRows = rows.map((row) => {
    const occupied = new Set(
      segmentRowItems(row)
        .map((segment) => findNearestColumn(segment.x, columns))
        .filter((col) => col >= 0)
    );
    return occupied.size >= 2;
  });

  let i = 0;
  while (i < rows.length) {
    if (!multiRows[i] || usedRows.has(i)) {
      i++;
      continue;
    }

    const start = i;
    let end = i + 1;
    let sparseGap = 0;
    while (end < rows.length) {
      if (multiRows[end]) {
        sparseGap = 0;
        end++;
        continue;
      }
      const nextIsMulti = end + 1 < rows.length && multiRows[end + 1];
      if (sparseGap < 3 && (nextIsMulti || titleRowLikelyContinues(rows[end]))) {
        sparseGap++;
        end++;
        continue;
      }
      break;
    }

    const multiRowCount = multiRows.slice(start, end).filter(Boolean).length;
    if (multiRowCount >= 3) {
      pushRegion(undefined, start, end);
    }

    i = end;
  }

  return regions;
}
