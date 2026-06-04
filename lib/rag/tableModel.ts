// ============================================================================
// 表格模型（需求 3、4）
// ----------------------------------------------------------------------------
// 输入：一组 \t 分隔的表格行（已去 [[T]] 标记）。
// 输出：TableModel（headers/rows/markdown）+ 行展开为带字段名的自然语言。
// 关键能力：
//  - 多行表头合并（如 "一般规模" + "建筑面积" → "一般规模-建筑面积"）；
//  - 跨页续表继承前表表头（inheritHeaders）；
//  - 行 → 自然语言："表名。设施名称：物业服务用房。一般规模-建筑面积：150。"
// ============================================================================

import type { TableModel } from "@/lib/types";

/** 单元格是否为"数值/取值"型（用于区分表头行与数据行）。 */
function isValueCell(cell: string): boolean {
  const c = cell.trim();
  if (!c) return false;
  if (/^[-—–~～/]+$/.test(c)) return true; // 纯连字符/区间符
  // 含数字，且不是以中文长词为主（避免把"每个项目1处"早判为表头分界）
  if (/\d/.test(c) && c.replace(/[^一-龥]/g, "").length <= 2) return true;
  return false;
}

/** 长 prose 单元格阈值：表头列名通常很短，>20 字几乎一定是正文数据。 */
const LONG_CELL = 20;
function isLongTextCell(cell: string): boolean {
  return cell.trim().length > LONG_CELL;
}

/**
 * 一行是否为"数据行"：
 *  - 首列之后出现取值型单元格（数值/区间/连字符）；或
 *  - 任意单元格是长 prose（说明/要求类表的数据格是整段文字，无数字，
 *    早期版本据此把数据行误判为表头并吞掉整表，此处修正）。
 */
function isDataRow(row: string[]): boolean {
  for (let i = 0; i < row.length; i++) {
    if (i >= 1 && isValueCell(row[i])) return true;
    if (isLongTextCell(row[i])) return true;
  }
  if (row.length === 1) return isValueCell(row[0]) || isLongTextCell(row[0]);
  return false;
}

/** 判定前导表头行数（1..3）：从第一行起，直到遇到数据行。 */
function detectHeaderRowCount(rows: string[][]): number {
  let count = 0;
  for (let i = 0; i < rows.length && i < 3; i++) {
    if (isDataRow(rows[i])) break;
    count++;
  }
  return Math.max(1, count);
}

/** 合并多行表头：逐列收集非空片段，用 "-" 连接。 */
function mergeHeaderRows(headerRows: string[][], cols: number): string[] {
  const headers: string[] = [];
  for (let c = 0; c < cols; c++) {
    const parts: string[] = [];
    for (const r of headerRows) {
      const cell = (r[c] ?? "").trim();
      if (cell && !parts.includes(cell)) parts.push(cell);
    }
    headers.push(parts.join("-"));
  }
  return headers;
}

function padHeaders(headers: string[], cols: number): string[] {
  const out = headers.slice(0, cols);
  while (out.length < cols) out.push(`列${out.length + 1}`);
  return out;
}

