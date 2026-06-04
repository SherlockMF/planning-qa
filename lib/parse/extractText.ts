// ============================================================================
// 文档正文提取
// ----------------------------------------------------------------------------
// PDF 提取使用 pdfjs-dist legacy build（Node.js 兼容，比 pdf-parse 内置的旧版
// pdfjs 有更好的 CJK 字符合并能力）。
// 使用 pdfjs-dist 的原因：pdf-parse 内置的 pdfjs v1.10.100 对中文逐字存储的
// PDF 提取质量较差（每个汉字是独立 text item），pdfjs-dist v4+ 能自动合并。
// ============================================================================

import path from "path";
import { fileURLToPath } from "url";

// ── PDF 提取 ─────────────────────────────────────────────────────────────────

interface PdfItem {
  str: string;
  x: number;
  y: number;
  xEnd: number;
  h: number;
}

async function getPdfLib() {
  // webpackIgnore: true — 告知 webpack 不要打包/分析此 import，让 Node.js 在
  // 运行时原生处理 ESM。pdfjs-dist v4+ 是 ESM-only（无 CJS .js 版本），
  // 若 webpack 尝试用 require() 加载会报 __webpack_modules__[moduleId] is not a function。
  const pdfjsLib: any = await import(
    /* webpackIgnore: true */ "pdfjs-dist/legacy/build/pdf.mjs"
  );

  // Worker 路径需要使用 file:// URL（Windows 路径问题）
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
      // 路径解析失败时 pdfjs 会自动 fallback 到 fake worker（性能下降但可用）
    }
  }
  return pdfjsLib;
}

export async function extractText(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return extractPdf(buffer);
  if (lower.endsWith(".docx")) return extractDocx(buffer);
  return buffer.toString("utf8");
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const pages = await extractPdfPages(buffer);
  return pages
    .map((p) => `\n[[page:${p.pageNo}]]\n${p.lines.join("\n")}\n`)
    .join("");
}

/** 单页重建结果：保留页码与逐行文本（含 \t 列分隔与 [[T]] 表格标记）。 */
export interface PdfPage {
  pageNo: number;
  lines: string[];
}

/**
 * 逐页提取并重建文本行（供 IR 层 extractBlocks 复用）。
 * 与 extractPdf 共享同一套几何重建逻辑（reconstructPageLines）。
 */
export async function extractPdfPages(buffer: Buffer): Promise<PdfPage[]> {
  const pdfjsLib = await getPdfLib();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0, // 静默 pdfjs 日志
  });
  const pdf = await loadingTask.promise;

  const pages: PdfPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent({ disableCombineTextItems: false });
    pages.push({ pageNo: i, lines: reconstructPageLines(tc.items) });
  }
  return pages;
}

// ── 页面渲染 ─────────────────────────────────────────────────────────────────

/**
 * 计算页面的主导旋转参数（b/c 中位数）及平均字体高度。
 * 原理：正文文字共享相同的旋转矩阵；水印文字旋转角度与正文不同。
 * 注意：部分政府 PDF 整页均为旋转坐标系（如 b=14.749, c=-14.749），
 *       此时 dominantB/C 为页面主方向，水印则是额外偏转的文字。
 */
