"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  Database,
  FileText,
  GitBranch,
  History,
  Info,
  Loader2,
  Play,
  Search,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { useKnowledgeUser } from "@/components/KnowledgeUserProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { KNOWLEDGE_ROLES, KNOWLEDGE_USERS } from "@/lib/knowledge/permissions";
import {
  HISTORICAL_RECONSTRUCTION_NOTICE,
  buildWorkflowPhaseGroups,
  buildWorkflowTimeline,
  createWorkflowRequestGate,
  workflowStatusLabel,
  workflowStepDurationLabel,
  workflowStepPresentation,
  workflowStepResultSummary,
  workflowTraceLabel,
  type WorkflowBusinessPhaseId,
  type WorkflowPhaseGroup,
  type WorkflowTimelineItem,
} from "@/lib/workflow/presentation";
import type {
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowTrace,
} from "@/lib/workflow/types";
import { cn } from "@/lib/utils";

type StreamPayload = {
  type: string;
  trace?: WorkflowTrace;
  traceId?: string;
  step?: WorkflowStep;
  response?: unknown;
};

const STATUS_STYLES: Record<WorkflowStepStatus, string> = {
  completed: "border-emerald-500 bg-emerald-500 text-white",
  running:
    "border-sky-500 bg-sky-500 text-white shadow-[0_0_0_4px_rgba(14,165,233,.14)]",
  blocked: "border-amber-500 bg-amber-500 text-white",
  failed: "border-red-500 bg-red-500 text-white",
  skipped: "border-slate-300 bg-slate-100 text-slate-400",
  pending: "border-slate-300 bg-white text-slate-400",
};

const PHASE_STYLES: Record<
  WorkflowBusinessPhaseId,
  { shell: string; eyebrow: string; icon: string; number: string }
> = {
  document: {
    shell: "border-emerald-200/80 bg-emerald-50/35",
    eyebrow: "text-emerald-700",
    icon: "border-emerald-200 bg-emerald-100 text-emerald-700",
    number: "text-emerald-700",
  },
  question: {
    shell: "border-amber-200/80 bg-amber-50/35",
    eyebrow: "text-amber-700",
    icon: "border-amber-200 bg-amber-100 text-amber-700",
    number: "text-amber-700",
  },
  evidence: {
    shell: "border-sky-200/80 bg-sky-50/35",
    eyebrow: "text-sky-700",
    icon: "border-sky-200 bg-sky-100 text-sky-700",
    number: "text-sky-700",
  },
  answer: {
    shell: "border-indigo-200/80 bg-indigo-50/35",
    eyebrow: "text-indigo-700",
    icon: "border-indigo-200 bg-indigo-100 text-indigo-700",
    number: "text-indigo-700",
  },
};

