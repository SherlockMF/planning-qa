import type {
  WorkflowDecision,
  WorkflowStep,
  WorkflowStepUpdate,
  WorkflowTrace,
  WorkflowTraceEvent,
  WorkflowTraceKind,
} from "./types.ts";

const MAX_STRING_LENGTH = 280;
const MAX_ARRAY_ITEMS = 12;
const REDACTED_KEYS = new Set([
  "embedding",
  "embeddings",
  "vector",
  "vectors",
  "prompt",
  "systemprompt",
  "system_prompt",
]);

const QUERY_STEPS = [
  ["input_safety", "问题输入与安全检测"],
  ["scope_check", "范围判断"],
  ["permission_filter", "权限过滤"],
  ["query_signals", "查询信号提取"],
  ["multi_recall", "三路召回"],
  ["rerank", "融合去重与重排"],
  ["context_expansion", "上下文扩展"],
  ["evidence_gate", "证据闸门"],
  ["conclusion_generation", "结论生成"],
  ["citation_assembly", "表格与引用装配"],
  ["answer_reflection", "答案反思"],
  ["final_output", "兜底与最终输出"],
] as const;

const INGESTION_STEPS = [
  ["upload_registration", "上传与登记"],
  ["content_parsing", "内容解析"],
  ["knowledge_objects", "知识对象生成"],
  ["chunking", "切块"],
  ["embedding", "Embedding"],
  ["persistence", "持久化"],
] as const;

export function sanitizeWorkflowSummary(
  input: Record<string, unknown>
): Record<string, unknown> {
  return sanitizeValue(input, 0) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, depth: number, key?: string): unknown {
  if (key && REDACTED_KEYS.has(key.toLowerCase())) return "[REDACTED]";
  if (depth > 5) return "[MAX_DEPTH]";
  if (typeof value === "string") {
    const redacted = redactSensitiveText(value);
    if (redacted.length <= MAX_STRING_LENGTH) return redacted;
    const omitted = redacted.length - MAX_STRING_LENGTH;
    return `${redacted.slice(0, MAX_STRING_LENGTH)}…[truncated ${omitted} chars]`;
  }
  if (
    value == null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const kept = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      kept.push({ truncatedItems: value.length - MAX_ARRAY_ITEMS });
    }
    return kept;
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        sanitizeValue(child, depth + 1, childKey),
      ])
    );
  }
  return String(value);
}

function redactSensitiveText(value: string): string {
  return value.replace(
    /\b(system[_-]?prompt|prompt|api[_-]?key|authorization|bearer|secret|password|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED]"
  );
}

export function createWorkflowTrace(input: {
  id: string;
  kind: WorkflowTraceKind;
  actorUserId: string;
  simulatedUserId?: string;
  question?: string;
  documentId?: string;
  now?: string;
}): WorkflowTrace {
  const definitions = input.kind === "query" ? QUERY_STEPS : INGESTION_STEPS;
  const steps: WorkflowStep[] = definitions.map(([key, title], index) => ({
    key,
    title,
    sequence: index + 1,
    status: "pending",
    source: "recorded",
    warnings: [],
  }));
  return {
    id: input.id,
    kind: input.kind,
    status: "running",
    startedAt: input.now ?? new Date().toISOString(),
    actorUserId: input.actorUserId,
    simulatedUserId: input.simulatedUserId,
    question:
      input.question == null
        ? undefined
        : (sanitizeValue(input.question, 0) as string),
    documentId: input.documentId,
    relatedDocumentIds: input.documentId ? [input.documentId] : [],
    ingestionTraceIds: [],
    steps,
    warnings: [],
  };
}

export class WorkflowTraceRecorder {
  readonly trace: WorkflowTrace;
  private readonly onEvent?: (event: WorkflowTraceEvent) => void;

  constructor(
    trace: WorkflowTrace,
    onEvent?: (event: WorkflowTraceEvent) => void
  ) {
    this.trace = trace;
    this.onEvent = onEvent;
  }

  start(key: string, at = new Date().toISOString()): WorkflowStep {
    const step = this.getStep(key);
    if (step.status !== "pending") {
      throw new Error(`步骤 ${key} 不能从 ${step.status} 进入 running`);
    }
    step.status = "running";
    step.startedAt = at;
    this.emit({ type: "step.started", traceId: this.trace.id, step });
    return step;
  }

