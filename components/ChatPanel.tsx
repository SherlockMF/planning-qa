"use client";

import { useEffect, useState } from "react";
import type { ChatResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnswerCard } from "@/components/AnswerCard";
import { EmptyState } from "@/components/EmptyState";
import {
  Send,
  Loader2,
  MapPin,
  History,
  MessageSquareQuote,
  Trash2,
} from "lucide-react";
import { DEFAULT_CITY } from "@/lib/city";

const CITY = DEFAULT_CITY;
const STORAGE_KEY = "qa-chat-history-v1";
const MAX_RECORDS = 200;

const EXAMPLES = [
  "二类居住用地是什么？",
  "商业用地和商务金融用地有什么区别？",
  "居住用地的绿地率不应低于多少？",
  "大于90平方米的住宅每户停车位标准是多少？",
  "二类居住用地的容积率上限是多少？",
];

/** 持久化的问答记录（含完整回答，便于回看而不必重新提问）。 */
interface ChatRecord {
  id: string;
  question: string;
  response: ChatResponse;
  at: string;
}

function loadHistory(): ChatRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ChatRecord[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(records: ChatRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch {
    // localStorage 不可用或超额，忽略（不影响主链路）
  }
}

export function ChatPanel() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<ChatRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  // 首次挂载：从 localStorage 恢复记录
  useEffect(() => {
    setHistory(loadHistory());
    setLoaded(true);
  }, []);

  // 记录变化时落盘（恢复完成后才写，避免覆盖）
  useEffect(() => {
    if (loaded) saveHistory(history);
  }, [history, loaded]);

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
      const record: ChatRecord = {
        id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        question: trimmed,
        response: data,
        at: new Date().toISOString(),
      };
      setHistory((h) => [record, ...h].slice(0, MAX_RECORDS));
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求出错");
    } finally {
      setLoading(false);
    }
  }

  function viewRecord(rec: ChatRecord) {
    setQuestion(rec.question);
    setResponse(rec.response);
    setError(null);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function deleteSelected() {
    if (selected.size === 0) return;
    setHistory((h) => h.filter((r) => !selected.has(r.id)));
    setSelected(new Set());
  }

  function deleteOne(id: string) {
    setHistory((h) => h.filter((r) => r.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function clearAll() {
    if (!confirm("确定清空全部问答记录？此操作不可撤销。")) return;
    setHistory([]);
    setSelected(new Set());
  }

  const allSelected = history.length > 0 && selected.size === history.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
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

      {/* 问答记录 */}
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <History className="h-4 w-4" />
            问答记录
            {history.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                （{history.length}）
              </span>
            )}
          </div>
          {history.length > 0 && (
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground transition-colors hover:text-destructive"
            >
              清空
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
            暂无问答记录（记录会自动保存在本浏览器，刷新后仍在）
          </p>
        ) : (
          <>
            {/* 多选工具条 */}
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
              <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && !allSelected;
                  }}
                  onChange={() =>
                    setSelected(
                      allSelected ? new Set() : new Set(history.map((r) => r.id))
                    )
                  }
                />
                全选
              </label>
              {selected.size > 0 && (
                <button
                  onClick={deleteSelected}
                  className="flex items-center gap-1 text-destructive hover:underline"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除所选（{selected.size}）
                </button>
              )}
            </div>

            <ul className="space-y-2">
              {history.map((rec) => (
                <li
                  key={rec.id}
                  className={`flex items-start gap-2 rounded-md border bg-card p-2.5 transition-colors hover:bg-accent/60 ${
                    selected.has(rec.id) ? "border-primary/50 bg-primary/5" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                    checked={selected.has(rec.id)}
                    onChange={() => toggleSelect(rec.id)}
                    aria-label="选择记录"
                  />
                  <button
                    onClick={() => viewRecord(rec)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="line-clamp-2 text-xs text-slate-700">
                      {rec.question}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{formatTime(rec.at)}</span>
                      <Badge
                        variant={rec.response.foundEvidence ? "success" : "warning"}
                        className="px-1.5 py-0"
                      >
                        {rec.response.foundEvidence ? "已作答" : "已拒答"}
                      </Badge>
                    </div>
                  </button>
                  <button
                    onClick={() => deleteOne(rec.id)}
                    className="mt-0.5 shrink-0 text-slate-300 transition-colors hover:text-destructive"
                    aria-label="删除该记录"
                    title="删除该记录"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}
