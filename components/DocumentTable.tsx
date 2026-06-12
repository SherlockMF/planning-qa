"use client";

import { useState } from "react";
import type { Document, DocumentStatus } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import {
  RefreshCw,
  Trash2,
  Loader2,
  FileText,
  Search,
  SearchX,
} from "lucide-react";

const STATUS_META: Record<
  DocumentStatus,
  { label: string; variant: "secondary" | "info" | "success" | "destructive" }
> = {
  pending: { label: "待处理", variant: "secondary" },
  processing: { label: "处理中", variant: "info" },
  indexed: { label: "已入库", variant: "success" },
  failed: { label: "失败", variant: "destructive" },
};

export function DocumentTable({
  documents,
  onChange,
}: {
  documents: Document[];
  onChange: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  // 只认仍存在于列表中的选中项（删除/刷新后自动失效）
  const selectedIds = documents.filter((d) => selected.has(d.id)).map((d) => d.id);
  const allSelected =
    documents.length > 0 && selectedIds.length === documents.length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(documents.map((d) => d.id)));
  }

  async function process(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/documents/${id}/process`, { method: "POST" });
      onChange();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("确定删除该文档及其切片？此操作不可撤销。")) return;
    setBusyId(id);
    try {
      await fetch(`/api/documents/${id}`, { method: "DELETE" });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      onChange();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleEnabled(doc: Document) {
    setBusyId(doc.id);
    try {
      await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !doc.enabled }),
      });
      onChange();
    } finally {
      setBusyId(null);
    }
  }

  // ── 批量操作（逐个串行：解析含 embedding 调用，并行会触发接口限流） ──

  async function batchProcess() {
    setBatchBusy(true);
    try {
      for (let i = 0; i < selectedIds.length; i++) {
        setBatchProgress(`解析中 ${i + 1}/${selectedIds.length}`);
        await fetch(`/api/documents/${selectedIds[i]}/process`, {
          method: "POST",
        });
      }
      onChange();
    } finally {
      setBatchBusy(false);
      setBatchProgress(null);
    }
  }

  async function batchSetEnabled(enabled: boolean) {
    setBatchBusy(true);
    try {
      for (let i = 0; i < selectedIds.length; i++) {
        setBatchProgress(`更新中 ${i + 1}/${selectedIds.length}`);
        await fetch(`/api/documents/${selectedIds[i]}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
      }
      onChange();
    } finally {
      setBatchBusy(false);
      setBatchProgress(null);
    }
  }

  async function batchRemove() {
    if (
      !confirm(
        `确定删除所选 ${selectedIds.length} 个文档及其切片？此操作不可撤销。`
      )
    )
      return;
    setBatchBusy(true);
    try {
      for (let i = 0; i < selectedIds.length; i++) {
        setBatchProgress(`删除中 ${i + 1}/${selectedIds.length}`);
        await fetch(`/api/documents/${selectedIds[i]}`, { method: "DELETE" });
      }
      setSelected(new Set());
      onChange();
    } finally {
      setBatchBusy(false);
      setBatchProgress(null);
    }
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-8 w-8" />}
        title="尚无文档"
        description="上传 PDF / DOCX / TXT / Markdown 文档，处理入库后即可参与法规问答检索。"
      />
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      {/* 批量操作工具条（有选中时显示） */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
          <span className="text-muted-foreground">
            已选 {selectedIds.length} 个
          </span>
          {batchProgress ? (
            <span className="flex items-center gap-1.5 text-sky-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {batchProgress}
            </span>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={batchProcess}
                disabled={batchBusy}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重新解析
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => batchSetEnabled(true)}
                disabled={batchBusy}
              >
                <Search className="h-3.5 w-3.5" />
                参与检索
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => batchSetEnabled(false)}
                disabled={batchBusy}
              >
                <SearchX className="h-3.5 w-3.5" />
                取消检索
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={batchRemove}
                disabled={batchBusy}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </Button>
              <button
                onClick={() => setSelected(new Set())}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                取消选择
              </button>
            </>
          )}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 cursor-pointer accent-primary align-middle"
                checked={allSelected}
                ref={(el) => {
                  if (el)
                    el.indeterminate = selectedIds.length > 0 && !allSelected;
                }}
                onChange={toggleSelectAll}
                disabled={batchBusy}
                aria-label="全选"
              />
            </TableHead>
            <TableHead className="min-w-[220px]">文件名</TableHead>
            <TableHead>城市</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>参与检索</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>上传时间</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => {
            const status = STATUS_META[doc.status];
            const busy = busyId === doc.id || batchBusy;
            return (
              <TableRow
                key={doc.id}
                className={selected.has(doc.id) ? "bg-primary/5" : undefined}
              >
                <TableCell>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer accent-primary align-middle"
                    checked={selected.has(doc.id)}
                    onChange={() => toggleSelect(doc.id)}
                    disabled={batchBusy}
                    aria-label="选择文档"
                  />
                </TableCell>
                <TableCell className="font-medium text-slate-800">
                  <span className="break-all">{doc.fileName}</span>
                </TableCell>
                <TableCell>
                  <Badge variant="info">{doc.city}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {doc.fileType}
                </TableCell>
                <TableCell>
                  <button
                    onClick={() => toggleEnabled(doc)}
                    disabled={busy}
                    className="disabled:opacity-50"
                    title="点击切换是否参与检索"
                  >
                    <Badge variant={doc.enabled ? "success" : "secondary"}>
                      {doc.enabled ? "是" : "否"}
                    </Badge>
                  </button>
                </TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(doc.createdAt).toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => process(doc.id)}
                      disabled={busy}
                    >
                      {busyId === doc.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      重新解析
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(doc.id)}
                      disabled={busy}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
