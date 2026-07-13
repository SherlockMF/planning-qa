"use client";

import { useEffect, useState } from "react";
import type { ChatResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnswerCard } from "@/components/AnswerCard";
import { CitationSourcePanel } from "@/components/CitationSourcePanel";
import { EmptyState } from "@/components/EmptyState";
import { useKnowledgeUser } from "@/components/KnowledgeUserProvider";
import {
  Send,
  Loader2,
  MapPin,
  History,
  MessageSquareQuote,
  Trash2,
  ShieldCheck,
  ThumbsUp,
  ThumbsDown,
  LifeBuoy,
  X,
} from "lucide-react";
import { DEFAULT_CITY } from "@/lib/city";

const CITY = DEFAULT_CITY;
const STORAGE_KEY = "qa-chat-history-v1";
const MAX_RECORDS = 200;

const EXAMPLES = [
  "片区控规优化项目的用地调整原则是什么？",
  "片区控规优化项目需要提交哪些图纸和说明文件？",
  "TOD 综合开发项目的交通接驳设计重点是什么？",
  "社区卫生服务中心的服务规模是多少？",
  "二类居住用地的容积率上限是多少？",
];

/** 持久化的问答记录（含完整回答，便于回看而不必重新提问）。 */
interface ChatRecord {
  id: string;
  question: string;
  userId: string;
  userLabel: string;
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
  const [selectedCitationIndex, setSelectedCitationIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<ChatRecord[]>([]);
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [feedbackByTarget, setFeedbackByTarget] = useState<Record<string, string>>({});
  const { currentUser } = useKnowledgeUser();

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
        body: JSON.stringify({ question: trimmed, city: CITY, userId: currentUser.id }),
      });
      if (!res.ok) throw new Error(`请求失败：${res.status}`);
      const data = (await res.json()) as ChatResponse;
      setResponse(data);
      setSelectedCitationIndex(0);
      const record: ChatRecord = {
        id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        question: trimmed,
        userId: currentUser.id,
        userLabel: currentUserLabel,
        response: data,
        at: new Date().toISOString(),
      };
      setActiveRecordId(record.id);
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
    setSelectedCitationIndex(0);
    setActiveRecordId(rec.id);
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
    if (activeRecordId === id) setActiveRecordId(null);
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
  const currentUserLabel = `${currentUser.name} · ${currentUser.department}`;
  const layoutClass =
    "relative grid gap-4 xl:grid-cols-[64px_minmax(520px,0.78fr)_minmax(540px,1fr)] 2xl:grid-cols-[72px_minmax(600px,0.78fr)_minmax(720px,1fr)]";

  async function submitFeedback(type: "helpful" | "not_helpful" | "need_human") {
    const targetId = response?.feedbackTargetId;
    if (!targetId || feedbackByTarget[targetId]) return;
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId, type, userId: currentUser.id }),
    });
    setFeedbackByTarget((prev) => ({ ...prev, [targetId]: type }));
  }

  return (
    <div className={layoutClass}>
      <aside
        className="relative z-30 xl:sticky xl:top-24 xl:self-start"
        onMouseEnter={() => setHistoryCollapsed(false)}
        onMouseLeave={() => setHistoryCollapsed(true)}
        onFocus={() => setHistoryCollapsed(false)}
      >
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => setHistoryCollapsed(false)}
              className="flex h-20 w-full flex-col items-center justify-center gap-2 text-slate-500 transition-colors hover:bg-sky-50 hover:text-primary"
              title="展开问答记录"
              aria-label="展开问答记录"
            >
              <History className="h-5 w-5" />
              {history.length > 0 && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {history.length}
                </span>
              )}
            </button>
          </div>
        </section>

        {!historyCollapsed && (
          <div className="absolute left-full top-0 z-40 w-[412px] pl-3">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-card text-slate-800 shadow-2xl">
            <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <History className="h-4 w-4 text-primary" />
                问答记录
                <Badge variant="secondary" className="px-2 py-0 text-xs">
                  {history.length}
                </Badge>
              </div>
            </div>

            <div className="border-b bg-white px-3 py-2">
              <div className="flex items-center justify-between rounded-md border border-slate-200 bg-muted/30 px-2.5 py-1.5 text-xs">
                <label className="flex cursor-pointer items-center gap-2 text-slate-500">
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
                {selected.size > 0 ? (
                  <button
                    onClick={deleteSelected}
                    className="flex items-center gap-1 text-destructive transition-colors hover:text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除（{selected.size}）
                  </button>
                ) : history.length > 0 ? (
                  <button
                    onClick={clearAll}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                  >
                    清空
                  </button>
                ) : (
                  <span className="text-muted-foreground">本地自动保存</span>
                )}
              </div>
            </div>

            {history.length === 0 ? (
              <p className="p-5 text-sm leading-6 text-muted-foreground">
                暂无问答记录，提交问题后会像浏览器标签一样出现在这里。
              </p>
            ) : (
              <ul className="max-h-[calc(100vh-250px)] space-y-1 overflow-auto p-2">
                {history.map((rec) => (
                  <li
                    key={rec.id}
                    className={`group flex min-h-14 items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                      activeRecordId === rec.id
                        ? "bg-primary/10 text-slate-900 ring-1 ring-primary/20"
                        : "text-slate-600 hover:bg-sky-50 hover:text-slate-900"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0 accent-primary"
                      checked={selected.has(rec.id)}
                      onChange={() => toggleSelect(rec.id)}
                      aria-label="选择记录"
                    />
                    <button
                      type="button"
                      onClick={() => viewRecord(rec)}
                      className="min-w-0 flex-1 text-left"
                      title={rec.question}
                    >
                      <div className="truncate text-sm">{rec.question}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <span>{formatTime(rec.at)}</span>
                        <span>·</span>
                        <span className="truncate">{rec.userLabel ?? "普通员工"}</span>
                      </div>
                    </button>
                    <Badge
                      variant={rec.response.foundEvidence ? "success" : "warning"}
                      className="shrink-0 px-1.5 py-0 text-[10px]"
                    >
                      {rec.response.foundEvidence ? "答" : "拒"}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => deleteOne(rec.id)}
                      className="shrink-0 rounded-md p-1 text-slate-300 opacity-70 transition-colors hover:bg-red-50 hover:text-destructive group-hover:opacity-100"
                      aria-label="删除该记录"
                      title="删除该记录"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            </div>
          </div>
        )}
      </aside>

      <div className="space-y-5">
        <div className="rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <MapPin className="h-4 w-4 text-primary" />
              当前知识库城市：
            </span>
            <Badge variant="info">{CITY}</Badge>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              项目资料按账号权限过滤
            </span>
            <Badge variant="secondary">{currentUser.name}</Badge>
          </div>
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
                // Enter 直接提问；Shift+Enter 换行；输入法组词时的 Enter 不触发
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  ask(question);
                }
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                仅基于当前账号可访问的知识作答 · 无依据或无权限则拒答（Enter 提交，Shift+Enter 换行）
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

        {response && !loading && (
          <div className="space-y-3">
            <AnswerCard
              response={response}
              selectedCitationId={response.citations[selectedCitationIndex]?.id}
              onSelectCitation={setSelectedCitationIndex}
            />
            {response.feedbackTargetId && (
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="text-xs text-muted-foreground">
                    当前账号：{currentUserLabel}
                    {response.confidenceLabel && (
                      <span className="ml-2">· {response.confidenceLabel}</span>
                    )}
                  </div>
                  {feedbackByTarget[response.feedbackTargetId] ? (
                    <Badge variant="success">已记录反馈</Badge>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => submitFeedback("helpful")}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        有帮助
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => submitFeedback("not_helpful")}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        不准确
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => submitFeedback("need_human")}
                      >
                        <LifeBuoy className="h-3.5 w-3.5" />
                        需人工补充
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <section className="sticky top-24">
          <CitationSourcePanel
            citation={response?.citations[selectedCitationIndex]}
            index={
              response?.citations[selectedCitationIndex]
                ? selectedCitationIndex + 1
                : undefined
            }
          />
        </section>
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