function computePageParams(rawItems: any[]): {
  dominantB: number;
  dominantC: number;
  avgH: number;
} {
  const nonEmpty = rawItems.filter((it) => it.str?.trim().length > 0);
  if (!nonEmpty.length) return { dominantB: 0, dominantC: 0, avgH: 10 };

  const bs = nonEmpty.map((it) => it.transform?.[1] ?? 0).sort((a, b) => a - b);
  const cs = nonEmpty.map((it) => it.transform?.[2] ?? 0).sort((a, b) => a - b);
  const mid = Math.floor(bs.length / 2);
  const dominantB = bs[mid];
  const dominantC = cs[mid];

  // 仅取与主方向一致的 items 计算平均高度（使用 height 字段，比 transform[3] 更可靠）
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

/** 常见背景水印文本模式（政府/企业文档）。 */
const WATERMARK_PATTERNS =
  /^(机密|内部使用|草案|仅供内部|验收|DRAFT|CONFIDENTIAL|PROPRIETARY|FOR INTERNAL USE|公章|防伪|已失效|样本|示意|非正式|试用版)$/i;

/**
 * 判断一个 PDF text item 是否为水印/背景印章。
 * 三层检测策略：
 *  1. 文本内容匹配已知水印词汇 → 水印；
 *  2. 旋转角度与页面主方向差异显著 → 额外倾斜盖章；
 *  3. 字体尺寸异常大且短 → 大字体背景文字。
 */
function isWatermark(
  it: any,
  dominantB: number,
  dominantC: number,
  avgH: number
): boolean {
  const t = it.transform;
  if (!t) return false;

  const str = (it.str ?? "").trim();
  // 策略1：文本内容匹配已知水印词汇
  if (str && WATERMARK_PATTERNS.test(str)) return true;

  const b = t[1] ?? 0;
  const c = t[2] ?? 0;
  const bDiff = Math.abs(b - dominantB);
  const cDiff = Math.abs(c - dominantC);
  // 策略2：旋转角度超出主方向阈值（额外倾斜）
  const rotThreshold = Math.max(avgH * 0.8, 3);
  if (bDiff > rotThreshold || cDiff > rotThreshold) return true;

  // 策略3：字体尺寸异常大（> 4× 平均）且字符数少（≤6）
  const h = it.height ?? Math.abs(t[3] ?? 0);
  if (avgH > 0 && h > avgH * 4 && str.length <= 6) return true;

  return false;
}

/**
 * 单页几何重建：水印过滤 → 阅读顺序 → 视觉行 → 续行合并 → 列检测 →
 * 插 \t → 数字碎片合并 → 表格行标记。返回非空行数组（不含页码标记）。
 */
function reconstructPageLines(rawItems: any[]): string[] {
  if (!rawItems.length) return [];

  const { dominantB, dominantC, avgH: paramAvgH } =
    computePageParams(rawItems);

  const items: PdfItem[] = rawItems
    .filter((it) => !isWatermark(it, dominantB, dominantC, paramAvgH))
    .map((it) => ({
      str: it.str ?? "",
      x: it.transform?.[4] ?? 0,
      y: it.transform?.[5] ?? 0,
      xEnd: (it.transform?.[4] ?? 0) + (it.width ?? 0),
      h: it.height ?? Math.abs(it.transform?.[3] ?? 10),
    }))
    .filter((it) => it.str.trim().length > 0);

  if (!items.length) return [];

  const avgH = items.reduce((s, it) => s + it.h, 0) / items.length;
  const LINE_GAP = Math.max(avgH * 0.6, 3);
  const COL_GAP = avgH * 1.5;

  // 1. 阅读顺序排序：Y 降序（上→下），同行内 X 升序（左→右）
  const sorted = [...items].sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > LINE_GAP) return dy;
    return a.x - b.x;
  });

  // 2. 聚合成视觉行
  type Row = { y: number; items: PdfItem[] };
  const rows: Row[] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.y - last.y) <= LINE_GAP) {
      last.items.push(it);
    } else {
      rows.push({ y: it.y, items: [it] });
    }
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);

  // 2b. 续行合并：PDF 表格中单元格内换行文字存储在不同 Y，形成碎裂行。
  // 判断条件：当前行 item 数 < 前一行，且每个 item 的 X 坐标落在前一行某 item 的 X 范围内。
  // 此时将当前行 item 追加到前一行对应 item 的文本上（不新建行）。
  const CONT_GAP = avgH * 2.5; // 续行 Y 间距上限
  const mergedRows: Row[] = [];
  for (const row of rows) {
    const prev = mergedRows[mergedRows.length - 1];
    const yGap = prev ? prev.y - row.y : Infinity;
    const isContinuation =
      prev &&
      yGap <= CONT_GAP &&
      row.items.length > 0 &&
      row.items.length < prev.items.length &&
      row.items.every((it) =>
        prev.items.some(
          (pit) => it.x >= pit.x - COL_GAP && it.x <= pit.xEnd + COL_GAP
        )
      );

    if (isContinuation) {
      for (const it of row.items) {
        const match = prev!.items.find(
          (pit) => it.x >= pit.x - COL_GAP && it.x <= pit.xEnd + COL_GAP
        );
        if (match) {
          match.str += it.str;
          match.xEnd = Math.max(match.xEnd, it.xEnd);
        }
      }
    } else {
      mergedRows.push({ y: row.y, items: [...row.items] });
    }
  }

  // 3. 检测稳定列边界（X 位置频率聚类），用于跨行对齐
  const colBoundaries = detectColumns(items, avgH);

  // 4. 行转文字：按列边界插入 \t
  const rawLines: string[] = [];
  for (const row of mergedRows) {
    let line = "";
    let prevXEnd = -Infinity;
    let prevColIdx = -1;
    for (const it of row.items) {
      const gap = it.x - prevXEnd;
      const curColIdx = findColIndex(it.x, colBoundaries);
      if (prevXEnd < 0) {
        line += it.str;
      } else if (gap > COL_GAP || (curColIdx > prevColIdx && curColIdx !== -1)) {
        // 列切换 → 插入制表符
        line += "\t" + it.str;
      } else {
        line += it.str;
      }
      prevXEnd = it.xEnd;
      prevColIdx = curColIdx;
    }
    rawLines.push(line);
  }

  // 5. 数字碎片合并：同列连续纯数字行合并（窄列数字换行）
  const fragMerged = mergeNumberFragments(rawLines);

  // 6. 表格行标记：在提取阶段识别表格并加 [[T]] 前缀，避免前端重新猜测
  const lines = markTableLines(fragMerged);

  // 7. 过滤无效行
  return lines
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

