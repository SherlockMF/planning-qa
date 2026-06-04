"use client";

import { useCallback, useEffect, useState } from "react";
import type { Chunk, Document } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { TableBlock } from "@/components/TableBlock";
import { Loader2, Layers, FileText } from "lucide-react";

type ChunkView = Omit<Chunk, "embedding">;

export function ChunkViewer() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [chunks, setChunks] = useState<ChunkView[]>([]);
  const [meta, setMeta] = useState<{ count: number; totalChars: number } | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setSelected(id);
    setChunks([]);
    setMeta(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${id}/chunks`, {
        cache: "no-store",
      });
      const data = await res.json();
      setChunks(data.chunks ?? []);
      setMeta({ count: data.count ?? 0, totalChars: data.totalChars ?? 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/documents", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const docs: Document[] = d.documents ?? [];
        setDocuments(docs);
        const firstIndexed = docs.find((x) => x.status === "indexed");
        if (firstIndexed) load(firstIndexed.id);
      });
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">选择文档</span>
          </div>
          <div className="min-w-[280px] flex-1">
            <Select
              value={selected}
              onChange={(e) => load(e.target.value)}
            >
              <option value="">请选择…</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fileName}（{d.status === "indexed" ? "已入库" : d.status}）
                </option>
              ))}
            </Select>
          </div>
          {meta && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="info" className="gap-1">
                <Layers className="h-3 w-3" />
                {meta.count} 个切片
              </Badge>
              <span>共 {meta.totalChars.toLocaleString()} 字</span>
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载切片…
        </div>
      ) : chunks.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-8 w-8" />}
          title="暂无切片"
          description="请选择一个已入库的文档；若文档未入库，请先在文档管理页完成「重新解析」。"
        />
      ) : (
        <div className="space-y-3">
          {chunks.map((c, i) => (
            <Card key={c.id}>
              <CardContent className="space-y-2 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                    {i + 1}
                  </span>
                  {c.pageNumber != null && (
                    <Badge variant="secondary">第 {c.pageNumber} 页</Badge>
                  )}
                  {c.articleNo && <Badge variant="info">{c.articleNo}</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {c.content.length} 字
                  </span>
                  {c.sectionPath && (
                    <span className="text-xs text-muted-foreground">
                      · {c.sectionPath}
                    </span>
                  )}
                </div>

                <div className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3">
                  <TableBlock text={c.content} />
                </div>

                {c.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.keywords.slice(0, 20).map((k) => (
                      <span
                        key={k}
                        className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
