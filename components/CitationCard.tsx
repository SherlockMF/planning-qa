import type { Citation } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  FileText,
  Hash,
  BookMarked,
  Table2,
  Eye,
} from "lucide-react";
import { isCitationTable } from "@/lib/ui/tableDisplay";

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
  selected,
  onSelect,
}: {
  citation: Citation;
  index?: number;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const isTable = isCitationTable(citation);
  const needsSourceReview =
    citation.excerptDisplayPolicy === "source_page_required" ||
    citation.lowFidelity ||
    (citation.extractionWarnings?.length ?? 0) > 0;
  return (
        <button
          type="button"
          onClick={onSelect}
          className={`group w-full rounded-lg border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-sky-300 ${
            selected
              ? "border-sky-400 bg-sky-100/80 shadow-sm"
              : "border-sky-200 bg-sky-50/60 hover:border-sky-300 hover:bg-sky-50"
          }`}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2 text-sm font-medium text-slate-800">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
              <span className="break-all">
                {index != null && (
                  <span className="mr-1 font-semibold text-sky-700">
                    [{index}]
                  </span>
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
              {needsSourceReview && (
                <Badge variant="warning" className="gap-1 text-[10px]">
                  <AlertTriangle className="h-3 w-3" />
                  需核原文
                </Badge>
              )}
              <Badge variant={RELEVANCE_VARIANT[citation.relevance]}>
                相关度{citation.relevance}
              </Badge>
            </div>
          </div>

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

          <div className="rounded-md border border-sky-100 bg-white/70 p-3">
            <p className="max-h-12 overflow-hidden text-sm leading-6 text-slate-700">
              {citation.excerpt}
            </p>
          </div>
          <div className="mt-2 flex items-center justify-end gap-1 text-xs font-medium text-sky-700">
            <Eye className="h-3.5 w-3.5" />
            {selected ? "右侧正在显示" : "在右侧查看"}
          </div>
        </button>
  );
}
