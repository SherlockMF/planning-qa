import type { Citation } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { FileText, Hash, BookMarked, Table2 } from "lucide-react";
import { TableBlock, hasTableStructure } from "@/components/TableBlock";

const RELEVANCE_VARIANT: Record<
  Citation["relevance"],
  "success" | "info" | "secondary"
> = {
  高: "success",
  中: "info",
  低: "secondary",
};

export function CitationCard({
  citation,
  index,
}: {
  citation: Citation;
  index?: number;
}) {
  const isTable = hasTableStructure(citation.excerpt);

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-4">
      {/* 标题行 */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2 text-sm font-medium text-slate-800">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
          <span className="break-all">
            {index != null && (
              <span className="mr-1 font-semibold text-sky-700">[{index}]</span>
            )}
            {citation.fileName}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isTable && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Table2 className="h-3 w-3" />
              表格
            </Badge>
          )}
          <Badge variant={RELEVANCE_VARIANT[citation.relevance]}>
            相关度 {citation.relevance}
          </Badge>
        </div>
      </div>

      {/* 元数据行 */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {citation.sectionPath && (
          <span className="flex items-center gap-1">
            <BookMarked className="h-3 w-3 shrink-0" />
            {citation.sectionPath}
          </span>
        )}
        {citation.articleNo && (
          <span className="flex items-center gap-1">
            <Hash className="h-3 w-3 shrink-0" />
            {citation.articleNo}
          </span>
        )}
        {citation.pageNumber != null && <span>第 {citation.pageNumber} 页</span>}
      </div>

      {/* 原文片段：表格内容渲染为网格，普通条文用引用块 */}
      {isTable ? (
        <div className="max-h-72 overflow-auto rounded-md border border-sky-200 bg-white p-1">
          <TableBlock text={citation.excerpt} />
        </div>
      ) : (
        <blockquote className="max-h-48 overflow-auto border-l-2 border-sky-300 pl-3 text-sm leading-relaxed text-slate-700">
          {citation.excerpt}
        </blockquote>
      )}
    </div>
  );
}
