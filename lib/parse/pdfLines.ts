import { getPdfLib, type PdfTextItem } from "./pdfItems.ts";
import type { TableRegion } from "./tableRegionDetector.ts";

export interface PdfPathLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  orientation: "h" | "v";
  pageNumber: number;
}

interface RawLineBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pageNumber: number;
}

export interface GridBoundaries {
  x: number[];
  y: number[];
}

function cluster(values: number[], tolerance = 2): number[] {
  const sorted = values.slice().sort((a, b) => a - b);
  const out: { sum: number; count: number; center: number }[] = [];
  for (const value of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(value - last.center) <= tolerance) {
      last.sum += value;
      last.count++;
      last.center = last.sum / last.count;
    } else {
      out.push({ sum: value, count: 1, center: value });
    }
  }
  return out.map((c) => Math.round(c.center));
}

function orient(line: Omit<PdfPathLine, "orientation">): PdfPathLine {
  const width = Math.abs(line.x1 - line.x0);
  const height = Math.abs(line.y1 - line.y0);
  return {
    ...line,
    orientation: width >= height ? "h" : "v",
  };
}

export function normalizePathLine(
  raw: RawLineBox,
  rotate: number,
  xOffset = 0
): PdfPathLine | null {
  const width = Math.abs(raw.x1 - raw.x0);
  const height = Math.abs(raw.y1 - raw.y0);
  if (Math.max(width, height) < 12) return null;

  if (rotate === 90 || rotate === 270) {
    return orient({
      x0: Math.min(raw.y0, raw.y1) + xOffset,
      y0: Math.min(raw.x0, raw.x1),
      x1: Math.max(raw.y0, raw.y1) + xOffset,
      y1: Math.max(raw.x0, raw.x1),
      pageNumber: raw.pageNumber,
    });
  }

  return orient({
    x0: Math.min(raw.x0, raw.x1),
    y0: Math.min(raw.y0, raw.y1),
    x1: Math.max(raw.x0, raw.x1),
    y1: Math.max(raw.y0, raw.y1),
    pageNumber: raw.pageNumber,
  });
}

export function buildGridBoundariesFromLines(
  lines: PdfPathLine[],
  bbox: [number, number, number, number]
): GridBoundaries | null {
  const [x0, y0, x1, y1] = bbox;
  const inBox = lines.filter(
    (line) =>
      usableGridLine(line) &&
      line.x1 >= x0 - 3 &&
      line.x0 <= x1 + 3 &&
      line.y1 >= y0 - 3 &&
      line.y0 <= y1 + 3
  );
  const hLines = inBox.filter((line) => line.orientation === "h");
  const vLines = inBox.filter((line) => line.orientation === "v");
  if (hLines.length < 2 || vLines.length < 2) return null;

  const xs = cluster(vLines.map(lineCenterX)).filter(
    (x) => x >= x0 - 3 && x <= x1 + 3
  );
  const ys = cluster(hLines.map(lineCenterY)).filter(
    (y) => y >= y0 - 3 && y <= y1 + 3
  );
  if (xs.length && Math.abs(xs[0] - x0) > 4) xs.unshift(Math.round(x0));
  if (xs.length && Math.abs(xs[xs.length - 1] - x1) > 4) xs.push(Math.round(x1));
  if (ys.length && Math.abs(ys[0] - y0) > 4) ys.unshift(Math.round(y0));
  if (ys.length && Math.abs(ys[ys.length - 1] - y1) > 4) ys.push(Math.round(y1));
  if (xs.length < 2 || ys.length < 2) return null;
  return { x: xs, y: ys };
}

export function detectLineTableRegions(
  lines: PdfPathLine[],
  pageNumber: number
): TableRegion[] {
  if (lines.length < 4) return [];

  const regions: TableRegion[] = [];
  const components = connectedLineComponents(lines);
  for (const component of components) {
    const hLines = component.filter((line) => line.orientation === "h");
    const vLines = component.filter((line) => line.orientation === "v");
    if (hLines.length < 2 || vLines.length < 2) continue;

    const xs = cluster(vLines.flatMap((line) => [line.x0, line.x1]));
    const ys = cluster(hLines.flatMap((line) => [line.y0, line.y1]));
    if (xs.length < 3 || ys.length < 3) continue;

    const bbox: [number, number, number, number] = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ];
    const width = bbox[2] - bbox[0];
    const height = bbox[3] - bbox[1];
    if (width < 80 || height < 40) continue;

    regions.push({
      regionId: `p${pageNumber}-line-${regions.length}`,
      pageNumber,
      bbox,
      confidence: 0.9,
      reasons: ["line_grid"],
    });
  }

  if (!regions.length) {
    const fallback = detectWholeLineTableRegion(lines, pageNumber);
    if (fallback) regions.push(fallback);
  }

  return regions.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
}