  complete(
    key: string,
    update: WorkflowStepUpdate = {},
    at = new Date().toISOString()
  ): WorkflowStep {
    const step = this.finishStep(key, "completed", update, at);
    this.emit({ type: "step.completed", traceId: this.trace.id, step });
    return step;
  }

  block(
    key: string,
    decision: WorkflowDecision,
    at = new Date().toISOString()
  ): WorkflowStep {
    const step = this.finishStep(key, "blocked", { decision }, at);
    this.skipLaterSteps(step, `blocked_by_${key}`);
    this.trace.status = "blocked";
    this.trace.completedAt = at;
    this.emit({ type: "step.blocked", traceId: this.trace.id, step });
    this.emit({ type: "trace.completed", trace: this.trace });
    return step;
  }

  fail(key: string, error: unknown, at = new Date().toISOString()): WorkflowStep {
    const message = error instanceof Error ? error.message : String(error);
    const step = this.finishStep(
      key,
      "failed",
      {
        decision: {
          outcome: "failed",
          reasonCode: "execution_error",
          explanation: message,
        },
      },
      at
    );
    this.skipLaterSteps(step, `failed_at_${key}`);
    this.trace.status = "failed";
    this.trace.completedAt = at;
    this.emit({ type: "step.failed", traceId: this.trace.id, step });
    this.emit({ type: "trace.completed", trace: this.trace });
    return step;
  }

  finish(at = new Date().toISOString()): WorkflowTrace {
    this.trace.status = "completed";
    this.trace.completedAt = at;
    this.emit({ type: "trace.completed", trace: this.trace });
    return this.trace;
  }

  private getStep(key: string): WorkflowStep {
    const step = this.trace.steps.find((candidate) => candidate.key === key);
    if (!step) throw new Error(`未知工作流步骤：${key}`);
    return step;
  }

  private finishStep(
    key: string,
    status: "completed" | "blocked" | "failed",
    update: WorkflowStepUpdate,
    at: string
  ): WorkflowStep {
    const step = this.getStep(key);
    if (step.status === "pending") step.startedAt = at;
    if (step.status !== "pending" && step.status !== "running") {
      throw new Error(`步骤 ${key} 不能从 ${step.status} 进入 ${status}`);
    }
    step.status = status;
    step.completedAt = at;
    if (step.startedAt) {
      step.durationMs = Math.max(
        0,
        new Date(at).getTime() - new Date(step.startedAt).getTime()
      );
    }
    step.inputSummary = update.inputSummary
      ? sanitizeWorkflowSummary(update.inputSummary)
      : step.inputSummary;
    step.outputSummary = update.outputSummary
      ? sanitizeWorkflowSummary(update.outputSummary)
      : step.outputSummary;
    step.metrics = update.metrics
      ? (sanitizeWorkflowSummary(update.metrics) as WorkflowStep["metrics"])
      : step.metrics;
    step.decision = update.decision
      ? (sanitizeWorkflowSummary(
          update.decision as unknown as Record<string, unknown>
        ) as unknown as WorkflowDecision)
      : step.decision;
    step.warnings = (update.warnings ?? step.warnings).map(
      (warning) => sanitizeValue(warning, 0) as string
    );
    step.detailRefs = update.detailRefs?.map(
      (reference) => sanitizeValue(reference, 0) as string
    );
    return step;
  }

  private skipLaterSteps(step: WorkflowStep, reasonCode: string): void {
    for (const candidate of this.trace.steps) {
      if (
        candidate.sequence <= step.sequence ||
        (candidate.status !== "pending" && candidate.status !== "running")
      ) {
        continue;
      }
      candidate.status = "skipped";
      candidate.decision = {
        outcome: "skipped",
        reasonCode,
        explanation: `前序步骤 ${step.title} 已终止工作流`,
      };
    }
  }

  private emit(event: WorkflowTraceEvent): void {
    try {
      this.onEvent?.(structuredClone(event));
    } catch (error) {
      console.error("[workflow-trace] event callback failed:", error);
    }
  }
}
