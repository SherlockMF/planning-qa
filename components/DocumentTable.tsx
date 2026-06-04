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
import { RefreshCw, Trash2, Loader2, FileText } from "lucide-react";

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
      <Table>
        <TableHeader>
          <TableRow>
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
            const busy = busyId === doc.id;
            return (
              <TableRow key={doc.id}>
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
                      {busy ? (
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
