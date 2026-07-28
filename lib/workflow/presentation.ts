import type {
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowTrace,
} from "./types.ts";

export type WorkflowBusinessPhaseId =
  | "document"
  | "question"
  | "evidence"
  | "answer";

export interface WorkflowBusinessPhase {
  id: WorkflowBusinessPhaseId;
  title: string;
  subtitle: string;
  stepKeys: readonly string[];
}

export interface WorkflowStepPresentation {
  phase: WorkflowBusinessPhaseId;
  description: string;
  purpose: string;
}

export interface WorkflowTimelineItem {
  phase: "ingestion" | "query";
  traceId: string;
  documentId?: string;
  step: WorkflowStep;
}

export interface WorkflowPhaseGroup {
  phase: WorkflowBusinessPhase;
  items: WorkflowTimelineItem[];
  requiresAttention: boolean;
}

export const HISTORICAL_RECONSTRUCTION_NOTICE =
  "该文档在审计功能上线前已存在。以下步骤根据当前保存的文档、切块和表格数据补画，不代表当时真实执行记录；当时耗时、模型配置和告警无法确认。这不是重新处理文档，也不是当时日志。";

export interface WorkflowRequestGate {
  begin: () => number;
  isLatest: (requestId: number) => boolean;
  invalidate: () => void;
}

export function createWorkflowRequestGate(): WorkflowRequestGate {
  let latestRequestId = 0;
  return {
    begin() {
      latestRequestId += 1;
      return latestRequestId;
    },
    isLatest(requestId) {
      return requestId === latestRequestId;
    },
    invalidate() {
      latestRequestId += 1;
    },
  };
}

export const WORKFLOW_PHASES: readonly WorkflowBusinessPhase[] = [
  {
    id: "document",
    title: "文档准备",
    subtitle: "把原始文件变成可检索、可追溯的知识",
    stepKeys: [
      "upload_registration",
      "content_parsing",
      "knowledge_objects",
      "chunking",
      "embedding",
      "persistence",
    ],
  },
  {
    id: "question",
    title: "问题检查",
    subtitle: "先确认问题安全、相关，并且提问者有权查看",
    stepKeys: ["input_safety", "scope_check", "permission_filter"],
  },
  {
    id: "evidence",
    title: "寻找依据",
    subtitle: "从有权限的资料中寻找并筛选可靠证据",
    stepKeys: [
      "query_signals",
      "multi_recall",
      "rerank",
      "context_expansion",
      "evidence_gate",
    ],
  },
  {
    id: "answer",
    title: "生成与核验",
    subtitle: "依据证据形成结论，并检查引用与兜底条件",
    stepKeys: [
      "conclusion_generation",
      "citation_assembly",
      "answer_reflection",
      "final_output",
    ],
  },
] as const;

