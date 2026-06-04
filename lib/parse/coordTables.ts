import { extractPageItems, type PdfTextItem } from "./pdfItems.ts";
import {
  detectLineTableRegions,
  extractPageLines,
  type PdfPathLine,
} from "./pdfLines.ts";
import {
  detectTableRegions,
  groupVisualRows,
  isTableTitleText,
  type TableRegion,
} from "./tableRegionDetector.ts";
import { buildTableGrid, type TableGrid } from "./tableGridBuilder.ts";
import type { RawTable } from "./tablesSidecar.ts";

export interface CoordTableGrid {
  rawTable: RawTable;
  grid: TableGrid;
  cellBBoxes?: ([number, number, number, number] | null)[][];
  warnings: string[];
}

export function extractTableGridsFromPageItems(
  pages: PdfTextItem[][],
  pageLines: PdfPathLine[][] = []
): CoordTableGrid[] {
  const grids: CoordTableGrid[] = [];
  for (let i = 0; i < pages.length; i++) {
    const pageItems = pages[i];
    const pageNumber = pageItems[0]?.pageNumber ?? i + 1;
    const lineItems = pageLines[i] ?? [];
    const regions = splitLineRegionsByTextGaps(mergeRegions(
      detectTableRegions(pageItems, pageNumber),
      detectLineTableRegions(lineItems, pageNumber)
    ), pageItems);
    for (const region of regions) {
      const grid = buildTableGrid(region, pageItems, lineItems);
      if (!grid.matrix.length) continue;
      const rawTable: RawTable = {
        page: pageNumber,
        bbox: region.bbox,
        title: region.tableTitle ?? null,
        rows: grid.matrix,
      };
      grids.push({
        rawTable,
        grid,
        cellBBoxes: grid.cellBBoxes,
        warnings: grid.warnings,
      });
    }
  }
  return grids;
}

function mergeRegions<T extends { bbox: [number, number, number, number] }>(
  primary: T[],
  secondary: T[]
): T[] {
  const out = [...primary];
  for (const region of secondary) {
    if (!out.some((existing) => overlapRatio(existing.bbox, region.bbox) > 0.6)) {
      out.push(region);
    }
  }
  return out;
}

function splitLineRegionsByTextGaps(
  regions: TableRegion[],
  items: PdfTextItem[]
): TableRegion[] {
  return regions.flatMap((region) => {
    if (!region.reasons.includes("line_grid")) return [region];
    const rows = groupVisualRows(items.filter((item) => itemInBbox(item, region.bbox))).filter(
      (row) => row.text && !isTableTitleText(row.text)
    );
    if (rows.length < 6) return [attachNearbyTitle(region, items)];

    const rowItems = rows.flatMap((row) => row.items);
    const avgHeight = rowItems.reduce((sum, item) => sum + item.height, 0) / rowItems.length;
    const gapThreshold = Math.max(avgHeight * 3.2, 36);
    const spans: { start: number; end: number }[] = [];
    let start = 0;
    for (let i = 1; i < rows.length; i++) {
      const prevBottom = Math.max(...rows[i - 1].items.map((item) => item.y + item.height));
      const gap = rows[i].y - prevBottom;
      if (gap >= gapThreshold && i - start >= 2 && rows.length - i >= 2) {
        spans.push({ start, end: i });
        start = i;
      }
    }
    spans.push({ start, end: rows.length });
    if (spans.length < 2) return [attachNearbyTitle(region, items)];

    return spans.map((span, idx) => {
      const spanItems = rows.slice(span.start, span.end).flatMap((row) => row.items);
      const y0 = Math.min(...spanItems.map((item) => item.y));
      const y1 = Math.max(...spanItems.map((item) => item.y + item.height));
      return attachNearbyTitle(
        {
          ...region,
          regionId: `${region.regionId}-s${idx}`,
          bbox: [
            region.bbox[0],
            Math.max(region.bbox[1], y0 - 4),
            region.bbox[2],
            Math.min(region.bbox[3], y1 + 4),
          ],
          reasons: [...new Set([...region.reasons, "text_gap_split"])],
        },
        items
      );
    });
  });
}

function attachNearbyTitle(region: TableRegion, items: PdfTextItem[]): TableRegion {
  if (region.tableTitle) return region;
  const rows = groupVisualRows(items).filter((row) => isTableTitleText(row.text));
  let best: { text: string; distance: number } | null = null;
  for (const row of rows) {
    const rowBottom = Math.max(...row.items.map((item) => item.y + item.height));
    const distance =
      row.y < region.bbox[1]
        ? region.bbox[1] - rowBottom
        : row.y > region.bbox[3]
          ? row.y - region.bbox[3]
          : Math.min(Math.abs(row.y - region.bbox[1]), Math.abs(row.y - region.bbox[3]));
    if (distance > 90) continue;
    if (!best || distance < best.distance) best = { text: row.text, distance };
  }
  return best ? { ...region, tableTitle: best.text } : region;
}

function itemInBbox(item: PdfTextItem, bbox: [number, number, number, number]): boolean {
  return (
    item.x >= bbox[0] - 2 &&
    item.x <= bbox[2] + 2 &&
    item.y >= bbox[1] - 2 &&
    item.y <= bbox[3] + 2
  );
}

function overlapRatio(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[2], b[2]);
  const y1 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const area = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
  return area > 0 ? inter / area : 0;
}

export function extractTablesFromPageItems(
  pages: PdfTextItem[][],
  pageLines: PdfPathLine[][] = []
): RawTable[] {
  return extractTableGridsFromPageItems(pages, pageLines).map((g) => g.rawTable);
}

export async function extractTablesFromCoords(buffer: Buffer): Promise<RawTable[]> {
  const pageItems = await extractPageItems(buffer);
  const pageLines = await extractPageLines(buffer, pageItems);
  return extractTablesFromPageItems(pageItems, pageLines);
}

export async function extractTableGridsFromCoords(
  buffer: Buffer
): Promise<CoordTableGrid[]> {
  const pageItems = await extractPageItems(buffer);
  const pageLines = await extractPageLines(buffer, pageItems);
  return extractTableGridsFromPageItems(pageItems, pageLines);
}
