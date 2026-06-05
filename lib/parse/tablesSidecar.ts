// ============================================================================
// 表格 sidecar 桥接（需求 3/4 的上游修复）
// ----------------------------------------------------------------------------
// pdfjs 文字层对「旋转坐标系 + 多列 + 合并表头」的政府 PDF 几何重建会乱列，
// 改由 Python(pdfplumber) 抽取单元格矩阵（scripts/extract_tables.py），
// 本模块负责：spawn 子进程 → 解析 JSON → 续表合并为「逻辑表」→ 转 Block[]，
// 并与 ir.ts 的几何块（标题/段落/列表）按页拼接成最终 IR。
//
// 优雅降级：Python / pdfplumber 不可用或抽取失败 → 返回空，调用方回退到
// 纯几何 IR（extractBlocks 自带的表格块），不影响其余正文解析。
// ============================================================================

import { spawn } from "child_process";
import os from "os";
import fs from "fs";
import path from "path";
import type { Block, TableModel } from "../types";
import { buildTableModelFromMatrix } from "../rag/tableModel.ts";
import { extractBlocks } from "./ir.ts";
import { headerFingerprint, fingerprintSimilar } from "./headerFingerprint.ts";
import { extractTablesFromCoords } from "./coordTables.ts";
import { summarizeTableComparison } from "../debug/coordTableCompare.ts";

export interface RawTable {
  page: number;
  bbox: number[] | null;
  title: string | null;
  rows: (string | null)[][];
  /** 扫描页标记（无表）。 */
  scanned?: boolean;
  /** 扫描页 OCR 文本（OCR_SCANNED=1 时有值）。 */
  ocrText?: string;
}

const BUNDLED_PYTHON = path.join(
  os.homedir(),
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  "python.exe"
);
const PY_CANDIDATES = ["py", "python", "python3", BUNDLED_PYTHON];
const SCRIPT = path.join(process.cwd(), "scripts", "extract_tables.py");

/** 尝试用某个 python 解释器运行脚本。返回 "ENOENT" 表示该解释器不存在（可换下一个）。 */
function trySpawn(
  py: string,
  pdfPath: string
): Promise<RawTable[] | null | "ENOENT"> {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(py, [SCRIPT, pdfPath], { windowsHide: true });
    } catch {
      resolve("ENOENT");
      return;
    }
    const outChunks: Buffer[] = [];
    let settled = false;
    const done = (v: RawTable[] | null | "ENOENT") => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    proc.on("error", (e: NodeJS.ErrnoException) =>
      done(e.code === "ENOENT" ? "ENOENT" : null)
    );
    proc.stdout.on("data", (d: Buffer) => outChunks.push(d));
    proc.on("close", (code) => {
      if (code !== 0) return done(null);
      try {
        const j = JSON.parse(Buffer.concat(outChunks).toString("utf8"));
        done(Array.isArray(j) ? (j as RawTable[]) : null);
      } catch {
        done(null);
      }
    });
  });
}

async function runPython(pdfPath: string): Promise<RawTable[] | null> {
  for (const py of PY_CANDIDATES) {
    const r = await trySpawn(py, pdfPath);
    if (r !== "ENOENT") return r; // 拿到结果或真实失败 → 不再换解释器
  }
  return null; // 所有解释器都不存在
}