const STEP_PRESENTATIONS: Record<string, WorkflowStepPresentation> = {
  upload_registration: {
    phase: "document",
    description: "记录文件名称、类型、所属城市和访问权限。",
    purpose: "先建立可追踪的文档身份，后续处理结果才能准确归属并受权限控制。",
  },
  content_parsing: {
    phase: "document",
    description: "读取正文、标题和表格，转换为系统可处理的内容。",
    purpose: "只有先把不同格式的文件转成统一内容，后续识别和检索才有可靠输入。",
  },
  knowledge_objects: {
    phase: "document",
    description: "识别条款、指标、定义、清单和材料要求。",
    purpose: "把普通文本变成带业务含义的知识，便于精确理解问题要找什么。",
  },
  chunking: {
    phase: "document",
    description: "把长文拆成可独立检索的小段，同时保留上下文。",
    purpose: "缩小每次检索的范围，避免整份长文掩盖真正相关的条款或表格。",
  },
  embedding: {
    phase: "document",
    description: "把文字转换为语义特征，用于查找意思相近的内容。",
    purpose: "让系统不仅能匹配相同字词，也能找到表达不同但含义接近的资料。",
  },
  persistence: {
    phase: "document",
    description: "保存处理结果，使文档正式进入知识库。",
    purpose: "确保切块、表格和检索特征可以稳定复用，并保留可审计的文档状态。",
  },
  input_safety: {
    phase: "question",
    description: "检查问题是否包含提示词注入或越权要求。",
    purpose: "阻止提问者绕过既定规则、索取内部提示词或诱导系统泄露受限信息。",
  },
  scope_check: {
    phase: "question",
    description: "确认问题是否属于当前知识库能回答的范围。",
    purpose: "避免系统对知识库没有覆盖的主题给出看似确定但缺乏依据的回答。",
  },
  permission_filter: {
    phase: "question",
    description: "排除当前提问账号无权查看的资料。",
    purpose: "在检索前隔离受限文档，防止答案或引用间接暴露无权查看的内容。",
  },
  query_signals: {
    phase: "evidence",
    description: "识别问题中的关键词、条款号、数值和专业术语。",
    purpose: "把自然语言问题转换为可检索的信号，提高后续查找的准确度。",
  },
  multi_recall: {
    phase: "evidence",
    description: "分别通过精确、关键词和语义方式寻找资料。",
    purpose: "多种查找方式相互补充，降低因用词差异或格式差异漏掉证据的风险。",
  },
  rerank: {
    phase: "evidence",
    description: "合并重复内容，把最相关的证据排到前面。",
    purpose: "减少重复和弱相关内容，让后续生成优先看到最能支持问题的依据。",
  },
  context_expansion: {
    phase: "evidence",
    description: "补充命中条款的标题、上下文和关联表格。",
    purpose: "避免孤立片段被误读，并补齐理解条款条件和表格含义所需的信息。",
  },
  evidence_gate: {
    phase: "evidence",
    description: "判断现有资料是否足以支持明确结论。",
    purpose: "证据不足时及时停止，防止系统仅凭相似内容推测出未经资料支持的答案。",
  },
  conclusion_generation: {
    phase: "answer",
    description: "仅依据通过检查的证据生成回答草稿。",
    purpose: "把找到的证据组织成易读结论，同时限制模型不得脱离资料自由发挥。",
  },
  citation_assembly: {
    phase: "answer",
    description: "为结论匹配来源文件、章节、页码和表格。",
    purpose: "让管理员和最终用户能够回到原文核对结论，而不是只相信模型表述。",
  },
  answer_reflection: {
    phase: "answer",
    description: "检查答案是否完整、是否与证据冲突。",
    purpose: "在输出前发现缺少依据的内容、低质量引用或需要降级提示的风险。",
  },
  final_output: {
    phase: "answer",
    description: "根据检查结果正常回答、降级提示或拒绝回答。",
    purpose: "把前面所有安全和质量判断落实到最终响应，确保风险不会绕过兜底。",
  },
};

const FALLBACK_PRESENTATION: WorkflowStepPresentation = {
  phase: "answer",
  description: "执行工作流中的扩展检查，详细信息请查看技术明细。",
  purpose: "保留新步骤的审计可见性，避免因为展示词典尚未更新而隐藏执行信息。",
};

const STATUS_LABELS: Record<WorkflowStepStatus, string> = {
  pending: "等待中",
  running: "执行中",
  completed: "已完成",
  blocked: "已拦截",
  failed: "失败",
  skipped: "已跳过",
};

export function buildWorkflowTimeline(
  queryTrace: WorkflowTrace | undefined,
  ingestionTraces: WorkflowTrace[],
  selectedIngestionTraceId?: string
): WorkflowTimelineItem[] {
  const selectedIngestion =
    ingestionTraces.find((trace) => trace.id === selectedIngestionTraceId) ??
    ingestionTraces[0];
  const ingestionItems = selectedIngestion
    ? selectedIngestion.steps.map((step) => ({
        phase: "ingestion" as const,
        traceId: selectedIngestion.id,
        documentId: selectedIngestion.documentId,
        step,
      }))
    : [];
  const queryItems = queryTrace
    ? queryTrace.steps.map((step) => ({
        phase: "query" as const,
        traceId: queryTrace.id,
        step,
      }))
    : [];
  return [...ingestionItems, ...queryItems];
}

export function workflowStepPresentation(key: string): WorkflowStepPresentation {
  return STEP_PRESENTATIONS[key] ?? FALLBACK_PRESENTATION;
}