export function WorkflowAuditPanel({
  initialTraceId,
}: {
  /** 来自 /lab/audit?traceId= 深链，例如从评测结果跳转过来。 */
  initialTraceId?: string;
} = {}) {
  const { currentUser } = useKnowledgeUser();
  const [question, setQuestion] = useState(
    "社区卫生服务中心的服务规模是多少？"
  );
  const [simulatedUserId, setSimulatedUserId] = useState(currentUser.id);
  const [history, setHistory] = useState<WorkflowTrace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<WorkflowTrace>();
  const [ingestionTraces, setIngestionTraces] = useState<WorkflowTrace[]>([]);
  const [selectedIngestionTraceId, setSelectedIngestionTraceId] = useState("");
  const [selectedStepKey, setSelectedStepKey] = useState("");
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(
    () => new Set()
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [finalResponse, setFinalResponse] = useState<unknown>();
  const requestGate = useMemo(() => createWorkflowRequestGate(), []);
  const deepLinkOpened = useRef(false);

  useEffect(() => {
    requestGate.invalidate();
    setSimulatedUserId(currentUser.id);
    void refreshHistory(currentUser.id, setHistory, setError);
  }, [currentUser.id, requestGate]);

  useEffect(() => {
    if (!initialTraceId || deepLinkOpened.current) return;
    deepLinkOpened.current = true;
    void selectHistory(initialTraceId);
    // 深链只在首次进入时打开一次，之后交给用户在历史下拉里切换
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTraceId]);

  const queryTrace = selectedTrace?.kind === "query" ? selectedTrace : undefined;
  const displayedIngestion = useMemo(
    () =>
      selectedTrace?.kind === "ingestion" ? [selectedTrace] : ingestionTraces,
    [selectedTrace, ingestionTraces]
  );
  const timeline = useMemo(
    () =>
      buildWorkflowTimeline(
        queryTrace,
        displayedIngestion,
        selectedIngestionTraceId
      ),
    [queryTrace, displayedIngestion, selectedIngestionTraceId]
  );
  const phaseGroups = useMemo(
    () => buildWorkflowPhaseGroups(timeline),
    [timeline]
  );
  const selectedItem =
    timeline.find((item) => itemKey(item) === selectedStepKey) ?? timeline[0];
  const selectedIngestion =
    displayedIngestion.find((trace) => trace.id === selectedIngestionTraceId) ??
    displayedIngestion[0];

  async function fetchTrace(id: string): Promise<WorkflowTrace> {
    const params = new URLSearchParams({ actorUserId: currentUser.id });
    const res = await fetch(
      `/api/workflow-traces/${encodeURIComponent(id)}?${params}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `读取记录失败：${res.status}`);
    return data.trace as WorkflowTrace;
  }

  async function fetchRelatedTraces(trace: WorkflowTrace) {
    if (trace.kind !== "query" || trace.ingestionTraceIds.length === 0) {
      return [];
    }
    return Promise.all(trace.ingestionTraceIds.map(fetchTrace));
  }

  function applyRelatedTraces(
    trace: WorkflowTrace,
    related: WorkflowTrace[]
  ) {
    setIngestionTraces(related);
    setSelectedIngestionTraceId(related[0]?.id ?? "");
    const first = related[0]?.steps[0];
    setSelectedStepKey(
      first
        ? `${related[0].id}:${first.key}`
        : `${trace.id}:${trace.steps[0]?.key ?? ""}`
    );
  }

  async function selectHistory(id: string) {
    if (!id || running) return;
    const requestId = requestGate.begin();
    setError(undefined);
    setFinalResponse(undefined);
    setCollapsedPhases(new Set());
    try {
      const trace = await fetchTrace(id);
      if (!requestGate.isLatest(requestId)) return;
      const related = await fetchRelatedTraces(trace);
      if (!requestGate.isLatest(requestId)) return;
      setSelectedTrace(trace);
      if (trace.kind === "query") {
        applyRelatedTraces(trace, related);
      } else {
        setIngestionTraces([]);
        setSelectedIngestionTraceId(trace.id);
        setSelectedStepKey(`${trace.id}:${trace.steps[0]?.key ?? ""}`);
      }
    } catch (cause) {
      if (requestGate.isLatest(requestId)) setError(messageOf(cause));
    }
  }

  async function runAudit() {
    if (!question.trim() || running) return;
    requestGate.invalidate();
    setRunning(true);
    setError(undefined);
    setFinalResponse(undefined);
    setIngestionTraces([]);
    setSelectedIngestionTraceId("");
    setCollapsedPhases(new Set());
    try {
      const res = await fetch("/api/workflow-traces/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          actorUserId: currentUser.id,
          simulatedUserId,
          city: "北京",
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `执行失败：${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) handleStreamFrame(frame);
        if (done) break;
      }
      if (buffer.trim()) handleStreamFrame(buffer);
      await refreshHistory(currentUser.id, setHistory, setError);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setRunning(false);
    }
  }

  function handleStreamFrame(frame: string) {
    const dataLine = frame
      .split(/\r?\n/)
      .find((line) => line.startsWith("data:"));
    if (!dataLine) return;
    const payload = JSON.parse(dataLine.slice(5).trim()) as StreamPayload;
    if (payload.type === "trace.created" && payload.trace) {
      setSelectedTrace(payload.trace);
      setSelectedStepKey(
        `${payload.trace.id}:${payload.trace.steps[0]?.key ?? ""}`
      );
      return;
    }
    if (payload.step && payload.traceId) {
      setSelectedTrace((current) =>
        current && current.id === payload.traceId
          ? {
              ...current,
              steps: current.steps.map((step) =>
                step.key === payload.step?.key ? payload.step : step
              ),
            }
          : current
      );
      setSelectedStepKey(`${payload.traceId}:${payload.step.key}`);
      return;
    }
    if (payload.type === "trace.completed" && payload.trace) {
      setSelectedTrace(payload.trace);
      setFinalResponse(payload.response);
      const requestId = requestGate.begin();
      void fetchRelatedTraces(payload.trace)
        .then((related) => {
          if (requestGate.isLatest(requestId)) {
            applyRelatedTraces(payload.trace!, related);
          }
        })
        .catch((cause) => {
          if (requestGate.isLatest(requestId)) setError(messageOf(cause));
        });
    }
  }

  function selectDocument(traceId: string) {
    setSelectedIngestionTraceId(traceId);
    const trace = displayedIngestion.find((candidate) => candidate.id === traceId);
    const firstStep = trace?.steps[0];
    if (firstStep) setSelectedStepKey(`${trace.id}:${firstStep.key}`);
  }

  function togglePhase(group: WorkflowPhaseGroup) {
    if (group.requiresAttention) return;
    setCollapsedPhases((current) => {
      const next = new Set(current);
      if (next.has(group.phase.id)) next.delete(group.phase.id);
      else next.add(group.phase.id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-slate-800 bg-slate-950 text-slate-100 shadow-sm">
        <CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_240px_auto] lg:items-end">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
              <GitBranch className="h-3.5 w-3.5" /> 实时工作流审计
            </div>
            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="min-h-[78px] resize-none border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-500"
              placeholder="输入问题，实时查看安全、权限、召回、生成与兜底链路"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-slate-400">模拟提问账号</label>
            <Select
              value={simulatedUserId}
              onChange={(event) => setSimulatedUserId(event.target.value)}
              className="border-slate-700 bg-slate-900 text-slate-100"
            >
              {KNOWLEDGE_USERS.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {KNOWLEDGE_ROLES[user.role].label}
                </option>
              ))}
            </Select>
            <p className="text-[11px] leading-relaxed text-slate-500">
              执行者始终是当前管理员；这里只改变权限过滤的被模拟身份。
            </p>
          </div>
          <Button
            onClick={runAudit}
            disabled={running || !question.trim()}
            className="bg-sky-500 text-slate-950 hover:bg-sky-400"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {running ? "链路执行中" : "运行完整链路"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 rounded-lg border bg-white p-3 md:flex-row md:items-center">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <History className="h-4 w-4 text-slate-400" /> 历史回放
        </div>
        <Select
          value={selectedTrace?.id ?? ""}
          onChange={(event) => void selectHistory(event.target.value)}
          disabled={running}
          className="flex-1"
        >
          <option value="">选择最近的问答或文档处理记录</option>
          {/* 深链打开的记录可能已不在最近 50 条里，补一个选项避免下拉显示为空 */}
          {selectedTrace &&
            !history.some((trace) => trace.id === selectedTrace.id) && (
              <option value={selectedTrace.id}>
                {new Date(selectedTrace.startedAt).toLocaleString("zh-CN")} ·{" "}
                {workflowTraceLabel(selectedTrace)} ·{" "}
                {workflowStatusLabel(selectedTrace.status)}
              </option>
            )}
          {history.map((trace) => (
            <option key={trace.id} value={trace.id}>
              {new Date(trace.startedAt).toLocaleString("zh-CN")} ·{" "}
              {workflowTraceLabel(trace)} · {workflowStatusLabel(trace.status)}
            </option>
          ))}
        </Select>
        <Badge variant="outline" className="self-start md:self-auto">
          {history.length} 条可审计记录
        </Badge>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!selectedTrace ? (
        <EmptyAudit />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.16fr)_minmax(360px,.84fr)]">
          <section className="overflow-hidden rounded-xl border bg-[#fbfcfd] shadow-sm">
            <TraceSummary
              trace={selectedTrace}
              ingestionCount={displayedIngestion.length}
            />
            <div className="max-h-[820px] overflow-y-auto px-3 py-4 md:px-5 md:py-5">
              <WorkflowStages
                groups={phaseGroups}
                collapsedPhases={collapsedPhases}
                onTogglePhase={togglePhase}
                selectedKey={selectedStepKey}
                onSelect={(item) => setSelectedStepKey(itemKey(item))}
                ingestionTraces={displayedIngestion}
                selectedIngestion={selectedIngestion}
                onSelectDocument={selectDocument}
                finalResponse={finalResponse}
                traceResult={selectedTrace.resultSummary}
              />
            </div>
          </section>
          <div className="hidden xl:block">
            <StepInspector
              key={selectedItem ? itemKey(selectedItem) : "empty-inspector"}
              item={selectedItem}
              finalResponse={finalResponse}
              traceResult={selectedTrace.resultSummary}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TraceSummary({
  trace,
  ingestionCount,
}: {
  trace: WorkflowTrace;
  ingestionCount: number;
}) {
  const settled = trace.steps.filter(
    (step) => step.status !== "pending" && step.status !== "running"
  ).length;
  return (
    <div className="border-b bg-white px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                trace.status === "completed"
                  ? "success"
                  : trace.status === "failed"
                    ? "destructive"
                    : "warning"
              }
            >
              {workflowStatusLabel(trace.status)}
            </Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm font-medium text-slate-800">
            {workflowTraceLabel(trace)}
          </p>
        </div>
        <div className="flex gap-5 text-right text-xs text-slate-500">
          <div>
            <strong className="block text-lg text-slate-800">
              {settled}/{trace.steps.length}
            </strong>
            {trace.kind === "query" ? "已处理步骤" : "文档步骤"}
          </div>
          <div>
            <strong className="block text-lg text-slate-800">
              {ingestionCount}
            </strong>
            关联文档
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowStages({
  groups,
  collapsedPhases,
  onTogglePhase,
  selectedKey,
  onSelect,
  ingestionTraces,
  selectedIngestion,
  onSelectDocument,
  finalResponse,
  traceResult,
}: {
  groups: WorkflowPhaseGroup[];
  collapsedPhases: Set<string>;
  onTogglePhase: (group: WorkflowPhaseGroup) => void;
  selectedKey: string;
  onSelect: (item: WorkflowTimelineItem) => void;
  ingestionTraces: WorkflowTrace[];
  selectedIngestion?: WorkflowTrace;
  onSelectDocument: (traceId: string) => void;
  finalResponse: unknown;
  traceResult?: WorkflowTrace["resultSummary"];
}) {
  return (
    <div className="space-y-4">
      {groups.map((group, index) => {
        const isOpen =
          group.requiresAttention || !collapsedPhases.has(group.phase.id);
        return (
          <PhaseCard
            key={group.phase.id}
            group={group}
            number={index + 1}
            open={isOpen}
            onToggle={() => onTogglePhase(group)}
          >
            {group.phase.id === "document" && selectedIngestion && (
              <DocumentContext
                traces={ingestionTraces}
                selected={selectedIngestion}
                onSelect={onSelectDocument}
              />
            )}
            <div className="divide-y divide-slate-200/80 border-t border-slate-200/80">
              {group.items.map((item) => {
                const selected = itemKey(item) === selectedKey;
                return (
                  <div key={itemKey(item)}>
                    <StepRow
                      item={item}
                      selected={selected}
                      onSelect={() => onSelect(item)}
                    />
                    {selected && (
                      <div className="border-t border-sky-100 bg-sky-50/40 p-3 xl:hidden">
                        <StepInspector
                          item={item}
                          finalResponse={finalResponse}
                          traceResult={traceResult}
                          embedded
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </PhaseCard>
        );
      })}
    </div>
  );
}

function PhaseCard({
  group,
  number,
  open,
  onToggle,
  children,
}: {
  group: WorkflowPhaseGroup;
  number: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const style = PHASE_STYLES[group.phase.id];
  const settled = group.items.filter(
    (item) => item.step.status !== "pending" && item.step.status !== "running"
  ).length;
  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border bg-white shadow-[0_10px_30px_rgba(15,23,42,.04)]",
        style.shell,
        group.requiresAttention && "ring-2 ring-amber-300/60"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 bg-white/85 px-4 py-4 text-left transition-colors hover:bg-white md:px-5"
        title={
          group.requiresAttention
            ? "该阶段包含失败或拦截步骤，需要保持展开"
            : open
              ? "收起阶段"
              : "展开阶段"
        }
      >
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
            style.icon
          )}
        >
          <PhaseIcon phase={group.phase.id} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[11px] font-bold uppercase tracking-[0.16em]",
              style.eyebrow
            )}
          >
            阶段 {number}
          </span>
          <span className="mt-0.5 block text-base font-semibold text-slate-900">
            {group.phase.title}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-slate-500">
            {group.phase.subtitle}
          </span>
        </span>
        <span className="hidden text-right sm:block">
          {group.requiresAttention ? (
            <Badge variant="warning">需要关注</Badge>
          ) : (
            <span className={cn("text-sm font-semibold", style.number)}>
              {settled}/{group.items.length}
            </span>
          )}
          <span className="mt-1 block text-[11px] text-slate-400">已处理</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180",
            group.requiresAttention && "text-amber-500"
          )}
        />
      </button>
      {open && children}
    </article>
  );
}

function DocumentContext({
  traces,
  selected,
  onSelect,
}: {
  traces: WorkflowTrace[];
  selected: WorkflowTrace;
  onSelect: (traceId: string) => void;
}) {
  const historical = isHistoricalTrace(selected);
  return (
    <div className="border-t border-slate-200/80 bg-white/65 px-4 py-4 md:px-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="shrink-0 text-xs font-semibold text-slate-600">
          当前查看文档
        </label>
        <Select
          value={selected.id}
          onChange={(event) => onSelect(event.target.value)}
          className="w-full sm:flex-1"
        >
          {traces.map((trace) => (
            <option key={trace.id} value={trace.id}>
              {documentName(trace)} · {isHistoricalTrace(trace) ? "历史回溯" : "真实记录"}
            </option>
          ))}
        </Select>
      </div>
      {historical && (
        <div className="mt-3 flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-relaxed text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">历史回溯（非当时日志）</p>
            <p className="mt-1 text-amber-800">{HISTORICAL_RECONSTRUCTION_NOTICE}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function StepRow({
  item,
  selected,
  onSelect,
}: {
  item: WorkflowTimelineItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const presentation = workflowStepPresentation(item.step.key);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full gap-3 bg-white/75 px-4 py-4 text-left transition-colors hover:bg-white md:px-5",
        selected && "bg-sky-50/90 shadow-[inset_3px_0_0_#0ea5e9] hover:bg-sky-50"
      )}
    >
      <span className="relative mt-0.5 flex h-7 w-7 shrink-0 justify-center">
        <span
          className={cn(
            "relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2",
            STATUS_STYLES[item.step.status]
          )}
        >
          <StatusIcon status={item.step.status} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-slate-900">
            {item.step.title}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              item.step.status === "blocked" || item.step.status === "failed"
                ? "bg-amber-100 text-amber-800"
                : item.step.status === "completed"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
            )}
          >
            {workflowStatusLabel(item.step.status)}
          </span>
          {item.step.source === "reconstructed" && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              历史回溯
            </span>
          )}
        </span>
        <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">
          {presentation.description}
        </span>
        <span
          className={cn(
            "mt-2 block text-xs font-medium leading-relaxed",
            item.step.status === "blocked" || item.step.status === "failed"
              ? "text-amber-800"
              : "text-slate-700"
          )}
        >
          {workflowStepResultSummary(item.step)}
        </span>
      </span>
    </button>
  );
}

function StepInspector({
  item,
  finalResponse,
  traceResult,
  embedded = false,
}: {
  item?: WorkflowTimelineItem;
  finalResponse: unknown;
  traceResult?: WorkflowTrace["resultSummary"];
  embedded?: boolean;
}) {
  if (!item) {
    return (
      <div className="rounded-lg border bg-white p-8 text-sm text-slate-500">
        选择步骤查看详情。
      </div>
    );
  }
  const step = item.step;
  const presentation = workflowStepPresentation(step.key);
  return (
    <aside
      className={cn(
        "overflow-hidden bg-white",
        embedded
          ? "rounded-lg border border-sky-100"
          : "self-start rounded-xl border shadow-sm xl:sticky xl:top-20"
      )}
    >
      <div className="border-b bg-slate-950 px-5 py-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              第 {step.sequence} 步 · {phaseName(presentation.phase)}
            </p>
            <h2 className="mt-1 text-base font-semibold">{step.title}</h2>
          </div>
          <Badge
            variant={
              step.status === "completed"
                ? "success"
                : step.status === "failed"
                  ? "destructive"
                  : step.status === "running"
                    ? "info"
                    : "warning"
            }
          >
            {workflowStatusLabel(step.status)}
          </Badge>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <BusinessExplanation
          icon={<FileText className="h-4 w-4" />}
          title="这一步做什么"
          text={presentation.description}
          tone="slate"
        />
        <BusinessExplanation
          icon={<ShieldCheck className="h-4 w-4" />}
          title="为什么需要这一步"
          text={presentation.purpose}
          tone="sky"
        />
        <BusinessExplanation
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="本次结果怎么看"
          text={workflowStepResultSummary(step)}
          tone={
            step.status === "failed" || step.status === "blocked"
              ? "amber"
              : "emerald"
          }
        />

        {step.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4" /> 需要留意
            </p>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-amber-800">
              {step.warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          </div>
        )}

        <details className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-50/70">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-xs font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
            <Wrench className="h-4 w-4 text-slate-400" />
            技术明细
            <span className="ml-auto text-[11px] font-normal text-slate-400">
              耗时、内部码、指标与脱敏数据
            </span>
            <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 border-t bg-white p-3">
            <DetailGrid step={step} traceId={item.traceId} />
            {step.decision && <JsonSection title="内部决策" value={step.decision} />}
            <JsonSection
              title="输入摘要"
              value={step.inputSummary ?? { note: "该步骤未记录输入摘要" }}
            />
            <JsonSection
              title="输出摘要"
              value={step.outputSummary ?? { note: "该步骤未记录输出摘要" }}
            />
            <JsonSection title="指标" value={step.metrics ?? {}} />
            {step.key === "final_output" && finalResponse != null && (
              <JsonSection title="本次最终响应" value={finalResponse} />
            )}
            {step.key === "final_output" &&
              finalResponse == null &&
              traceResult && (
                <JsonSection title="历史输出摘要" value={traceResult} />
              )}
            <JsonSection title="脱敏后的步骤记录" value={step} />
          </div>
        </details>
      </div>
    </aside>
  );
}

function BusinessExplanation({
  icon,
  title,
  text,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  tone: "slate" | "sky" | "emerald" | "amber";
}) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    sky: "border-sky-100 bg-sky-50 text-sky-800",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return (
    <section className={cn("rounded-lg border p-3", tones[tone])}>
      <p className="flex items-center gap-2 text-xs font-semibold">
        {icon}
        {title}
      </p>
      <p className="mt-2 text-xs leading-6">{text}</p>
    </section>
  );
}

function DetailGrid({ step, traceId }: { step: WorkflowStep; traceId: string }) {
  const items = [
    ["状态", workflowStatusLabel(step.status)],
    ["来源", step.source === "recorded" ? "真实记录" : "历史回溯（非当时日志）"],
    ["耗时", workflowStepDurationLabel(step)],
    ["内部结果码", step.decision?.outcome ?? "未记录"],
    ["记录 ID", traceId],
    ["步骤 Key", step.key],
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-slate-200">
      {items.map(([label, value]) => (
        <div key={label} className="bg-white p-3">
          <p className="text-[11px] text-slate-400">{label}</p>
          <p className="mt-1 break-all text-xs font-medium text-slate-700">
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

function JsonSection({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-slate-600">
        <Database className="h-3.5 w-3.5 text-slate-400" />
        {title}
      </div>
      <pre className="max-h-72 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function EmptyAudit() {
  return (
    <div className="rounded-lg border border-dashed bg-slate-50 px-6 py-16 text-center">
      <GitBranch className="mx-auto h-8 w-8 text-slate-300" />
      <h2 className="mt-3 text-sm font-semibold text-slate-700">
        尚未选择审计链路
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        运行一个问题，或从历史回放中选择已有记录。
      </p>
    </div>
  );
}

function PhaseIcon({ phase }: { phase: WorkflowBusinessPhaseId }) {
  if (phase === "document") return <FileText className="h-5 w-5" />;
  if (phase === "question") return <ShieldCheck className="h-5 w-5" />;
  if (phase === "evidence") return <Search className="h-5 w-5" />;
  return <CheckCircle2 className="h-5 w-5" />;
}

function StatusIcon({ status }: { status: WorkflowStepStatus }) {
  if (status === "completed") return <Check className="h-3.5 w-3.5" />;
  if (status === "running")
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  if (status === "blocked") return <Ban className="h-3.5 w-3.5" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5" />;
  if (status === "pending") return <Clock3 className="h-3.5 w-3.5" />;
  return <CircleDashed className="h-3.5 w-3.5" />;
}

function documentName(trace: WorkflowTrace): string {
  const upload = trace.steps.find((step) => step.key === "upload_registration");
  const fileName = upload?.outputSummary?.fileName;
  return typeof fileName === "string" && fileName.trim()
    ? fileName
    : trace.documentId ?? trace.id;
}

function isHistoricalTrace(trace: WorkflowTrace): boolean {
  return (
    trace.id.startsWith("reconstructed-") ||
    trace.steps.some((step) => step.source === "reconstructed")
  );
}

function phaseName(phase: WorkflowBusinessPhaseId): string {
  if (phase === "document") return "文档准备";
  if (phase === "question") return "问题检查";
  if (phase === "evidence") return "寻找依据";
  return "生成与核验";
}

function itemKey(item: WorkflowTimelineItem): string {
  return `${item.traceId}:${item.step.key}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function refreshHistory(
  actorUserId: string,
  setHistory: (traces: WorkflowTrace[]) => void,
  setError: (error: string | undefined) => void
) {
  try {
    const params = new URLSearchParams({ actorUserId, limit: "50" });
    const res = await fetch(`/api/workflow-traces?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `读取历史失败：${res.status}`);
    setHistory(data.traces as WorkflowTrace[]);
  } catch (error) {
    setError(messageOf(error));
  }
}
