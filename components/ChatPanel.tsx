"use client";

import { useState } from "react";
import type { ChatResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnswerCard } from "@/components/AnswerCard";
import { EmptyState } from "@/components/EmptyState";
import { Send, Loader2, MapPin, History, MessageSquareQuote } from "lucide-react";

const CITY = "北京";

const EXAMPLES = [
  "二类居住用地是什么？",
  "商业用地和商务金融用地有什么区别？",
  "居住用地的绿地率不应低于多少？",
  "大于90平方米的住宅每户停车位标准是多少？",
  "二类居住用地的容积率上限是多少？",
];

interface HistoryItem {
  question: string;
  foundEvidence: boolean;
  at: string;
}

export function ChatPanel() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, city: CITY }),
      });
      if (!res.ok) throw new Error(`请求失败：${res.status}`);
      const data = (await res.json()) as ChatResponse;
      setResponse(data);
      setHistory((h) =>
        [
          {
            question: trimmed,
            foundEvidence: data.foundEvidence,
            at: new Date().toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          },
          ...h,
        ].slice(0, 8)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求出错");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-5">
        {/* 城市提示 */}
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <MapPin className="h-4 w-4 text-primary" />
            当前知识库城市：
          </span>
          <Badge variant="info">{CITY}</Badge>
          <span className="text-xs">（北京 / 上海 / 深圳，可配置）</span>
        </div>

        {/* 输入区 */}
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="请输入问题，例如：二类居住用地的定义是什么？"
              rows={3}
              className="resize-none"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  ask(question);
                }
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                仅基于知识库作答 · 有依据才回答 · 无依据则拒答（Ctrl/⌘ + Enter 提交）
              </p>
              <Button onClick={() => ask(question)} disabled={loading || !question.trim()}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                提交查询
              </Button>
            </div>

            {/* 示例问题 */}
            <div className="flex flex-wrap gap-2 pt-1">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => {
                    setQuestion(ex);
                    ask(ex);
                  }}
                  disabled={loading}
                  className="rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                >
                  {ex}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 回答区 */}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-red-50 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!response && !loading && !error && (
          <EmptyState
            icon={<MessageSquareQuote className="h-8 w-8" />}
            title="输入问题后，这里将显示带依据的回答"
            description="系统会从知识库检索相关条文，并给出结论、文件、章节、条款、页码与原文片段；若无明确依据将明确拒答。"
          />
        )}

        {loading && (
          <Card>
            <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在检索知识库并生成带依据的回答…
            </CardContent>
          </Card>
        )}

        {response && !loading && <AnswerCard response={response} />}
      </div>

      {/* 最近提问 */}
      <aside className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <History className="h-4 w-4" />
          最近提问
        </div>
        {history.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
            暂无提问记录
          </p>
        ) : (
          <ul className="space-y-2">
            {history.map((h, i) => (
              <li key={i}>
                <button
                  onClick={() => {
                    setQuestion(h.question);
                    ask(h.question);
                  }}
                  className="w-full rounded-md border bg-card p-2.5 text-left text-xs transition-colors hover:bg-accent"
                >
                  <div className="line-clamp-2 text-slate-700">{h.question}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{h.at}</span>
                    <Badge
                      variant={h.foundEvidence ? "success" : "warning"}
                      className="px-1.5 py-0"
                    >
                      {h.foundEvidence ? "已作答" : "已拒答"}
                    </Badge>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
