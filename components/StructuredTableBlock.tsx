"use client";

import { useState } from "react";
import type { TableColumn, TableRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Table2, ChevronDown, ChevronUp, FileText } from "lucide-react";

// ============================================================================
// 结构化表格块（P0）
// ----------------------------------------------------------------------------
// 只从 RagTable 的 columns + rows[].cells 渲染真实表格，绝不从 chunk.content
// 反推。selected 列由后端 ColumnSelector 选定；"展开全部列" 利用 rows.cells
// 本就携带全部列值，在前端联合所有单元格键得到全列视图（无需额外请求）。
// ============================================================================

interface Source {
  docTitle: string;
  pageStart: number;
  pageEnd: number;
}

/** 联合所有行的单元格键，得到全列名（保 selected 列在前）。 */
function allColumnHeaders(columns: TableColumn[], rows: TableRow[]): string[] {
  const ordered = columns.map((c) => c.header);
  const seen = new Set(ordered);
  for (const r of rows) {
    for (const k of Object.keys(r.cells)) {
      if (!seen.has(k)) {
        ordered.push(k);
        seen.add(k);
      }
    }
  }
  return ordered;
}

function pageText(s: Source): string {
  if (!s.pageStart) return "";
  return s.pageStart === s.pageEnd
    ? `第${s.pageStart}页`
    : `第${s.pageStart}-${s.pageEnd}页`;
}

export function StructuredTableBlock({
  tableTitle,
  columns,
  rows,
  source,
  className,
}: {
  tableTitle: string;
  columns: TableColumn[];
  rows: TableRow[];
  source: Source;
  className?: string;
}) {
  const [showAll, setShowAll] = useState(false);

  const headers = showAll ? allColumnHeaders(columns, rows) : columns.map((c) => c.header);
  const hasMoreCols = allColumnHeaders(columns, rows).length > columns.length;

  return (
    <div className={cn("space-y-1.5", className)}>
      {/* 表名 + 控件 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <Table2 className="h-4 w-4 text-primary" />
          {tableTitle}
        </div>
        {hasMoreCols && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            {showAll ? (
              <>
                <ChevronUp className="h-3 w-3" /> 只看相关列
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> 展开全部列
              </>
            )}
          </button>
        )}
      </div>

      {/* 真实表格：来自 rows[].cells */}
      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-sky-100/70">
              {headers.map((h, j) => (
                <th
                  key={j}
                  className="whitespace-nowrap border border-sky-200 px-2 py-1 text-left font-medium text-slate-700"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.rowId ?? i} className="even:bg-sky-50/40">
                {headers.map((h, j) => (
                  <td
                    key={j}
                    className="border border-sky-200 px-2 py-1 align-top text-slate-700"
                  >
                    {r.cells[h] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 来源：文档 + 表名 + 页码 */}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FileText className="h-3 w-3" />
        <span>
          来源：{source.docTitle}
          {pageText(source) ? ` ｜ ${pageText(source)}` : ""}
        </span>
      </div>
    </div>
  );
}
