"use client";

import { useRef, useState, useId } from "react";
import type { Document, FileType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useKnowledgeUser } from "@/components/KnowledgeUserProvider";
import { PLANNING_FILE_TYPES } from "@/lib/knowledge/fileTypes";
import { Upload, Loader2, FileUp, X, CheckCircle2, AlertCircle } from "lucide-react";

const FILE_TYPES: FileType[] = PLANNING_FILE_TYPES;

interface FileItem {
  key: string;
  file: File;
  city: string;
  fileType: FileType;
  /** 生效日期（YYYY-MM-DD，可选），用于多版本文件的优先级排序 */
  effectiveDate: string;
  status: "pending" | "uploading" | "processing" | "done" | "error";
  /** 上传成功后记录文档 id：解析失败重试时只重跑解析，不重复建档 */
  docId?: string;
  error?: string;
}

export function DocumentUploader({
  onUploaded,
}: {
  onUploaded: (docs: Document[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const { currentUser } = useKnowledgeUser();
  const [items, setItems] = useState<FileItem[]>([]);
  const [defaultCity, setDefaultCity] = useState("北京");
  const [defaultType, setDefaultType] = useState<FileType>("项目资料");
  const [uploading, setUploading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ── 选文件 ──
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    if (!chosen.length) return;
    setItems((prev) => {
      const existingNames = new Set(prev.map((i) => i.file.name));
      const fresh: FileItem[] = chosen
        .filter((f) => !existingNames.has(f.name))
        .map((f, idx) => ({
          key: `${Date.now()}-${idx}-${f.name}`,
          file: f,
          city: defaultCity,
          fileType: defaultType,
          effectiveDate: "",
          status: "pending" as const,
        }));
      return [...prev, ...fresh];
    });
    // 清空 input，允许再次选同名文件
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  function updateItem(
    key: string,
    patch: Partial<Pick<FileItem, "city" | "fileType" | "effectiveDate">>
  ) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  // ── 应用默认值到所有 pending 行 ──
  function applyDefaultsToAll() {
    setItems((prev) =>
      prev.map((i) =>
        i.status === "pending"
          ? { ...i, city: defaultCity, fileType: defaultType }
          : i
      )
    );
  }

  // ── 上传 ──
  async function handleUpload() {
    // error 行也纳入队列：支持失败重试
    const queue = items.filter(
      (i) => i.status === "pending" || i.status === "error"
    );
    if (!queue.length) {
      setGlobalError("没有待上传的文件");
      return;
    }
    setUploading(true);
    setGlobalError(null);

    const results: Document[] = [];

    // 逐个串行处理：解析阶段要调 embedding 接口，并行会触发限流
    for (const item of queue) {
      try {
        let docId = item.docId;

        // 已建档（上次解析失败）→ 跳过上传，只重跑解析，避免重复建档
        if (!docId) {
          setItems((prev) =>
            prev.map((i) =>
              i.key === item.key
                ? { ...i, status: "uploading", error: undefined }
                : i
            )
          );
          const form = new FormData();
          form.append("file", item.file);
          form.append("city", item.city.trim() || "未知");
          form.append("fileType", item.fileType);
          form.append("userId", currentUser.id);
          if (item.effectiveDate) form.append("effectiveDate", item.effectiveDate);
          const res = await fetch("/api/documents/upload", {
            method: "POST",
            body: form,
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error ?? `上传失败：${res.status}`);
          }
          const data = await res.json();
          docId = (data.document as Document).id;
          setItems((prev) =>
            prev.map((i) => (i.key === item.key ? { ...i, docId } : i))
          );
        }

        // 自动解析
        setItems((prev) =>
          prev.map((i) =>
            i.key === item.key
              ? { ...i, status: "processing", error: undefined }
              : i
          )
        );
        const processRes = await fetch(
          `/api/documents/${docId}/process?userId=${encodeURIComponent(
            currentUser.id
          )}`,
          { method: "POST" }
        );
        const pd = await processRes.json().catch(() => ({}));
        if (!processRes.ok) {
          throw new Error(pd.error ?? `解析失败：${processRes.status}`);
        }

        results.push(pd.document as Document);
        setItems((prev) =>
          prev.map((i) => (i.key === item.key ? { ...i, status: "done" } : i))
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((i) =>
            i.key === item.key
              ? {
                  ...i,
                  status: "error",
                  error: e instanceof Error ? e.message : "上传出错",
                }
              : i
          )
        );
      }
    }

    if (results.length) onUploaded(results);
    setUploading(false);
  }

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const doneCount = items.filter((i) => i.status === "done").length;
  const errorCount = items.filter((i) => i.status === "error").length;
  const uploadableCount = pendingCount + errorCount;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        {/* ── 顶栏：选文件 + 默认值 ── */}
        <div className="grid gap-3 md:grid-cols-[1fr_140px_200px_auto_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-file`}>添加文件</Label>
            <Input
              id={`${uid}-file`}
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md,.markdown"
              onChange={handleFileChange}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-city`}>默认城市</Label>
            <Input
              id={`${uid}-city`}
              value={defaultCity}
              onChange={(e) => setDefaultCity(e.target.value)}
              placeholder="北京"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-type`}>默认类型</Label>
            <Select
              id={`${uid}-type`}
              value={defaultType}
              onChange={(e) => setDefaultType(e.target.value as FileType)}
            >
              {FILE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          {items.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="self-end"
              onClick={applyDefaultsToAll}
              disabled={uploading}
            >
              应用到全部
            </Button>
          )}
          <Button
            onClick={handleUpload}
            disabled={uploading || uploadableCount === 0}
            className="self-end"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {pendingCount === 0 && errorCount > 0
              ? `重试 ${errorCount} 个`
              : uploadableCount > 1
              ? `上传 ${uploadableCount} 个`
              : "上传"}
          </Button>
        </div>

        {/* ── 文件列表（多文件时展开，逐行可编辑） ── */}
        {items.length > 0 && (
          <div className="rounded-md border divide-y text-sm">
            {items.map((item) => (
              <div
                key={item.key}
                className={`flex items-center gap-2 px-3 py-2 ${
                  item.status === "done"
                    ? "bg-green-50/60"
                    : item.status === "error"
                    ? "bg-red-50/60"
                    : item.status === "uploading" || item.status === "processing"
                    ? "bg-sky-50/60"
                    : ""
                }`}
              >
                {/* 状态图标 */}
                <span className="shrink-0 w-4">
                  {(item.status === "uploading" || item.status === "processing") && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />
                  )}
                  {item.status === "done" && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  )}
                  {item.status === "error" && (
                    <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                  )}
                </span>

                {/* 文件名 */}
                <span className="flex-1 min-w-0 truncate text-slate-700" title={item.file.name}>
                  {item.file.name}
                  {item.status === "uploading" && (
                    <span className="ml-2 text-xs text-sky-600">上传中…</span>
                  )}
                  {item.status === "processing" && (
                    <span className="ml-2 text-xs text-sky-600">解析中…</span>
                  )}
                  {item.error && (
                    <span className="ml-2 text-xs text-red-600">{item.error}</span>
                  )}
                </span>

                {/* 城市 */}
                <Input
                  className="w-20 h-7 text-xs px-2"
                  value={item.city}
                  disabled={item.status !== "pending" && item.status !== "error"}
                  onChange={(e) => updateItem(item.key, { city: e.target.value })}
                  placeholder="城市"
                />

                {/* 文件类型 */}
                <Select
                  className="w-36 h-7 text-xs"
                  value={item.fileType}
                  disabled={item.status !== "pending" && item.status !== "error"}
                  onChange={(e) =>
                    updateItem(item.key, { fileType: e.target.value as FileType })
                  }
                >
                  {FILE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>

                {/* 生效日期（可选，用于多版本优先级） */}
                <Input
                  type="date"
                  className="w-32 h-7 text-xs px-2"
                  value={item.effectiveDate}
                  disabled={item.status !== "pending" && item.status !== "error"}
                  onChange={(e) =>
                    updateItem(item.key, { effectiveDate: e.target.value })
                  }
                  title="生效日期（可选）"
                />

                {/* 删除 */}
                {(item.status === "pending" || item.status === "error") && (
                  <button
                    onClick={() => removeItem(item.key)}
                    className="shrink-0 text-slate-400 hover:text-red-500 transition-colors"
                    aria-label="移除"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 状态摘要 */}
        {(doneCount > 0 || errorCount > 0) && (
          <p className="text-xs text-muted-foreground">
            {doneCount > 0 && (
              <span className="text-green-700 mr-3">✓ {doneCount} 个已入库</span>
            )}
            {errorCount > 0 && (
              <span className="text-red-600">{errorCount} 个失败</span>
            )}
          </p>
        )}

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileUp className="h-3.5 w-3.5 shrink-0" />
          支持 PDF、DOCX、TXT、Markdown；多文件可分别设置城市、类型与生效日期（可选，用于新旧版本排序）；上传后自动解析入库，失败可点击重试。
        </p>

        {globalError && (
          <p className="text-xs text-destructive">{globalError}</p>
        )}
      </CardContent>
    </Card>
  );
}
