"use client";

import { useEffect, useState } from "react";
import type { Citation } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { TableBlock } from "@/components/TableBlock";
import { useKnowledgeUser } from "@/components/KnowledgeUserProvider";
import { isCitationTable } from "@/lib/ui/tableDisplay";
import {
  AlertTriangle,
  BookOpen,
  FileText,
  Image as ImageIcon,
  FileType2,
  Maximize2,
  Minimize2,
  Table2,
} from "lucide-react";

const RELEVANCE_VARIANT: Record<
  Citation["relevance"],
  "success" | "info" | "secondary"
> = {
  高: "success",
  中: "info",
  低: "secondary",
};

export function CitationSourcePanel({
  citation,
  index,
}: {
  citation?: Citation | null;
  index?: number;
}) {
  const { currentUser } = useKnowledgeUser();
  const canPage = !!citation?.documentId && citation.pageNumber != null;
  const [view, setView] = useState<"page" | "text">(canPage ? "page" : "text");
  const [pageFailed, setPageFailed] = useState(false);
  const [isPageZoomed, setIsPageZoomed] = useState(false);

  useEffect(() => {
    setView(canPage ? "page" : "text");
    setPageFailed(false);
    setIsPageZoomed(false);
  }, [canPage, citation?.id]);

  if (!citation) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-5 text-sm text-muted-foreground">
        <div className="mb-2 flex items-center gap-2 font-medium text-slate-700">
          <BookOpen className="h-4 w-4" />
          引用原文
        </div>
        点击左侧依据卡片，这里会显示对应的原文页面或提取片段。
      </div>
    );
  }

  const isTable = isCitationTable(citation);
  const needsSourceReview =
    citation.excerptDisplayPolicy === "source_page_required" ||
    citation.lowFidelity ||
    (citation.extractionWarnings?.length ?? 0) > 0;
  const sourceMeta = [
    citation.sectionPath,
    citation.articleNo,
    citation.pageNumber != null ? `第 ${citation.pageNumber} 页` : undefined,
  ].filter(Boolean);
  const pageSrc = canPage
    ? `/api/documents/${citation.documentId}/page?n=${citation.pageNumber}&dpi=${
        isPageZoomed ? 220 : 150
      }&userId=${encodeURIComponent(
        currentUser.id
      )}`
    : "";

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/30 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge variant="info">依据{index ?? ""}</Badge>
          {isTable && (
            <Badge variant="secondary" className="gap-1">
              <Table2 className="h-3 w-3" />
              表格片段
            </Badge>
          )}
          {needsSourceReview && (
            <Badge variant="warning" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              需核原文
            </Badge>
          )}
          <Badge variant={RELEVANCE_VARIANT[citation.relevance]}>
            相关度{citation.relevance}
          </Badge>
        </div>
        <h3 className="break-words text-sm font-semibold leading-6 text-slate-900">
          {citation.fileName}
        </h3>
        {sourceMeta.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {sourceMeta.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4 p-4">
        {canPage && !pageFailed && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-md border border-sky-200 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setView("page")}
                className={`flex items-center gap-1 rounded px-2.5 py-1 transition-colors ${
                  view === "page"
                    ? "bg-sky-600 text-white"
                    : "text-slate-600 hover:bg-sky-50"
                }`}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                原文页面
              </button>
              <button
                type="button"
                onClick={() => setView("text")}
                className={`flex items-center gap-1 rounded px-2.5 py-1 transition-colors ${
                  view === "text"
                    ? "bg-sky-600 text-white"
                    : "text-slate-600 hover:bg-sky-50"
                }`}
              >
                <FileType2 className="h-3.5 w-3.5" />
                提取片段
              </button>
            </div>
            {view === "page" && (
              <button
                type="button"
                onClick={() => setIsPageZoomed((value) => !value)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50"
                aria-pressed={isPageZoomed}
                title={isPageZoomed ? "缩小原文页面" : "放大原文页面"}
              >
                {isPageZoomed ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
                {isPageZoomed ? "缩小" : "放大"}
              </button>
            )}
          </div>
        )}

        {canPage && view === "page" && !pageFailed ? (
          <div className="max-h-[68vh] overflow-auto rounded-lg border border-sky-200 bg-slate-50 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pageSrc}
              alt={`${citation.fileName} 第 ${citation.pageNumber} 页`}
              className={`h-auto transition-[width] ${
                isPageZoomed
                  ? "max-w-none cursor-zoom-out"
                  : "mx-auto w-full max-w-full cursor-zoom-in"
              }`}
              style={isPageZoomed ? { width: "190%" } : undefined}
              onClick={() => setIsPageZoomed((value) => !value)}
              onError={() => setPageFailed(true)}
            />
          </div>
        ) : isTable ? (
          <div className="max-h-[68vh] overflow-auto rounded-lg border border-sky-200 bg-white p-2">
            {pageFailed && <FallbackNotice />}
            <TableBlock text={citation.excerpt} />
          </div>
        ) : (
          <div className="max-h-[68vh] overflow-auto rounded-lg border border-sky-200 bg-sky-50/70 p-4 text-sm leading-7 text-slate-800">
            {pageFailed && <FallbackNotice />}
            <FileText className="mb-2 h-4 w-4 text-sky-700" />
            {citation.excerpt}
          </div>
        )}
      </div>
    </div>
  );
}

function FallbackNotice() {
  return (
    <p className="mb-2 text-xs text-amber-600">
      原始页面暂不可用（该文档可能无原始 PDF），已回退到提取片段。
    </p>
  );
}