/**
 * 合并因窄列换行产生的数字碎片。
 * 策略：若当前行的每个列槽都只含数字/连字符/括号/空格，
 * 且前一行有相同列数，则把当前行各列追加到前一行对应列。
 */
function mergeNumberFragments(lines: string[]): string[] {
  const isNumericFrag = (s: string) =>
    s.trim().length > 0 && /^[\d\s\-\.\,\/\(\)%～—]+$/.test(s.trim());

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const prev = out[out.length - 1];

    if (!prev) { out.push(cur); continue; }

    const curCols = cur.split("\t");
    const prevCols = prev.split("\t");

    // 只合并：列数相同 + 当前行全为短数字片段（≤3字符）+ 合并后每列 ≤ 6字符
    // 限制短片段且限制结果长度，防止多步链式合并（如 1400+1200→140120）
    const shouldMerge =
      curCols.length === prevCols.length &&
      curCols.every((c) => isNumericFrag(c) && c.trim().length <= 3) &&
      curCols.every((c, ci) => (prevCols[ci].trim().length + c.trim().length) <= 6);

    if (shouldMerge) {
      out[out.length - 1] = prevCols
        .map((p, ci) => p.trimEnd() + (curCols[ci]?.trim() ?? ""))
        .join("\t");
    } else {
      out.push(cur);
    }
  }
  return out;
}

/**
 * 表格行标记（方案 C）：在提取阶段识别表格，给表格行加 [[T]] 前缀。
 *
 * 识别规则：
 *  - 扫描连续多列行（含 \t），允许其中夹杂 ≤ 2 行单列行（表格标题/小计行）；
 *  - 当连续段中多列行 ≥ 3 且各行列数差 ≤ 1（列数稳定），视为表格块；
 *  - 标记整个块内所有行（包括单列的标题行/空白行）。
 *
 * 优势：判断在提取阶段完成，前端无需重新分析；
 *       旧数据（无 [[T]]）自动回退到结构检测（向后兼容）。
 */
export const TABLE_LINE_MARKER = "[[T]]";

function markTableLines(lines: string[]): string[] {
  const colCounts = lines.map((l) => l.split("\t").length);
  const result = [...lines];
  let i = 0;

  while (i < lines.length) {
    // 跳过单列行
    if (colCounts[i] <= 1) { i++; continue; }

    // 发现多列行，开始扫描表格块
    const blockStart = i;
    const baseColCount = colCounts[i];
    let j = i + 1;
    let singleGap = 0; // 允许中间夹杂的单列行数

    while (j < lines.length) {
      const c = colCounts[j];
      if (c > 1 && Math.abs(c - baseColCount) <= 1) {
        singleGap = 0; // 重新出现多列行，重置间隔计数
        j++;
      } else if (c <= 1 && singleGap < 2) {
        singleGap++; // 允许 ≤ 2 行单列夹杂（如标题行、小计行）
        j++;
      } else {
        break;
      }
    }

    // 计算块内实际多列行数量
    const multiColInBlock = colCounts
      .slice(blockStart, j)
      .filter((c) => c > 1).length;

    if (multiColInBlock >= 3) {
      // 确认为表格块，标记所有行
      for (let k = blockStart; k < j; k++) {
        result[k] = TABLE_LINE_MARKER + result[k];
      }
    }

    i = j;
  }

  return result;
}

/**
 * 从页面所有 items 聚类出稳定的列 X 坐标。
 * 原理：对所有 item.x 值按 5px bucket 统计频率，出现频率高的是列边界。
 * 相邻 bucket 合并后得到稳定列列表，用于跨行对齐。
 */
function detectColumns(items: PdfItem[], avgH: number): number[] {
  const BUCKET = Math.max(avgH * 0.5, 4);
  const freq: Map<number, number> = new Map();
  for (const it of items) {
    const b = Math.round(it.x / BUCKET) * BUCKET;
    freq.set(b, (freq.get(b) ?? 0) + 1);
  }
  // 只保留出现 >= 3 次的候选
  const candidates = [...freq.entries()]
    .filter(([, n]) => n >= 3)
    .map(([x]) => x)
    .sort((a, b) => a - b);

  // 合并相邻候选（距离 < 2×BUCKET 则取平均）
  const merged: number[] = [];
  for (const x of candidates) {
    if (merged.length && x - merged[merged.length - 1] < BUCKET * 2) {
      merged[merged.length - 1] = Math.round((merged[merged.length - 1] + x) / 2);
    } else {
      merged.push(x);
    }
  }
  return merged;
}

/** 把 item.x 映射到最近列索引（列边界容差 = COL_BUCKET）。 */
function findColIndex(x: number, cols: number[]): number {
  if (!cols.length) return -1;
  const COL_TOL = 20;
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < cols.length; i++) {
    const d = Math.abs(x - cols[i]);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return bestDist <= COL_TOL ? best : -1;
}

// ── DOCX 提取 ────────────────────────────────────────────────────────────────

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth: any = await import("mammoth");
  const res = await mammoth.extractRawText({ buffer });
  return res.value ?? "";
}
