"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileSearch,
  Flag,
  Loader2,
  RotateCcw,
  Save,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";

import type {
  AuditManifest,
  AutoIssueType,
  AutoReviewRun,
  HumanReviewItem,
  HumanReviewRound,
} from "@/lib/audit/types";
import {
  buildReviewSummary,
  defaultReviewFilter,
  filterReviewItems,
  isReviewReadOnly,
  nextProblemItemId,
  sortReviewItems,
  type ReviewFilter,
  type ReviewViewItem,
} from "@/lib/audit/reviewViewModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const FILTERS: Array<{ value: ReviewFilter; label: string }> = [
  { value: "problems", label: "问题" },
  { value: "focus", label: "重点项" },
  { value: "unreviewed", label: "未审核" },
  { value: "all", label: "全部" },
];

const ISSUE_LABELS: Record<AutoIssueType, string> = {
  reading_order_noise: "阅读顺序异常",
  row_boundary_contamination: "跨行污染",
  column_misalignment: "错列",
  merged_cell_scope_error: "合并单元格范围错误",
  missing_content: "内容缺失",
  source_mapping_error: "来源定位错误",
  semantic_assignment_error: "语义归属错误",
  other: "其他",
};

export function AuditReviewWorkbench({
  docId,
  currentUserId,
  currentUserName,
  reviewerNames,
  manifest,
  initialAutoReview,
  initialRounds,
}: {
  docId: string;
  currentUserId: string;
  currentUserName: string;
  reviewerNames: Record<string, string>;
  manifest: AuditManifest;
  initialAutoReview: AutoReviewRun;
  initialRounds: HumanReviewRound[];
}) {
  const [rounds, setRounds] = useState(initialRounds);
  const [round, setRound] = useState(initialRounds.at(-1));
  const [draftItems, setDraftItems] = useState<HumanReviewItem[]>(round?.items ?? []);
  const [filter, setFilter] = useState<ReviewFilter>(() => defaultReviewFilter(initialAutoReview));
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState("");
  const [busy, setBusy] = useState<"save" | "finalize" | "rereview" | null>(null);
  const [message, setMessage] = useState("");
  const [sourceFailed, setSourceFailed] = useState(false);

  const viewItems = useMemo<ReviewViewItem[]>(() => {
    const automaticById = new Map(initialAutoReview.items.map((item) => [item.auditItemId, item]));
    return (manifest.reviewItems ?? []).map((item) => ({ item, automatic: automaticById.get(item.auditItemId) }));
  }, [initialAutoReview.items, manifest.reviewItems]);
  const currentRound = useMemo(
    () => round ? { ...round, items: draftItems } : undefined,
    [draftItems, round],
  );
  const visibleItems = useMemo(() => {
    const filtered = filterReviewItems(viewItems, currentRound, filter).filter((entry) => matchesSearch(entry, draftItems, search));
    return sortReviewItems(filtered);
  }, [currentRound, draftItems, filter, search, viewItems]);
  const active = visibleItems.find(({ item }) => item.auditItemId === activeId) ?? visibleItems[0] ?? viewItems[0];
  const activeHuman = draftItems.find((item) => item.auditItemId === active?.item.auditItemId);
  const readOnly = isReviewReadOnly(round);
  const summary = buildReviewSummary({
    reviewItems: manifest.reviewItems ?? [],
    autoRun: initialAutoReview,
    round: currentRound,
    humanReviewerName: round?.reviewerUserId ? reviewerNames[round.reviewerUserId] ?? round.reviewerUserId : currentUserName,
  });

  function choose(itemId: string) {
    setActiveId(itemId);
    setSourceFailed(false);
  }

  function updateHuman(patch: Partial<HumanReviewItem>) {
    if (!active || readOnly) return;
    const existing: HumanReviewItem = activeHuman ?? {
      auditItemId: active.item.auditItemId,
      status: "passed",
      issueTypes: [],
      comment: "",
      reviewedAt: new Date().toISOString(),
    };
    const updated = { ...existing, ...patch, reviewedAt: new Date().toISOString() };
    setDraftItems((items) => [...items.filter((item) => item.auditItemId !== updated.auditItemId), updated]);
  }

  async function persist(action: "save_draft" | "finalize") {
    if (!round) return;
    setBusy(action === "save_draft" ? "save" : "finalize");
    setMessage("");
    try {
      const response = await fetch(reviewUrl(round.reviewId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, items: draftItems }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "审核保存失败");
      setRound(body.review);
      setRounds((items) => items.map((item) => item.reviewId === body.review.reviewId ? body.review : item));
      setDraftItems(body.review.items);
      setMessage(action === "finalize" ? "人工审核已提交，本轮现为只读。" : "草稿已保存。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function startRereview() {
    if (!round?.finalizedAt) return;
    setBusy("rereview");
    setMessage("");
    try {
      const response = await fetch(reviewsUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentReviewId: round.reviewId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "复审创建失败");
      setRounds((items) => [...items, body.review]);
      setRound(body.review);
      setDraftItems([]);
      setFilter(defaultReviewFilter(initialAutoReview));
      setActiveId("");
      setMessage("已基于同一审核快照发起独立复审，未重新解析文档。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  function jumpToProblem() {
    const itemId = nextProblemItemId(viewItems, currentRound);
    if (!itemId) {
      setMessage("当前没有未审核的自动疑似问题。 ");
      return;
    }
    setFilter("problems");
    choose(itemId);
  }

  function reviewsUrl() {
    return `/api/documents/${docId}/review-artifacts/${manifest.artifactId}/reviews?userId=${encodeURIComponent(currentUserId)}`;
  }
  function reviewUrl(reviewId: string) {
    return `/api/documents/${docId}/review-artifacts/${manifest.artifactId}/reviews/${reviewId}?userId=${encodeURIComponent(currentUserId)}`;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/documents" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />返回文档管理</Link>
          <h1 className="text-xl font-semibold tracking-tight text-slate-800 md:text-2xl">自动审核优先 · 人工抽查工作台</h1>
          <p className="mt-1 text-sm text-muted-foreground">{manifest.documentFileName} · 快照 {formatTime(manifest.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={jumpToProblem}><Flag />跳到问题</Button>
          {readOnly ? (
            <Button onClick={startRereview} disabled={busy !== null}>{busy === "rereview" ? <Loader2 className="animate-spin" /> : <RotateCcw />}发起复审</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => persist("save_draft")} disabled={!round || busy !== null}>{busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}保存草稿</Button>
              <Button onClick={() => persist("finalize")} disabled={!round || busy !== null}>{busy === "finalize" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}提交人工审核</Button>
            </>
          )}
        </div>
      </div>

      <Alert variant="warning">
        <AlertTriangle />
        <AlertTitle>切分修复不在本轮范围</AlertTitle>
        <AlertDescription>本轮只识别切分风险，不修复切分结果；表格仍应按表格结构优化切分。</AlertDescription>
      </Alert>

      <SummaryBoard summary={summary} autoRun={initialAutoReview} round={round} />
      {message && <Alert variant={message.includes("失败") || message.includes("不能") ? "destructive" : "info"}><AlertDescription>{message}</AlertDescription></Alert>}

      <div className="grid min-h-[720px] overflow-hidden rounded-lg border bg-card shadow-sm lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="border-b bg-slate-50/80 lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b p-3">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、类型、页码、表格、备注" />
            <div className="grid grid-cols-4 gap-1 rounded-md bg-slate-200/70 p-1">
              {FILTERS.map((entry) => (
                <button key={entry.value} onClick={() => { setFilter(entry.value); setActiveId(""); }} className={`rounded px-1 py-1.5 text-xs font-medium transition ${filter === entry.value ? "bg-card text-primary shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[640px] overflow-y-auto p-2">
            {visibleItems.length === 0 ? <p className="p-4 text-center text-xs text-muted-foreground">当前筛选下没有审核项</p> : visibleItems.map((entry) => {
              const reviewed = draftItems.some((item) => item.auditItemId === entry.item.auditItemId);
              const selected = active?.item.auditItemId === entry.item.auditItemId;
              return (
                <button key={entry.item.auditItemId} onClick={() => choose(entry.item.auditItemId)} className={`mb-1 w-full rounded-md border p-3 text-left transition ${selected ? "border-primary/40 bg-primary/5 shadow-sm" : "border-transparent hover:border-border hover:bg-card"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <RiskBadge entry={entry} />
                    <span className={`text-[11px] ${reviewed ? "text-emerald-700" : "text-muted-foreground"}`}>{reviewed ? "已人工核对" : "未审核"}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-800">{entry.item.title || "未命名审核项"}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{sourceLabel(entry)}</p>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 bg-slate-100/40 p-3 md:p-5">
          {active ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{active.item.objectType}</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">{active.item.title || "未命名审核项"}</h2>
                </div>
                <span className="text-xs text-muted-foreground">{sourceLabel(active)}</span>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <section className="overflow-hidden rounded-lg border bg-slate-900 shadow-sm">
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-slate-200"><span className="flex items-center gap-1.5"><FileSearch className="h-3.5 w-3.5" />来源原页</span><span>第 {active.item.source.pageStart ?? "?"} 页</span></div>
                  <div className="flex min-h-[420px] items-center justify-center bg-slate-800 p-2">
                    {sourceFailed || !active.item.source.pageStart ? (
                      <div className="max-w-xs text-center text-sm text-amber-200"><ShieldAlert className="mx-auto mb-2 h-7 w-7" />原页加载失败，此项需人工核对并保留在未审核队列。</div>
                    ) : (
                      <div className="relative h-[560px] w-full">
                        <Image
                          fill
                          unoptimized
                          sizes="(min-width: 1280px) 45vw, 90vw"
                          className="object-contain"
                          src={`/api/documents/${docId}/page?n=${active.item.source.pageStart}&dpi=160&userId=${encodeURIComponent(currentUserId)}`}
                          alt={`来源第 ${active.item.source.pageStart} 页`}
                          onError={() => setSourceFailed(true)}
                        />
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-lg border bg-card shadow-sm">
                  <div className="border-b px-4 py-2 text-xs font-medium text-slate-600">当前解析结果</div>
                  <div className="space-y-4 p-4">
                    <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-4 text-xs leading-6 text-slate-100">{active.item.content}</pre>
                    {active.item.tableContext && (
                      <div className="space-y-2 text-xs">
                        <p className="font-medium text-slate-700">表格上下文</p>
                        <TableRow label="表头" cells={active.item.tableContext.headers} />
                        {active.item.tableContext.previousRow && <TableRow label="上一行" cells={active.item.tableContext.previousRow} />}
                        <TableRow label="目标行" cells={active.item.tableContext.targetRow} emphasis />
                        {active.item.tableContext.nextRow && <TableRow label="下一行" cells={active.item.tableContext.nextRow} />}
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <AutomaticEvidence entry={active} autoRun={initialAutoReview} />
                <HumanDecision item={activeHuman} readOnly={readOnly} onChange={updateHuman} />
              </div>
            </div>
          ) : <p className="py-20 text-center text-sm text-muted-foreground">没有可显示的审核项</p>}
        </main>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span>审核轮次 {rounds.length}</span>
          {rounds.length > 0 && (
            <Select
              className="h-8 min-w-64 bg-card text-xs"
              value={round?.reviewId ?? ""}
              onChange={(event) => {
                const selected = rounds.find((entry) => entry.reviewId === event.target.value);
                if (!selected) return;
                setRound(selected);
                setDraftItems(selected.items);
                setActiveId("");
                setFilter(defaultReviewFilter(initialAutoReview));
              }}
            >
              {rounds.map((entry, index) => (
                <option key={entry.reviewId} value={entry.reviewId}>
                  第 {index + 1} 轮 · {entry.finalizedAt ? `已提交 ${formatTime(entry.finalizedAt)}` : "进行中"}
                </option>
              ))}
            </Select>
          )}
          {round?.parentReviewId && <span>复审自 {round.parentReviewId}</span>}
        </div>
        <span className="inline-flex items-center gap-1"><ExternalLink className="h-3.5 w-3.5" />所有已提交轮次保留且不可覆盖</span>
      </div>
    </div>
  );
}

function SummaryBoard({ summary, autoRun, round }: { summary: ReturnType<typeof buildReviewSummary>; autoRun: AutoReviewRun; round?: HumanReviewRound }) {
  return (
    <section className="grid overflow-hidden rounded-lg border bg-card shadow-sm md:grid-cols-2 xl:grid-cols-4">
      <SummaryCell eyebrow="自动审核" value={summary.autoReviewedBy} detail={`${modeLabel(autoRun.mode)} · 审核范围 ${autoRun.summary.reviewedCount} 项 · ${formatTime(autoRun.finishedAt)}`} />
      <SummaryCell eyebrow="人工审核" value={summary.humanReviewer} detail={`${formatTime(round?.startedAt)}${round?.finalizedAt ? ` → ${formatTime(round.finalizedAt)}` : ""}`} />
      <SummaryCell eyebrow="重点项完成" value={`${summary.focusCompleted} / ${summary.focusTotal}`} detail={`自动疑似问题 ${summary.autoSuspectedCount} · 人工确认问题 ${summary.humanConfirmedCount}`} />
      <div className="grid divide-y border-t md:col-span-2 md:grid-cols-2 md:divide-x md:divide-y-0 xl:col-span-1 xl:block xl:border-l xl:border-t-0 xl:divide-x-0 xl:divide-y">
        <Conclusion label="自动审核结论" value={summary.automaticConclusion} />
        <Conclusion label="人工审核结论" value={summary.humanConclusion} />
      </div>
    </section>
  );
}

function SummaryCell({ eyebrow, value, detail }: { eyebrow: string; value: string; detail: string }) {
  return <div className="border-t p-4 first:border-t-0 md:border-l md:border-t-0 md:first:border-l-0"><p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p><p className="mt-2 text-base font-semibold text-slate-900">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function Conclusion({ label, value }: { label: string; value: string }) {
  return <div className="p-3"><p className="text-[10px] font-medium text-muted-foreground">{label}</p><p className="mt-1 text-xs font-semibold text-slate-800">{value}</p></div>;
}

function AutomaticEvidence({ entry, autoRun }: { entry: ReviewViewItem; autoRun: AutoReviewRun }) {
  const automatic = entry.automatic;
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-amber-950">自动审核疑似问题</h3><RiskBadge entry={entry} /></div>
      <p className="mt-1 text-xs text-amber-800">{modeLabel(automatic?.mode ?? autoRun.mode)} · 风险分仅用于抽查排序</p>
      <p className="mt-3 text-sm leading-6 text-slate-800">{automatic?.summary ?? "自动审核未完整完成，需人工核对。"}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">{automatic?.issueTypes.map((type) => <Badge key={type} variant="warning">{ISSUE_LABELS[type]}</Badge>)}</div>
      <div className="mt-4 space-y-2">{automatic?.ruleSignals.map((signal) => <div key={signal.ruleId} className="rounded-md border border-amber-200 bg-card p-3 text-xs"><p className="font-medium text-slate-800">{signal.summary}</p><p className="mt-1 leading-5 text-muted-foreground">{signal.evidence}</p></div>)}</div>
      {automatic?.modelAssessment?.sourceEvidence && <p className="mt-3 rounded-md bg-slate-900 p-3 text-xs leading-5 text-slate-100">模型来源证据：{automatic.modelAssessment.sourceEvidence}</p>}
      <p className="mt-3 text-[11px] text-muted-foreground">{sourceLabel(entry)}</p>
    </section>
  );
}

function HumanDecision({ item, readOnly, onChange }: { item?: HumanReviewItem; readOnly: boolean; onChange: (patch: Partial<HumanReviewItem>) => void }) {
  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50/40 p-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold text-sky-950">人工审核结论</h3>{readOnly && <Badge variant="secondary">已提交 · 只读</Badge>}</div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button type="button" variant={item?.status === "passed" ? "default" : "outline"} disabled={readOnly} onClick={() => onChange({ status: "passed", issueTypes: [], comment: item?.comment ?? "" })}><CheckCircle2 />通过</Button>
        <Button type="button" variant={item?.status === "issue" ? "destructive" : "outline"} disabled={readOnly} onClick={() => onChange({ status: "issue", issueTypes: item?.issueTypes.length ? item.issueTypes : ["other"] })}><AlertTriangle />确认问题</Button>
      </div>
      <label className="mt-4 grid gap-1.5 text-xs font-medium text-slate-700">问题类型
        <Select disabled={readOnly || item?.status !== "issue"} value={item?.issueTypes[0] ?? "other"} onChange={(event) => onChange({ status: "issue", issueTypes: [event.target.value as AutoIssueType] })}>
          {Object.entries(ISSUE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </label>
      <label className="mt-4 grid gap-1.5 text-xs font-medium text-slate-700">人工备注
        <Textarea disabled={readOnly} value={item?.comment ?? ""} placeholder={item?.status === "issue" ? "问题项必须填写核对说明" : "可补充核对依据"} onChange={(event) => onChange({ comment: event.target.value })} />
      </label>
      {readOnly && <div className="mt-4 rounded-md border bg-card p-3 text-xs leading-5"><p><strong>类型：</strong>{item?.issueTypes.map((type) => ISSUE_LABELS[type]).join("、") || "无"}</p><p><strong>备注：</strong>{item?.comment || "无"}</p><p><strong>核对时间：</strong>{formatTime(item?.reviewedAt)}</p></div>}
    </section>
  );
}

function RiskBadge({ entry }: { entry: ReviewViewItem }) {
  const automatic = entry.automatic;
  if (!automatic || automatic.status === "unavailable") return <Badge variant="destructive">自动审核不可用</Badge>;
  if (automatic.status === "clean") return <Badge variant="success">自动未发现问题 · {automatic.riskScore}</Badge>;
  return <Badge variant={automatic.riskLevel === "high" ? "destructive" : "warning"}>{automatic.riskLevel === "high" ? "高风险" : "中风险"} · {automatic.riskScore}</Badge>;
}

function TableRow({ label, cells, emphasis = false }: { label: string; cells: string[]; emphasis?: boolean }) {
  return <div className={`rounded-md border p-2 ${emphasis ? "border-primary/30 bg-primary/5" : "bg-slate-50"}`}><span className="font-medium text-muted-foreground">{label}</span><div className="mt-1 flex flex-wrap gap-1">{cells.map((cell, index) => <span key={`${index}-${cell}`} className="rounded border bg-card px-2 py-1">{cell || "空"}</span>)}</div></div>;
}

function matchesSearch(entry: ReviewViewItem, humanItems: HumanReviewItem[], query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const human = humanItems.find((item) => item.auditItemId === entry.item.auditItemId);
  return [entry.item.title, entry.item.content, entry.item.source.pageStart, entry.item.source.tableId, entry.item.source.rowIndex, ...entry.automatic?.issueTypes ?? [], human?.comment]
    .filter((value) => value !== undefined)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function sourceLabel(entry: ReviewViewItem): string {
  const source = entry.item.source;
  return [`第 ${source.pageStart ?? "?"} 页`, source.tableId ? `表格 ${source.tableId}` : undefined, source.rowIndex !== undefined ? `第 ${source.rowIndex + 1} 行` : undefined].filter(Boolean).join(" · ");
}

function modeLabel(mode: AutoReviewRun["mode"]): string {
  if (mode === "hybrid") return "自动审核：混合 Agent";
  if (mode === "rules_only") return "自动审核：规则模式";
  return "自动审核未完整完成";
}

function formatTime(value?: string): string {
  if (!value) return "未记录";
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
