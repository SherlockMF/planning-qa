"use client";

import { useState } from "react";
import type { Citation } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  FileText,
  Hash,
  BookMarked,
  Table2,
  Eye,
  Image as ImageIcon,
  FileType2,
} from "lucide-react";
import { TableBlock } from "@/components/TableBlock";
import { useKnowledgeUser } from "@/components/KnowledgeUserProvider";
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
}: {
  citation: Citation;
  index?: number;
}) {
  const isTable = isCitationTable(citation);
  const needsSourceReview =
    citation.excerptDisplayPolicy === "source_page_required" ||
    citation.lowFidelity ||
    (citation.extractionWarnings?.length ?? 0) > 0;
  const { currentUser } = useKnowledgeUser();
  const canPage = !!citation.documentId && citation.pageNumber != null;
  const [view, setView] = useState<"page" | "text">(canPage ? "page" : "text");
  const [pageFailed, setPageFailed] = useState(false);
  const pageSrc = canPage
    ? `/api/documents/${citation.documentId}/page?n=${citation.pageNumber}&userId=${encodeURIComponent(
        currentUser.id
      )}&dpi=150`
    : "";
  const sourceMeta = [
    citation.sectionPath,
    citation.articleNo,
    citation.pageNumber != null ? `第 ${citation.pageNumber} 页` : undefined,
  ].filter(Boolean);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group w-full rounded-lg border border-sky-200 bg-sky-50/60 p-4 text-left transition-colors hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-300"
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
            查看原文
          </div>
        </button>
      </DialogTrigger>

      <DialogContent className="left-auto right-0 top-0 h-screen max-w-xl translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l bg-white p-0 sm:rounded-none">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-base">引用原文</DialogTitle>
          <DialogDescription className="sr-only">
            当前引用依据的原文片段。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
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
                  解析需核原文
                </Badge>
              )}
              <Badge variant={RELEVANCE_VARIANT[citation.relevance]}>
                相关度{citation.relevance}
              </Badge>
            </div>
            <h3 className="break-words text-lg font-semibold leading-7 text-slate-900">
              {citation.fileName}
            </h3>
            {sourceMeta.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {sourceMeta.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            )}
          </div>

          {canPage && !pageFailed && (
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
          )}

          {canPage && view === "page" && !pageFailed ? (
            <div className="overflow-auto rounded-lg border border-sky-200 bg-slate-50 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pageSrc}
                alt={`${citation.fileName} 第 ${citation.pageNumber} 页`}
                className="mx-auto h-auto w-full max-w-full"
                onError={() => setPageFailed(true)}
              />
            </div>
          ) : isTable ? (
            <div className="overflow-auto rounded-lg border border-sky-200 bg-white p-2">
              {pageFailed && (
                <p className="mb-2 text-xs text-amber-600">
                  原始页面暂不可用（该文档可能无原始 PDF），已回退到提取内容。
                </p>
              )}
              <TableBlock text={citation.excerpt} />
            </div>
          ) : (
            <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-5 text-[15px] leading-8 text-slate-800">
              {pageFailed && (
                <p className="mb-2 text-xs text-amber-600">
                  原始页面暂不可用（该文档可能无原始 PDF），已回退到提取片段。
                </p>
              )}
              {citation.excerpt}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
