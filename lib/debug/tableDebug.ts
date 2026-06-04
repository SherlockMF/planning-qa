// ============================================================================
// 表格调试输出（P1 #9，spec 第十八章）
// ----------------------------------------------------------------------------
// 每张 RagTable 输出 JSON / HTML / TXT 三份，供人工快速定位错列、漏行、误判。
//   debug/tables/{docId}/page-{pageStart}-{tableId}.json|html|txt
// JSON 含 tableId/tableType/页码/confidence/headers/rows/warnings 等结构化信息；
// HTML 渲染成可视表格（含告警横幅）；TXT 为纯文本速览。
// 注：rejectedRows / sourceItems / cellBBoxes 需坐标层（P2）才有，先留空占位。
// ============================================================================

import fs from "fs";
import path from "path";
import type { RagTable } from "@/lib/types";

const DEBUG_ROOT = path.join(process.cwd(), "debug", "tables");

function esc(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toJson(t: RagTable) {
  return {
    tableId: t.tableId,
    docId: t.docId,
    docTitle: t.docTitle,
    tableTitle: t.tableTitle,
    tableType: t.tableType,
    pageStart: t.pageStart,
    pageEnd: t.pageEnd,
    confidence: t.confidence,
    headers: t.columns.map((c) => ({
      header: c.header,
      canonicalName: c.canonicalName,
      headerPath: c.headerPath,
      unit: c.unit,
      originalIndex: c.originalIndex,
    })),
    rows: t.rows.map((r) => ({
      rowId: r.rowId,
      rowIndex: r.rowIndex,
      rowType: r.rowType,
      rowKey: r.rowKey,
      cells: r.cells,
      pageStart: r.pageStart,
      pageEnd: r.pageEnd,
    })),
    warnings: t.warnings,
    // 坐标层（P2）才有，先占位
    rejectedRows: [],
    sourceItems: [],
    cellBBoxes: [],
  };
}

function toHtml(t: RagTable): string {
  const cols = t.columns;
  const head = cols.map((c) => `<th>${esc(c.header)}</th>`).join("");
  const body = t.rows
    .map((r) => {
      const tds = cols.map((c) => `<td>${esc(r.cells[c.header] ?? "")}</td>`).join("");
      const cls = r.rowType === "data" ? "" : ` class="${r.rowType}"`;
      return `<tr${cls}><td>${r.rowIndex}</td>${tds}</tr>`;
    })
    .join("\n");
  const warn = t.warnings.length
    ? `<div class="warn">⚠ warnings: ${t.warnings.map(esc).join(", ")}</div>`
    : "";
  return `<!doctype html><meta charset="utf-8"><title>${esc(t.tableTitle)}</title>
<style>
body{font:13px/1.5 system-ui;margin:16px;color:#1e293b}
h1{font-size:15px} .meta{color:#64748b;margin-bottom:8px}
.warn{background:#fef3c7;border:1px solid #f59e0b;padding:6px 10px;border-radius:6px;margin:8px 0}
table{border-collapse:collapse;font-size:12px} th,td{border:1px solid #cbd5e1;padding:4px 8px;vertical-align:top;text-align:left}
th{background:#e0f2fe} tr.summary{background:#f1f5f9;font-weight:600} tr.note{color:#64748b;font-style:italic}
tr.header_continuation{display:none}
</style>
<h1>${esc(t.tableTitle)}</h1>
<div class="meta">${esc(t.docTitle)} ｜ ${esc(t.tableType)} ｜ 第${t.pageStart}-${t.pageEnd}页 ｜ confidence=${t.confidence.toFixed(2)} ｜ ${t.rows.length} 行 / ${cols.length} 列</div>
${warn}
<table><thead><tr><th>#</th>${head}</tr></thead><tbody>
${body}
</tbody></table>`;
}

function toTxt(t: RagTable): string {
  const lines: string[] = [];
  lines.push(`${t.tableTitle}  [${t.tableType}]  第${t.pageStart}-${t.pageEnd}页  conf=${t.confidence.toFixed(2)}`);
  lines.push(`doc: ${t.docTitle}`);
  if (t.warnings.length) lines.push(`warnings: ${t.warnings.join(", ")}`);
  lines.push(`columns: ${t.columns.map((c) => c.header).join(" | ")}`);
  lines.push("");
  for (const r of t.rows) {
    lines.push(
      `[${r.rowIndex}|${r.rowType}|${r.rowKey ?? ""}] ` +
        t.columns.map((c) => `${c.header}=${r.cells[c.header] ?? ""}`).join("  ")
    );
  }
  return lines.join("\n");
}

/** 写出单张表的 json/html/txt。返回文件基路径。失败抛出。 */
export function writeTableDebug(t: RagTable): string {
  const dir = path.join(DEBUG_ROOT, t.docId);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `page-${t.pageStart}-${t.tableId}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(toJson(t), null, 2));
  fs.writeFileSync(`${base}.html`, toHtml(t));
  fs.writeFileSync(`${base}.txt`, toTxt(t));
  return base;
}

/** 批量写出。容错：单表失败不影响其余。返回成功数。 */
export function writeAllTableDebug(tables: RagTable[]): number {
  let n = 0;
  for (const t of tables) {
    try {
      writeTableDebug(t);
      n++;
    } catch (e) {
      console.error("[tableDebug] write failed:", t.tableId, e);
    }
  }
  return n;
}

/** 是否启用表格调试输出（默认开；设 DEBUG_TABLES=0 关闭）。 */
export function tableDebugEnabled(): boolean {
  return process.env.DEBUG_TABLES !== "0";
}
