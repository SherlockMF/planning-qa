"use client";

import { useState } from "react";
import type { RetrievedChunk, RetrieveDebugResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, SearchCode } from "lucide-react";

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {value.toFixed(3)}
      </span>
    </div>
  );
}

function ChunkResultRow({
  r,
  rank,
  mode,
}: {
  r: RetrievedChunk;
  rank: number;
  mode: "keyword" | "vector" | "merged";
}) {
  const c = r.chunk;
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">
            {rank}
          </span>
          <span className="break-all">{c.fileName}</span>
        </div>
        <Badge variant="outline" className="shrink-0 capitalize">
          {r.source}
        </Badge>
      </div>

      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {c.sectionPath && <span>章节：{c.sectionPath}</span>}
        {c.articleNo && <span>条款：{c.articleNo}</span>}
        {c.pageNumber != null && <span>页码：第{c.pageNumber}页</span>}
        <Badge variant="info" className="px-1.5 py-0">
          {c.city}
        </Badge>
      </div>

      <p className="mb-2 line-clamp-3 text-xs leading-relaxed text-slate-600">
        {c.content}
      </p>

      <div className="space-y-1">
        {mode !== "vector" && (
          <ScoreBar label="关键词" value={r.keywordScore} />
        )}
        {mode !== "keyword" && (
          <ScoreBar label="语义" value={Math.max(0, r.vectorScore)} />
        )}
        {mode === "merged" && (
          <ScoreBar label="重排序" value={r.rerankScore} />
        )}
      </div>

      {r.matchedKeywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {r.matchedKeywords.slice(0, 12).map((k) => (
            <span
              key={k}
              className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700"
            >
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function RetrievalDebugPanel() {
  const [question, setQuestion] = useState("二类居住用地是什么？");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RetrieveDebugResponse | null>(null);

  async function run() {
    if (!question.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/retrieve-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, city: "北京" }),
      });
      setData((await res.json()) as RetrieveDebugResponse);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            placeholder="输入要调试的检索问题"
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button onClick={run} disabled={loading || !question.trim()}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SearchCode className="h-4 w-4" />
              )}
              执行检索
            </Button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">提取的关键词</CardTitle>
            </CardHeader>
            <CardContent>
              {data.extractedKeywords.length === 0 ? (
                <p className="text-xs text-muted-foreground">未提取到关键词</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data.extractedKeywords.map((k) => (
                    <Badge key={k} variant="secondary">
                      {k}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Tabs defaultValue="merged">
            <TabsList>
              <TabsTrigger value="merged">
                合并 Top5（{data.mergedTop.length}）
              </TabsTrigger>
              <TabsTrigger value="keyword">
                关键词检索（{data.keywordResults.length}）
              </TabsTrigger>
              <TabsTrigger value="vector">
                向量检索（{data.vectorResults.length}）
              </TabsTrigger>
            </TabsList>

            <TabsContent value="merged" className="space-y-3">
              {data.mergedTop.map((r, i) => (
                <ChunkResultRow key={r.chunk.id} r={r} rank={i + 1} mode="merged" />
              ))}
            </TabsContent>
            <TabsContent value="keyword" className="space-y-3">
              {data.keywordResults.map((r, i) => (
                <ChunkResultRow
                  key={r.chunk.id}
                  r={r}
                  rank={i + 1}
                  mode="keyword"
                />
              ))}
            </TabsContent>
            <TabsContent value="vector" className="space-y-3">
              {data.vectorResults.map((r, i) => (
                <ChunkResultRow
                  key={r.chunk.id}
                  r={r}
                  rank={i + 1}
                  mode="vector"
                />
              ))}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