/** 把 PDF buffer 写临时文件交给 Python，返回原始表格数组（失败/不可用→空）。 */
export async function extractTablesViaPython(
  buffer: Buffer
): Promise<RawTable[]> {
  const tmp = path.join(
    os.tmpdir(),
    `qa-tbl-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
  );
  try {
    fs.writeFileSync(tmp, buffer);
  } catch {
    return [];
  }
  try {
    const r = await runPython(tmp);
    return r ?? [];
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

type TableExtractorMode = "coords" | "python" | "auto";

function getTableExtractorMode(): TableExtractorMode {
  const value = process.env.TABLE_EXTRACTOR?.toLowerCase();
  if (value === "coords" || value === "python" || value === "auto") return value;
  return "python";
}

async function extractRawTables(buffer: Buffer): Promise<RawTable[]> {
  const mode = getTableExtractorMode();
  if (mode === "coords") {
    try {
      return await extractTablesFromCoords(buffer);
    } catch {
      return [];
    }
  }
  if (mode === "auto") {
    let coordTables: RawTable[] = [];
    try {
      coordTables = await extractTablesFromCoords(buffer);
    } catch {
      coordTables = [];
    }
    const pythonTables = await extractTablesViaPython(buffer);
    if (!pythonTables.length) return coordTables;
    if (coordTables.length && coordComparableToPython(coordTables, pythonTables)) {
      return coordTables;
    }
    return pythonTables;
  }
  try {
    return await extractTablesViaPython(buffer);
  } catch {
    return [];
  }
}

function coordComparableToPython(
  coordTables: RawTable[],
  pythonTables: RawTable[]
): boolean {
  const summary = summarizeTableComparison(coordTables, pythonTables);
  const coord = summary.coord;
  const python = summary.python;
  if (coord.tableCount < Math.max(1, python.tableCount * 0.8)) return false;
  if (coord.totalRows < python.totalRows * 0.8) return false;
  if (coord.maxEffectiveColumns < python.maxEffectiveColumns * 0.8) return false;
  if (coord.emptyCellRate > python.emptyCellRate + 0.15) return false;
  return true;
}

// ── 续表合并：相邻页 + 同列数 + 无标题（或"续表"）→ 归入同一逻辑表 ──

interface LogicalTable {
  model: TableModel;
  cols: number;
  pageStart: number;
  pageEnd: number;
  bbox?: number[];
  dataRows: string[][];
  /** 表头指纹（归一化列名集合），用于无标题续表识别。 */
  fingerprint: string;
}

const CONT_TITLE_RE = /续表|[(（]\s*续\s*[)）]|续$/;

function groupTables(raw: RawTable[]): LogicalTable[] {
  const sorted = [...raw].sort((a, b) => a.page - b.page);
  const groups: LogicalTable[] = [];
  let seq = 0;

  for (const rt of sorted) {
    const cols = Math.max(1, ...rt.rows.map((r) => r.length));
    // 先用自身表头算指纹，供续表判定
    const probe = buildTableModelFromMatrix(rt.rows, {
      tableId: "probe",
      title: rt.title ?? undefined,
    });
    const fp = headerFingerprint(probe.headers);

    const last = groups[groups.length - 1];
    const adjacent = !!last && rt.page <= last.pageEnd + 1 && cols === last.cols;
    const titleCont = !rt.title || CONT_TITLE_RE.test(rt.title);
    const fpMatch = !!last && fingerprintSimilar(fp, last.fingerprint);
    // 续表：相邻页 + 同列数 + (续表标题/无标题 或 表头指纹相似)；
    // 防过度合并：若有独立的非续表标题且指纹不相似，则视为新表。
    const hasDistinctTitle = !!rt.title && !CONT_TITLE_RE.test(rt.title);
    const isCont = adjacent && (titleCont || fpMatch) && !(hasDistinctTitle && !fpMatch);

    if (isCont && last) {
      // 用自身表头检测剥掉续页重复表头，仅取数据行，并入前表
      const cm = buildTableModelFromMatrix(rt.rows, {
        tableId: last.model.tableId,
        title: last.model.title,
      });
      last.dataRows.push(...cm.rows);
      last.pageEnd = rt.page;
      continue;
    }

    const tableId = `tbl-${seq++}`;
    const model = buildTableModelFromMatrix(rt.rows, {
      tableId,
      title: rt.title ?? undefined,
    });
    groups.push({
      model,
      cols,
      pageStart: rt.page,
      pageEnd: rt.page,
      bbox: rt.bbox ?? undefined,
      dataRows: [...model.rows],
      fingerprint: fp,
    });
  }
  return groups;
}

/** 逻辑表 → Block[]（table + 每行 table_row）。 */
export function tablesToBlocks(raw: RawTable[]): Block[] {
  const groups = groupTables(raw);
  const blocks: Block[] = [];
  for (const g of groups) {
    const model: TableModel = {
      tableId: g.model.tableId,
      title: g.model.title,
      headers: g.model.headers,
      rows: g.dataRows,
      markdown: buildMarkdown(g.model.headers, g.dataRows),
    };
    const bbox =
      g.bbox && g.bbox.length === 4
        ? ([g.bbox[0], g.bbox[1], g.bbox[2], g.bbox[3]] as [
            number,
            number,
            number,
            number,
          ])
        : undefined;
    blocks.push({
      type: "table",
      pageStart: g.pageStart,
      pageEnd: g.pageEnd,
      bbox,
      rawText: model.markdown,
      normalizedText: [model.title, model.markdown].filter(Boolean).join("\n"),
      table: model,
    });
    for (const row of g.dataRows) {
      blocks.push({
        type: "table_row",
        pageStart: g.pageStart,
        pageEnd: g.pageEnd,
        rawText: row.join("\t"),
        normalizedText: row.filter(Boolean).join(" "),
        rowCells: row,
      });
    }
  }
  return blocks;
}

/** 复用 tableModel 的 GFM 生成（避免导出耦合，这里内联同款实现）。 */
function buildMarkdown(headers: string[], rows: string[][]): string {
  const esc = (s: string) => (s ?? "").replace(/\|/g, "\\|").trim() || " ";
  const head = `| ${headers.map(esc).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((r) => `| ${headers.map((_, i) => esc(r[i] ?? "")).join(" | ")} |`)
    .join("\n");
  return [head, sep, body].filter(Boolean).join("\n");
}

// ── 几何表格碎片识别（去重）──
// 同一张表会被两个抽取器各取一遍：pdfplumber 出干净表格，几何 IR 在表格区域
// 往往未识别为 table，而吐出乱序的 paragraph（数字拼接、标点错位）。这些碎片
// 与 sidecar 表格内容重复且是噪声，需在「有 sidecar 表格的页」上按特征剔除。
// 仅删带明显错乱特征的块，避免误伤表格页上的正常说明文字。
function looksLikeTableFragment(text: string): boolean {
  if (/\d{5,}/.test(text)) return true; // 长数字串：单元格数值被拼接（年份仅 4 位，不误伤）
  if (/([、，/／·]\s+){3,}/.test(text)) return true; // 标点簇：单元格分隔错位
  const units = (
    text.match(/平方米|千人指标|规模性指标|用地面积|建筑面积|服务规模/g) || []
  ).length;
  const nums = (text.match(/\d/g) || []).length;
  return units >= 3 && nums >= 8;
}

// ── 顶层：几何 IR + sidecar 表格按页拼接 ──

/** 按页稳定合并：同页内文本块在前、表格块在后。 */
function mergeByPage(textBlocks: Block[], tableBlocks: Block[]): Block[] {
  const tagged = [
    ...textBlocks.map((b, i) => ({ b, page: b.pageStart, lane: 0, i })),
    ...tableBlocks.map((b, i) => ({ b, page: b.pageStart, lane: 1, i })),
  ];
  tagged.sort(
    (x, y) => x.page - y.page || x.lane - y.lane || x.i - y.i
  );
  return tagged.map((t) => t.b);
}

/**
 * PDF → IR（混合）：
 *  - 几何 IR 提供标题/段落/列表（以及页内顺序）；
 *  - Python sidecar 提供高质量表格，替换几何表格块；
 *  - sidecar 不可用时回退到纯几何 IR。
 */
export async function extractBlocksWithTables(buffer: Buffer): Promise<Block[]> {
  const geom = await extractBlocks(buffer);
  let rawTables = await extractRawTables(buffer);
  // 扫描页 OCR 文本 → 段落 block（使扫描内容可检索）。
  const ocrBlocks: Block[] = rawTables
    .filter((t) => t.scanned && t.ocrText && t.ocrText.trim().length > 0)
    .map((t) => ({
      type: "paragraph" as const,
      pageStart: t.page,
      pageEnd: t.page,
      rawText: t.ocrText!,
      normalizedText: t.ocrText!.trim(),
    }));

  // 过滤扫描页占位 / 空表（sidecar 对扫描页输出 rows:[] 占位，不能当表处理）
  rawTables = rawTables.filter(
    (t) => Array.isArray(t.rows) && t.rows.length > 0
  );
  if (!rawTables.length && !ocrBlocks.length) return geom; // 回退：保留几何表格

  const tableBlocks = [...tablesToBlocks(rawTables), ...ocrBlocks];
  const tablePages = new Set(rawTables.map((t) => t.page));
  const nonTable = geom.filter((b) => {
    if (b.type === "table" || b.type === "table_row") return false;
    // 表格页上的几何碎片（与 sidecar 表格重复的乱序文本）剔除；标题/页码等保留
    if (
      (b.type === "paragraph" || b.type === "list_item") &&
      tablePages.has(b.pageStart) &&
      looksLikeTableFragment(b.normalizedText)
    ) {
      return false;
    }
    return true;
  });
  return mergeByPage(nonTable, tableBlocks);
}
