import path from "path";
import { fileURLToPath } from "url";

export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  pageNumber: number;
}

export interface PageParams {
  dominantB: number;
  dominantC: number;
  avgH: number;
}

interface RawPdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

interface ColumnLike {
  x: number;
  height?: number;
}

export async function getPdfLib() {
  const pdfjsLib: any = await import(
    /* webpackIgnore: true */ "pdfjs-dist/legacy/build/pdf.mjs"
  );

  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const workerAbs = path.join(
        __dirname,
        "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
      );
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "file:///" + workerAbs.replace(/\\/g, "/");
    } catch {
      // pdfjs can fall back to a fake worker if the local worker path cannot be resolved.
    }
  }
  return pdfjsLib;
}

export function computePageParams(rawItems: RawPdfTextItem[]): PageParams {
  const nonEmpty = rawItems.filter((it) => it.str?.trim().length);
  if (!nonEmpty.length) return { dominantB: 0, dominantC: 0, avgH: 10 };

  const bs = nonEmpty.map((it) => it.transform?.[1] ?? 0).sort((a, b) => a - b);
  const cs = nonEmpty.map((it) => it.transform?.[2] ?? 0).sort((a, b) => a - b);
  const mid = Math.floor(bs.length / 2);
  const dominantB = bs[mid];
  const dominantC = cs[mid];

  const mainItems = nonEmpty.filter(
    (it) => Math.abs((it.transform?.[1] ?? 0) - dominantB) < 3
  );
  const avgH =
    mainItems.length > 0
      ? mainItems.reduce(
          (s, it) => s + (it.height ?? Math.abs(it.transform?.[3] ?? 10)),
          0
        ) / mainItems.length
      : 10;

  return { dominantB, dominantC, avgH };
}

const WATERMARK_PATTERNS =
  /^(机密|内部使用|草稿|仅供内部|验收|DRAFT|CONFIDENTIAL|PROPRIETARY|FOR INTERNAL USE|公章|防伪|已失效|样本|示意|非正式|试用版)$/i;

export function isWatermark(
  it: RawPdfTextItem,
  dominantB: number,
  dominantC: number,
  avgH: number
): boolean {
  const t = it.transform;
  if (!t) return false;

  const str = (it.str ?? "").trim();
  if (str && WATERMARK_PATTERNS.test(str)) return true;

  const b = t[1] ?? 0;
  const c = t[2] ?? 0;
  const rotThreshold = Math.max(avgH * 0.8, 3);
  if (Math.abs(b - dominantB) > rotThreshold) return true;
  if (Math.abs(c - dominantC) > rotThreshold) return true;

  const h = it.height ?? Math.abs(t[3] ?? 0);
  return avgH > 0 && h > avgH * 4 && str.length <= 6;
}

export function normalizePdfTextItem(
  raw: RawPdfTextItem,
  pageNumber: number,
  params: PageParams
): PdfTextItem | null {
  const text = (raw.str ?? "").trim();
  const t = raw.transform;
  if (!text || !t) return null;
  if (isWatermark(raw, params.dominantB, params.dominantC, params.avgH)) {
    return null;
  }

  const a = t[0] ?? 0;
  const b = t[1] ?? 0;
  const c = t[2] ?? 0;
  const d = t[3] ?? 0;
  const e = t[4] ?? 0;
  const f = t[5] ?? 0;
  const rotatedQuarterTurn = Math.abs(b) > Math.abs(a) && Math.abs(c) > Math.abs(d);
  const height = raw.height ?? Math.max(Math.abs(d), Math.abs(b), 10);

  return {
    text,
    x: rotatedQuarterTurn ? f : e,
    y: rotatedQuarterTurn ? e : f,
    width: raw.width ?? 0,
    height,
    fontSize: height,
    pageNumber,
  };
}

export async function extractPageItems(buffer: Buffer): Promise<PdfTextItem[][]> {
  const pdfjsLib = await getPdfLib();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;

  const pages: PdfTextItem[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent({ disableCombineTextItems: false });
    const rawItems = tc.items as RawPdfTextItem[];
    const params = computePageParams(rawItems);
    pages.push(
      rawItems
        .map((it) => normalizePdfTextItem(it, i, params))
        .filter((it): it is PdfTextItem => it != null)
    );
  }
  return pages;
}

export function clusterColumnStarts(
  items: ColumnLike[],
  options: { tolerance?: number; minCount?: number } = {}
): number[] {
  if (!items.length) return [];
  const avgH =
    items.reduce((sum, it) => sum + (it.height ?? 10), 0) / items.length;
  const tolerance = options.tolerance ?? Math.max(avgH * 0.75, 6);
  const minCount = options.minCount ?? 2;
  const xs = items.map((it) => it.x).sort((a, b) => a - b);
  const clusters: { sum: number; count: number; center: number }[] = [];

  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(x - last.center) <= tolerance) {
      last.sum += x;
      last.count += 1;
      last.center = last.sum / last.count;
    } else {
      clusters.push({ sum: x, count: 1, center: x });
    }
  }

  return clusters
    .filter((c) => c.count >= minCount)
    .map((c) => Math.round(c.center));
}

export function findNearestColumn(
  x: number,
  columns: number[],
  tolerance = 24
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < columns.length; i++) {
    const dist = Math.abs(x - columns[i]);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return bestDist <= tolerance ? best : -1;
}
