// ============================================================================
// 测评结果导出（XLSX）
// ----------------------------------------------------------------------------
// 将 EvaluationItem 转为与页面表格一致的行，供浏览器下载。
// 纯函数便于单测；UI 按需 dynamic import xlsx 触发下载。
// ============================================================================

import type { EvaluationItem } from "@/lib/types";

/** 导出表头（与评测表格列一致，并含系统回答全文）。 */
export const EVALUATION_EXPORT_HEADERS = [
  "序号",
  "问题",
  "标准答案",
  "正确文件",
  "正确条款",
  "正确页码",
  "应拒答",
  "进Top5",
  "引用正确",
  "正确拒答",
  "答案得分",
  "耗时",
  "Token",
  "错误原因",
  "系统回答",
] as const;

function fmtBool(v?: boolean): string {
  if (v === undefined) return "";
  return v ? "是" : "否";
}

function fmtDuration(ms?: number): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtScore(v?: 0 | 1 | 2): string {
  return v === undefined ? "" : String(v);
}

/** 单题 → 导出行（字符串单元格）。 */
export function evaluationItemToRow(
  item: EvaluationItem,
  index: number
): string[] {
  return [
    item.seq ?? String(index + 1),
    item.question,
    item.standardAnswer,
    item.correctFile,
    item.correctArticle,
    item.correctPage,
    item.shouldRefuse ? "是" : "否",
    fmtBool(item.inTop5),
    fmtBool(item.citationCorrect),
    item.shouldRefuse ? fmtBool(item.refusedCorrectly) : "",
    fmtScore(item.answerScore),
    fmtDuration(item.answerDurationMs),
    item.tokensUsed != null ? String(item.tokensUsed) : "",
    item.errorReason ?? "",
    item.systemAnswer ?? "",
  ];
}

/** 含表头的完整二维数组，可直接写入 XLSX。 */
export function evaluationItemsToSheetRows(
  items: EvaluationItem[]
): string[][] {
  return [
    [...EVALUATION_EXPORT_HEADERS],
    ...items.map((item, i) => evaluationItemToRow(item, i)),
  ];
}

/** 生成带时间戳的默认文件名。 */
export function defaultEvaluationExportFilename(ext = "xlsx"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `测评结果-${stamp}.${ext}`;
}

/** 浏览器端下载 XLSX（需在 client 组件中调用）。 */
export async function downloadEvaluationXlsx(
  items: EvaluationItem[],
  filename?: string
): Promise<void> {
  if (items.length === 0) return;
  const XLSX = await import("xlsx");
  const rows = evaluationItemsToSheetRows(items);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 6 },
    { wch: 36 },
    { wch: 40 },
    { wch: 28 },
    { wch: 14 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 10 },
    { wch: 10 },
    { wch: 20 },
    { wch: 60 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "测评结果");
  XLSX.writeFile(wb, filename ?? defaultEvaluationExportFilename());
}
