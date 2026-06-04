// ============================================================================
// 表格置信度评分（P1，spec 第五章）
// ----------------------------------------------------------------------------
// 取代旧的 looksLikeRealTable 通用「一票否决」规则。那套规则（列数<3、单元格
// 均长>9、散文标点≥30%、数字单元格<20%）会误杀真实表格 —— 尤其是配置要求表、
// 成果要求表、代码定义表（它们天然数字少、单元格长、含标点）。
//
// 改为多信号加权评分 + 表格类型候选识别。只有当「分数极低 且 无任何 tableType
// 命中 且 无稳定二维结构」时，才回退为普通段落；否则一律保留为表格，宁可多保留
// 让 SemanticParser/人工 debug 处理，也不轻易丢弃。
// ============================================================================

import type { TableType } from "@/lib/types";

export interface TableConfidence {
  score: number;
  reasons: string[];
  tableTypeCandidates: TableType[];
  negativeReasons: string[];
}

// ── tableType 候选信号（按单元格全文 + 列结构） ──

const TYPE_SIGNALS: { type: TableType; re: RegExp }[] = [
  { type: "indicator_table", re: /(指标|配建|建筑面积|用地面积|千人指标|服务规模|一般规模|容积率|建筑高度|建筑规模)/ },
  { type: "requirement_table", re: /(配置要求|布局要求|布局引导|管控要求|技术要求|审查要求|详细配置要求|使用说明|要求内容)/ },
  { type: "code_table", re: /(类别代码|用地代码|用地分类|主类|中类|小类|类别名称)/ },
  { type: "deliverable_table", re: /(成果|图纸|附表|附件|清单|数据库|比例尺|格式要求|提交材料|申报材料|图面要素)/ },
  { type: "legend_table", re: /(图例|图面要素|rgb|颜色|符号|线型)/i },
];

/** 代码模式：A1 / A11 / R2 / 0701 / 090203，作为 code_table 的强信号。 */
const CODE_CELL_RE = /^[A-Za-z]\d{1,3}$|^\d{4,6}$/;

function detectTypeCandidates(cells: string[]): TableType[] {
  const surface = cells.join(" ");
  const found = new Set<TableType>();
  for (const { type, re } of TYPE_SIGNALS) {
    if (re.test(surface)) found.add(type);
  }
  // 代码表兜底：≥2 个单元格本身就是代码
  const codeCells = cells.filter((c) => CODE_CELL_RE.test(c.trim())).length;
  if (codeCells >= 2) found.add("code_table");
  return [...found];
}

// ── 结构指标 ──

interface Structure {
  rowCount: number;
  modalCols: number;
  /** 列数落在「众数 ±1」内的行占比 */
  stability: number;
  stable2D: boolean;
  hasShortLabels: boolean;
}

function analyzeStructure(cellRows: string[][]): Structure {
  const colCounts = cellRows.map((r) => r.filter((c) => c.trim() !== "").length);
  const rowCount = cellRows.length;

  // 列数众数
  const freq = new Map<number, number>();
  for (const n of colCounts) freq.set(n, (freq.get(n) ?? 0) + 1);
  let modalCols = 1;
  let best = 0;
  for (const [n, f] of freq) {
    if (n >= 1 && f > best) {
      best = f;
      modalCols = n;
    }
  }
  const stability =
    rowCount > 0
      ? colCounts.filter((n) => Math.abs(n - modalCols) <= 1).length / rowCount
      : 0;

  const allCells = cellRows.flat().map((c) => c.trim()).filter(Boolean);
  const hasShortLabels = allCells.some((c) => c.length <= 12);

  // 稳定二维：≥3 行、众数列 ≥2、且列数大体稳定
  const stable2D = rowCount >= 3 && modalCols >= 2 && stability >= 0.6;

  return { rowCount, modalCols, stability, stable2D, hasShortLabels };
}

/**
 * 对一段疑似表格的单元格矩阵评分。cellRows 为 \t 切出的二维单元格（含空串）。
 */
export function scoreTableRegion(cellRows: string[][]): TableConfidence {
  const reasons: string[] = [];
  const negativeReasons: string[] = [];
  const cells = cellRows.flat().map((c) => c.trim()).filter(Boolean);

  const s = analyzeStructure(cellRows);
  const candidates = detectTypeCandidates(cells);

  let score = 0;

  if (s.stable2D) {
    score += 0.4;
    reasons.push("stable_2d_grid");
  } else {
    negativeReasons.push("no_stable_grid");
  }
  if (s.rowCount >= 3) {
    score += 0.1;
  } else {
    negativeReasons.push("too_few_rows");
  }
  if (s.modalCols >= 3) {
    score += 0.1;
    reasons.push("multi_column");
  } else if (s.modalCols < 2) {
    negativeReasons.push("single_column");
  }
  if (candidates.length > 0) {
    score += 0.3;
    reasons.push(`table_type:${candidates.join("|")}`);
  } else {
    negativeReasons.push("no_table_type_signal");
  }
  if (s.hasShortLabels) {
    score += 0.1;
    reasons.push("has_short_labels");
  }

  // 明显散文：单列 + 行少 + 无类型信号 → 进一步压低
  if (s.modalCols < 2 && candidates.length === 0) {
    score = Math.min(score, 0.15);
    negativeReasons.push("looks_like_prose");
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(3))));

  return { score, reasons, tableTypeCandidates: candidates, negativeReasons };
}

/** 回退分数阈值：低于此分且无其它强信号才判为假表格。 */
const LOW_SCORE = 0.3;

/**
 * 是否保留为表格（spec 第五章回退判据）。
 * 仅当「分数极低 且 无 tableType 命中 且 无稳定二维结构」时回退为段落。
 */
export function shouldKeepAsTable(c: TableConfidence): boolean {
  if (c.tableTypeCandidates.length > 0) return true;
  if (c.reasons.includes("stable_2d_grid")) return true;
  return c.score >= LOW_SCORE;
}