/** 生成 GFM markdown 表格。 */
export function toMarkdown(headers: string[], rows: string[][]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").trim() || " ";
  const head = `| ${headers.map(esc).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((r) => `| ${headers.map((_, i) => esc(r[i] ?? "")).join(" | ")} |`)
    .join("\n");
  return [head, sep, body].filter(Boolean).join("\n");
}

export interface BuildTableOptions {
  tableId: string;
  title?: string;
  /** 续表继承的表头 */
  inheritHeaders?: string[];
}

/** 从 \t 分隔行构建 TableModel。 */
export function buildTableModel(
  lines: string[],
  opts: BuildTableOptions
): TableModel {
  const rawRows = lines
    .map((l) => l.split("\t").map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));

  const maxCols = Math.max(1, ...rawRows.map((r) => r.length));
  const rows = rawRows.map((r) => {
    const copy = r.slice();
    while (copy.length < maxCols) copy.push("");
    return copy;
  });

  let headers: string[];
  let dataRows: string[][];

  if (opts.inheritHeaders && opts.inheritHeaders.length) {
    headers = padHeaders(opts.inheritHeaders, maxCols);
    dataRows = rows;
  } else if (rows.length === 0) {
    headers = [];
    dataRows = [];
  } else {
    const hrCount = detectHeaderRowCount(rows);
    headers = mergeHeaderRows(rows.slice(0, hrCount), maxCols);
    dataRows = rows.slice(hrCount);
  }

  dataRows = dataRows.filter((r) => r.some((c) => c !== ""));

  return {
    tableId: opts.tableId,
    title: opts.title,
    headers,
    rows: dataRows,
    markdown: toMarkdown(headers, dataRows),
  };
}

/** 归一化单元格：null→""，去换行、压空白。 */
function normCell(c: string | null | undefined): string {
  if (c == null) return "";
  return c.replace(/\n/g, "").replace(/\s+/g, " ").trim();
}

/**
 * 从单元格矩阵构建 TableModel（pdfplumber sidecar 路径）。
 *  - 合并单元格在矩阵中为 null：数据行按列「前向填充」承接上一行的值
 *    （如「层级=项目级」纵向合并跨多行，下方行 null → 填回「项目级」）；
 *  - 表头行（前导非数据行）用 mergeHeaderRows 合并为单层列名；
 *  - 续表通过 inheritHeaders 继承前表表头。
 */
export function buildTableModelFromMatrix(
  matrix: (string | null)[][],
  opts: BuildTableOptions
): TableModel {
  const maxCols = Math.max(1, ...matrix.map((r) => r.length));
  const rows = matrix.map((r) => {
    const c = r.slice();
    while (c.length < maxCols) c.push(null);
    return c;
  });

  let headers: string[];
  let dataStart: number;
  if (opts.inheritHeaders && opts.inheritHeaders.length) {
    headers = padHeaders(opts.inheritHeaders, maxCols);
    dataStart = 0;
  } else if (rows.length === 0) {
    return { tableId: opts.tableId, title: opts.title, headers: [], rows: [], markdown: "" };
  } else {
    const norm = rows.map((r) => r.map(normCell));
    const hrCount = detectHeaderRowCount(norm);
    headers = mergeHeaderRows(norm.slice(0, hrCount), maxCols);
    dataStart = hrCount;
  }

  // 数据行：仅对 null（合并单元格）前向填充，"" 与 "-" 视为真实值保留
  const filled: string[][] = [];
  const last = new Array<string>(maxCols).fill("");
  for (const r of rows.slice(dataStart)) {
    const fr: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      const raw = r[c];
      if (raw == null) {
        fr.push(last[c]);
      } else {
        const v = normCell(raw);
        fr.push(v);
        if (v) last[c] = v;
      }
    }
    filled.push(fr);
  }
  const dataRows = filled.filter((r) => r.some((c) => c !== ""));

  return {
    tableId: opts.tableId,
    title: opts.title,
    headers,
    rows: dataRows,
    markdown: toMarkdown(headers, dataRows),
  };
}

/** 名称型表头（强：直接是对象名；弱：指标/类别，作次选）。 */
const STRONG_NAME_HEADER = /(名称|设施|术语|代码|对象|项目)/;
const WEAK_NAME_HEADER = /(指标|类别|用地|分类|管控)/;
const NUMERIC_ONLY = /^[\d\s\-—–./%()（）]+$/;

/**
 * 行主键：优先取「名称型列」的值（设施名称/指标名称/类别/代码…），
 * 否则取首个非纯数字单元格，再否则取首个非空单元格。
 */
export function rowKeyOf(row: string[], headers?: string[]): string {
  if (headers && headers.length) {
    for (const re of [STRONG_NAME_HEADER, WEAK_NAME_HEADER]) {
      for (let i = 0; i < headers.length; i++) {
        const v = (row[i] ?? "").trim();
        if (re.test(headers[i]) && v && !NUMERIC_ONLY.test(v)) return v;
      }
    }
  }
  for (const c of row) {
    const t = (c ?? "").trim();
    if (t && !NUMERIC_ONLY.test(t)) return t;
  }
  for (const c of row) {
    const t = (c ?? "").trim();
    if (t) return t;
  }
  return "";
}

/** 行 → 字段 JSON（列名→单元格值，跳过空）。 */
export function rowFields(
  headers: string[],
  row: string[]
): Record<string, string> {
  const fields: Record<string, string> = {};
  headers.forEach((h, i) => {
    const val = (row[i] ?? "").trim();
    if (h && val) fields[h] = val;
  });
  return fields;
}

/**
 * 行 → 自然语言展开（需求 4）：带表名与字段名。
 * 例："表1—1 综合服务类设施配置指标表。设施名称：物业服务用房。层级：项目级。
 *      一般规模-建筑面积：150。服务规模：每个项目1处。"
 */
export function expandRow(
  model: TableModel,
  row: string[],
  sectionPath?: string
): string {
  const parts: string[] = [];
  const head = [sectionPath, model.title].filter(Boolean).join(" ");
  if (head) parts.push(head);
  model.headers.forEach((h, i) => {
    const val = (row[i] ?? "").trim();
    if (h && val) parts.push(`${h}：${val}`);
  });
  return parts.join("。") + "。";
}