export function buildWorkflowPhaseGroups(
  items: WorkflowTimelineItem[]
): WorkflowPhaseGroup[] {
  return WORKFLOW_PHASES.map((phase) => {
    const phaseItems = items.filter(
      (item) => workflowStepPresentation(item.step.key).phase === phase.id
    );
    return {
      phase,
      items: phaseItems,
      requiresAttention: phaseItems.some(
        (item) => item.step.status === "blocked" || item.step.status === "failed"
      ),
    };
  }).filter((group) => group.items.length > 0);
}

export function workflowStatusLabel(status: WorkflowStepStatus): string {
  return STATUS_LABELS[status];
}

export function workflowStepDurationLabel(step: WorkflowStep): string {
  if (step.source === "reconstructed") return "历史数据无法确认";
  if (step.durationMs != null) return `${formatNumber(step.durationMs)} ms`;
  if (step.status === "pending") return "尚未开始";
  if (step.status === "running") return "正在计时";
  return "未记录";
}

export function workflowStepResultSummary(step: WorkflowStep): string {
  if (step.status === "pending") return "等待前序步骤完成。";
  if (step.status === "running") return "正在执行这一步，请稍候。";
  if (step.status === "blocked") {
    return `已拦截：${step.decision?.explanation ?? step.decision?.reasonCode ?? "未通过业务检查"}`;
  }
  if (step.status === "failed") {
    return `执行失败：${step.decision?.explanation ?? step.decision?.reasonCode ?? "具体原因请查看技术明细"}`;
  }
  if (step.status === "skipped") {
    return step.decision?.explanation ?? "前序步骤已终止，本步骤未执行。";
  }

  const metrics = step.metrics ?? {};
  const output = step.outputSummary ?? {};
  switch (step.key) {
    case "upload_registration":
      return output.fileName
        ? `已登记文档“${String(output.fileName)}”，访问级别为${String(output.permissionLevel ?? "已设置")}。`
        : "文档身份与访问权限已登记。";
    case "content_parsing":
      if (metrics.extractedChars == null && metrics.tableCount == null) {
        return "当前数据只能确认文档已入库，无法确认当时解析的字符和表格数量。";
      }
      if (metrics.extractedChars == null) {
        return `字符数量未记录；已识别 ${numberMetric(metrics.tableCount)} 张表格。`;
      }
      if (metrics.tableCount == null) {
        return `已解析 ${numberMetric(metrics.extractedChars)} 个字符；表格数量未记录。`;
      }
      return `已解析 ${numberMetric(metrics.extractedChars)} 个字符，并识别 ${numberMetric(metrics.tableCount)} 张表格。`;
    case "knowledge_objects":
      if (metrics.objectCount == null) {
        return "知识对象生成已完成，但当前记录未保存对象数量。";
      }
      return `已识别 ${numberMetric(metrics.objectCount)} 个可检索的知识对象。`;
    case "chunking":
      if (metrics.chunkCount == null) {
        return "切块已完成，但当前记录未保存内容片段数量。";
      }
      return `已生成 ${numberMetric(metrics.chunkCount)} 个可独立检索的内容片段。`;
    case "embedding":
      if (metrics.embeddedCount == null) {
        return "语义特征生成已完成，但当前记录未保存处理数量。";
      }
      return `已为 ${numberMetric(metrics.embeddedCount)} 个片段生成语义特征。`;
    case "persistence":
      if (metrics.chunkCount == null || metrics.ragTableCount == null) {
        return "知识库保存已完成，但当前记录未保存片段或表格数量。";
      }
      return `已保存 ${numberMetric(metrics.chunkCount)} 个片段和 ${numberMetric(metrics.ragTableCount)} 张结构化表格。`;
    case "input_safety":
      return "未发现提示词注入或越权指令，问题可以继续处理。";
    case "scope_check":
      return "问题属于当前知识库覆盖范围，可以进入检索。";
    case "permission_filter":
      if (metrics.accessibleCount == null || metrics.deniedCount == null) {
        return "权限过滤已完成，但当前记录未保存候选资料数量。";
      }
      return Number(metrics.deniedCount ?? 0) > 0
        ? `已排除 ${numberMetric(metrics.deniedCount)} 个无权查看的片段，剩余 ${numberMetric(metrics.accessibleCount)} 个可检索片段。`
        : `未发现越权资料，共有 ${numberMetric(metrics.accessibleCount)} 个片段可参与检索。`;
    case "query_signals":
      if (metrics.keywordCount == null || metrics.topK == null) {
        return "查询信号已提取，但当前记录未保存关键词或保留数量。";
      }
      return `已提取 ${numberMetric(metrics.keywordCount)} 个检索关键词，计划保留前 ${numberMetric(metrics.topK)} 条结果。`;
    case "multi_recall":
      if (metrics.mergedCount == null) {
        return "多路检索已完成，但当前记录未保存候选依据数量。";
      }
      return `精确、关键词和语义检索共合并出 ${numberMetric(metrics.mergedCount)} 条候选依据。`;
    case "rerank":
      if (metrics.inputCount == null || metrics.outputCount == null) {
        return "候选依据已完成整理，但当前记录未保存重排前后数量。";
      }
      return `已将 ${numberMetric(metrics.inputCount)} 条候选整理为 ${numberMetric(metrics.outputCount)} 条有序依据。`;
    case "context_expansion":
      if (metrics.expandedCount == null || metrics.contextChars == null) {
        return "依据上下文已补充，但当前记录未保存扩展数量。";
      }
      return `已补齐 ${numberMetric(metrics.expandedCount)} 条依据的上下文，共 ${numberMetric(metrics.contextChars)} 个字符。`;
    case "evidence_gate":
      if (metrics.candidateCount == null) {
        return "证据检查已完成，但当前记录未保存候选依据数量。";
      }
      return `现有 ${numberMetric(metrics.candidateCount)} 条候选依据足以支持继续生成结论。`;
    case "conclusion_generation":
      if (metrics.contextCount == null) {
        return "回答草稿已生成，但当前记录未保存使用的上下文数量。";
      }
      return `已依据 ${numberMetric(metrics.contextCount)} 条上下文生成回答草稿。`;
    case "citation_assembly":
      if (metrics.citationCount == null || metrics.tableSliceCount == null) {
        return "引用装配已完成，但当前记录未保存引用或表格片段数量。";
      }
      return `已装配 ${numberMetric(metrics.citationCount)} 条引用和 ${numberMetric(metrics.tableSliceCount)} 个表格片段。`;
    case "answer_reflection":
      if (
        metrics.wasReplaced == null &&
        metrics.sourceReviewRequired == null
      ) {
        return "答案检查已完成，但当前记录未保存反思结果。";
      }
      return metrics.wasReplaced
        ? "检查发现草稿存在风险，已使用安全兜底内容替换。"
        : metrics.sourceReviewRequired
          ? "答案已完成检查，但引用质量有限，输出时会提示核对原文。"
          : "答案与现有证据一致，未触发替换或降级。";
    case "final_output":
      return step.decision?.outcome === "refused"
        ? `本次未直接回答：${String(output.refusalReason ?? step.decision.reasonCode ?? "证据不足")}`
        : metrics.citationCount == null
          ? "已输出回答，但当前记录未保存引用数量。"
          : `已输出回答，并附带 ${numberMetric(metrics.citationCount)} 条引用。`;
    default:
      return step.decision?.explanation ?? "该步骤已完成，详细结果请查看技术明细。";
  }
}

export function workflowTraceLabel(trace: WorkflowTrace): string {
  if (
    trace.id.startsWith("reconstructed-") ||
    trace.steps.some((step) => step.source === "reconstructed")
  ) {
    return `历史回溯（非当时日志） · ${trace.documentId ?? trace.id}`;
  }
  if (trace.kind === "ingestion") {
    return `文档处理 · ${trace.documentId ?? trace.id}`;
  }
  return trace.question ? `问答 · ${trace.question}` : `问答 · ${trace.id}`;
}

/** 解析 /lab/audit?traceId= 深链参数；重复传参只取第一个。 */
export function parseAuditTraceIdParam(
  value: string | string[] | undefined
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function numberMetric(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? formatNumber(numeric) : "0";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}
