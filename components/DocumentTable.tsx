"use client";

import { useState } from "react";
import type {
  Document,
  DocumentStatus,
  KnowledgeCategory,
  PermissionLevel,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";
import { KNOWLEDGE_USERS } from "@/lib/knowledge/permissions";
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

  async function saveMetadata(doc: Document, patch: Partial<Document>) {
    setBusyId(doc.id);
    try {
      await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
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

      <div className="border-b bg-muted/30 px-4 py-2">
        <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-primary"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = selectedIds.length > 0 && !allSelected;
            }}
            onChange={toggleSelectAll}
            disabled={batchBusy}
          />
          全选当前列表
        </label>
      </div>

      <div className="divide-y">
        {documents.map((doc) => {
          const status = STATUS_META[doc.status];
          const busy = busyId === doc.id || batchBusy;
          return (
            <article
              key={doc.id}
              className={`grid gap-4 p-4 transition-colors xl:grid-cols-[minmax(220px,1.1fr)_minmax(420px,2fr)_180px] ${
                selected.has(doc.id) ? "bg-primary/5" : "bg-card"
              }`}
            >
              <div className="flex min-w-0 gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                  checked={selected.has(doc.id)}
                  onChange={() => toggleSelect(doc.id)}
                  disabled={batchBusy}
                  aria-label="选择文档"
                />
                <div className="min-w-0 space-y-2">
                  <div className="flex items-start gap-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold leading-5 text-slate-800">
                        {doc.fileName}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(doc.createdAt).toLocaleString("zh-CN", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="info">{doc.city}</Badge>
                    <Badge variant="secondary">{doc.fileType}</Badge>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="知识分类">
                  <Select
                    className="h-8 text-xs"
                    value={doc.category ?? "其他"}
                    disabled={busy}
                    onChange={(e) =>
                      saveMetadata(doc, {
                        category: e.target.value as KnowledgeCategory,
                      })
                    }
                  >
                    {KNOWLEDGE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="项目">
                  <div className="grid gap-1.5">
                    <Input
                      className="h-8 px-2 text-xs"
                      defaultValue={doc.projectName ?? ""}
                      placeholder="非项目资料"
                      disabled={busy}
                      onBlur={(e) =>
                        saveMetadata(doc, { projectName: e.currentTarget.value })
                      }
                    />
                    <Input
                      className="h-8 px-2 text-xs"
                      defaultValue={doc.projectId ?? ""}
                      placeholder="project-id"
                      disabled={busy}
                      onBlur={(e) =>
                        saveMetadata(doc, { projectId: e.currentTarget.value })
                      }
                    />
                  </div>
                </Field>
                <Field label="负责人">
                  <div className="grid gap-1.5">
                    <Input
                      className="h-8 px-2 text-xs"
                      defaultValue={doc.owner ?? ""}
                      placeholder="负责人"
                      disabled={busy}
                      onBlur={(e) =>
                        saveMetadata(doc, { owner: e.currentTarget.value })
                      }
                    />
                    <Select
                      className="h-8 text-xs"
                      value={doc.projectOwnerId ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        saveMetadata(doc, {
                          projectOwnerId: e.target.value || undefined,
                        })
                      }
                    >
                      <option value="">无项目负责人</option>
                      {KNOWLEDGE_USERS.filter((u) => u.role !== "employee").map(
                        (u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        )
                      )}
                    </Select>
                  </div>
                </Field>
                <Field label="权限">
                  <Select
                    className="h-8 text-xs"
                    value={String(doc.permissionLevel ?? 1)}
                    disabled={busy}
                    onChange={(e) =>
                      saveMetadata(doc, {
                        permissionLevel: Number(e.target.value) as PermissionLevel,
                      })
                    }
                  >
                    <option value="1">L1 公开</option>
                    <option value="2">L2 项目</option>
                    <option value="3">L3 管理员</option>
                  </Select>
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-2 xl:flex-col xl:items-stretch xl:justify-center">
                <button
                  onClick={() => toggleEnabled(doc)}
                  disabled={busy}
                  className="rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-50"
                  title="点击切换是否参与检索"
                >
                  <Badge variant={doc.enabled ? "success" : "secondary"}>
                    {doc.enabled ? "参与检索" : "不参与检索"}
                  </Badge>
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => process(doc.id)}
                  disabled={busy}
                  className="justify-center"
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
                  className="justify-center text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