function detectWholeLineTableRegion(
  lines: PdfPathLine[],
  pageNumber: number
): TableRegion | null {
  const usable = lines.filter(usableGridLine);
  const hLines = usable.filter((line) => line.orientation === "h");
  const vLines = usable.filter((line) => line.orientation === "v");
  if (hLines.length < 2 || vLines.length < 3) return null;

  const xs = cluster(vLines.flatMap((line) => [line.x0, line.x1]));
  const ys = cluster(hLines.flatMap((line) => [line.y0, line.y1]));
  if (xs.length < 3 || ys.length < 3) return null;

  const bbox: [number, number, number, number] = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  if (width < 80 || height < 40) return null;

  return {
    regionId: `p${pageNumber}-line-fallback`,
    pageNumber,
    bbox,
    confidence: 0.82,
    reasons: ["line_grid", "line_grid_fallback"],
  };
}

function connectedLineComponents(lines: PdfPathLine[]): PdfPathLine[][] {
  const parent = lines.map((_, idx) => idx);
  const find = (idx: number): number => {
    while (parent[idx] !== idx) {
      parent[idx] = parent[parent[idx]];
      idx = parent[idx];
    }
    return idx;
  };
  const union = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  };

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (linesConnect(lines[i], lines[j])) union(i, j);
    }
  }

  const groups = new Map<number, PdfPathLine[]>();
  for (let i = 0; i < lines.length; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(lines[i]);
    else groups.set(root, [lines[i]]);
  }
  return [...groups.values()];
}

function usableGridLine(line: PdfPathLine): boolean {
  const width = Math.abs(line.x1 - line.x0);
  const height = Math.abs(line.y1 - line.y0);
  if (width > 250 && height > 250) return false;
  if (line.x0 <= 1 && line.y0 <= 1) return false;
  return true;
}

function linesConnect(a: PdfPathLine, b: PdfPathLine, tolerance = 4): boolean {
  if (a.orientation === b.orientation) {
    if (a.orientation === "h") {
      return (
        Math.abs(lineCenterY(a) - lineCenterY(b)) <= tolerance &&
        spansOverlap(a.x0, a.x1, b.x0, b.x1, tolerance)
      );
    }
    return (
      Math.abs(lineCenterX(a) - lineCenterX(b)) <= tolerance &&
      spansOverlap(a.y0, a.y1, b.y0, b.y1, tolerance)
    );
  }

  const h = a.orientation === "h" ? a : b;
  const v = a.orientation === "v" ? a : b;
  return (
    lineCenterX(v) >= h.x0 - tolerance &&
    lineCenterX(v) <= h.x1 + tolerance &&
    lineCenterY(h) >= v.y0 - tolerance &&
    lineCenterY(h) <= v.y1 + tolerance
  );
}

function spansOverlap(a0: number, a1: number, b0: number, b1: number, tolerance: number): boolean {
  return Math.max(a0, b0) <= Math.min(a1, b1) + tolerance;
}

function lineCenterX(line: PdfPathLine): number {
  return (line.x0 + line.x1) / 2;
}

function lineCenterY(line: PdfPathLine): number {
  return (line.y0 + line.y1) / 2;
}

function rawBoxFromArgs(args: unknown, pageNumber: number): RawLineBox | null {
  if (!Array.isArray(args) || args.length < 3) return null;
  const box = args[2] as Record<string, number> | undefined;
  if (!box) return null;
  const x0 = Number(box[0]);
  const y0 = Number(box[1]);
  const x1 = Number(box[2]);
  const y1 = Number(box[3]);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
    pageNumber,
  };
}

function estimateRotatedOffset(lines: RawLineBox[], items: PdfTextItem[]): number {
  const minItemX = Math.min(...items.map((it) => it.x));
  const minLineY = Math.min(...lines.map((line) => line.y0));
  if (!Number.isFinite(minItemX) || !Number.isFinite(minLineY)) return 0;
  return Math.round(minItemX - minLineY);
}

export async function extractPageLines(
  buffer: Buffer,
  pageItems: PdfTextItem[][]
): Promise<PdfPathLine[][]> {
  const pdfjs = await getPdfLib();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  const names: Record<number, string> = {};
  for (const [name, id] of Object.entries(pdfjs.OPS)) names[id as number] = name;

  const pages: PdfPathLine[][] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const opList = await page.getOperatorList();
    const rawLines: RawLineBox[] = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      if (names[opList.fnArray[i]] !== "constructPath") continue;
      const raw = rawBoxFromArgs(opList.argsArray[i], pageNumber);
      if (raw) rawLines.push(raw);
    }
    const items = pageItems[pageNumber - 1] ?? [];
    const offset =
      page.rotate === 90 || page.rotate === 270
        ? estimateRotatedOffset(rawLines, items)
        : 0;
    pages.push(
      rawLines
        .map((line) => normalizePathLine(line, page.rotate, offset))
        .filter((line): line is PdfPathLine => line != null)
    );
  }
  return pages;
}
