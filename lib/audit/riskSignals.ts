import type { ChunkType } from "../types.ts";
import { classifyEvidenceQuality } from "../rag/evidenceQuality.ts";
import type { AuditReviewItem, AutoRuleSignal } from "./types.ts";

const FIXED_CATEGORY_LABELS = new Set(["指标修改说明", "配置要求", "修改说明", "备注", "说明"]);

export function detectAuditRiskSignals(item: AuditReviewItem): AutoRuleSignal[] {
  const signals: AutoRuleSignal[] = [];
  const combinedText = `${item.title}\n${item.content}`;
  const quality = classifyEvidenceQuality({
    chunkType: qualityChunkType(item),
    text: combinedText,
  });

  if (quality.categories.some((category) =>
    category === "reading_order_noise" ||
    category === "numeric_value_corruption" ||
    category === "table_text_glue"
  )) {
    signals.push({
      ruleId: "evidence_reading_order_noise",
      issueType: "reading_order_noise",
      riskScore: 70,
      summary: "文本存在阅读顺序、数字单位或表格粘连异常",
      evidence: quality.warnings.join(", ") || combinedText.slice(0, 240),
    });
  }

  if (hasDistortedNumericTitle(item.title, item.content)) {
    signals.push({
      ruleId: "distorted_numeric_title",
      issueType: "reading_order_noise",
      riskScore: 70,
      summary: "标题主要由离散数字和标点组成，疑似阅读顺序失真",
      evidence: item.title,
    });
  }

  const adjacentToken = findAdjacentRowToken(item);
  if (adjacentToken) {
    signals.push({
      ruleId: "adjacent_row_value_contamination",
      issueType: "row_boundary_contamination",
      riskScore: 85,
      summary: "解析内容包含目标行没有、但相邻行存在的数值",
      evidence: adjacentToken,
    });
  }

  const duplicatedLabel = findDuplicatedFieldLabel(item);
  if (duplicatedLabel) {
    signals.push({
      ruleId: "duplicated_field_label_in_value",
      issueType: "semantic_assignment_error",
      riskScore: 55,
      summary: "结构化字段名被重复写入字段值",
      evidence: duplicatedLabel,
    });
  }

  if (hasFixedCategoryAssignment(item)) {
    signals.push({
      ruleId: "fixed_category_used_as_item_title",
      issueType: "semantic_assignment_error",
      riskScore: 55,
      summary: "固定类别标签被错误用作设施名称或整行标题",
      evidence: item.title,
    });
  }

  const columnEvidence = findColumnMismatch(item);
  if (columnEvidence) {
    signals.push({
      ruleId: "table_column_count_mismatch",
      issueType: "column_misalignment",
      riskScore: 80,
      summary: "目标行列数与表头不一致或存在非空溢出列",
      evidence: columnEvidence,
    });
  }

  return signals;
}

function qualityChunkType(item: AuditReviewItem): ChunkType | undefined {
  if (item.tableContext || item.objectType.includes("table")) return "table_row";
  if (item.objectType === "indicator_item") return "indicator";
  return undefined;
}

function hasDistortedNumericTitle(title: string, content: string): boolean {
  const compact = title.replace(/\s+/g, "");
  if (!compact || compact.length > 24 || content.trim().length <= compact.length) return false;
  const digits = compact.match(/\d/g)?.length ?? 0;
  const letters = compact.match(/[\p{L}]/gu)?.length ?? 0;
  return digits >= 2 && letters <= 1 && /^[\d\s.,，。、；;:：()（）\-—~～]+$/u.test(compact);
}

function findAdjacentRowToken(item: AuditReviewItem): string | undefined {
  const context = item.tableContext;
  if (!context || !/[：:]/.test(item.content)) return undefined;

  const contentTokens = numericTokens(item.content);
  const targetTokens = new Set(numericTokens(context.targetRow.join(" ")));
  const adjacentTokens = new Set(numericTokens([
    ...(context.previousRow ?? []),
    ...(context.nextRow ?? []),
  ].join(" ")));

  return contentTokens.find((token) => !targetTokens.has(token) && adjacentTokens.has(token));
}

function numericTokens(value: string): string[] {
  return value.match(/\d+(?:\.\d+)?(?:\s*[—–~～至-]\s*\d+(?:\.\d+)?)?/g)
    ?.map((token) => token.replace(/\s+/g, "")) ?? [];
}

function findDuplicatedFieldLabel(item: AuditReviewItem): string | undefined {
  for (const header of item.tableContext?.headers ?? []) {
    const escapedHeader = escapeRegExp(header.trim());
    if (!escapedHeader) continue;
    const pattern = new RegExp(`${escapedHeader}\\s*[：:]\\s*${escapedHeader}`);
    if (pattern.test(item.content)) return header;
  }
  return undefined;
}

function hasFixedCategoryAssignment(item: AuditReviewItem): boolean {
  if (!item.tableContext) return false;

  const title = item.title.trim();
  if (FIXED_CATEGORY_LABELS.has(title)) return true;
  if (title.length >= 120) return true;

  const firstCell = item.tableContext.targetRow[0]?.trim();
  return firstCell !== undefined && FIXED_CATEGORY_LABELS.has(firstCell);
}

function findColumnMismatch(item: AuditReviewItem): string | undefined {
  const context = item.tableContext;
  if (!context || context.targetRow.length === context.headers.length) return undefined;

  const overflow = context.targetRow.slice(context.headers.length).filter((cell) => cell.trim());
  if (context.targetRow.length > context.headers.length && overflow.length === 0) return undefined;
  return `headers=${context.headers.length}, targetRow=${context.targetRow.length}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
