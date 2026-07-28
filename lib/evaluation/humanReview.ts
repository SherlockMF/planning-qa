// ============================================================================
// 评测保存合并：把自动判分与人工终判分开
// ----------------------------------------------------------------------------
// 前端保存的是整份题库，历史上直接整体覆盖，一旦客户端没带上跑测结果字段，
// 自动分和审计链接就会静默丢失，改分也无从追责。
// 这里以服务端已存结果为底，只允许客户端改题面与人工终判。
// ============================================================================

import type { EvaluationItem } from "../types.ts";
import { deriveEvaluationRunStatus } from "./runStatus.ts";

/** 只能由跑测写入、客户端不得覆盖为空的字段。 */
const RUN_OWNED_KEYS = [
  "workflowTraceId",
  "runStartedAt",
  "runFinishedAt",
  "runErrored",
  "autoJudgeUncertain",
  "autoAnswerScore",
  "autoStatus",
  "systemAnswer",
  // 表格里只读展示；漏传时若被抹掉，质量指标与审计回放都会失真
  "inTop5",
  "citationCorrect",
  "answerDurationMs",
  "tokensUsed",
] as const satisfies readonly (keyof EvaluationItem)[];

export interface MergeEvaluationSaveOptions {
  now?: () => string;
}

export function mergeEvaluationSave(
  existing: EvaluationItem[],
  incoming: EvaluationItem[],
  options: MergeEvaluationSaveOptions = {}
): EvaluationItem[] {
  const now = options.now ?? (() => new Date().toISOString());
  const byId = new Map(existing.map((item) => [item.id, item]));
  return incoming.map((item) => mergeOne(byId.get(item.id), item, now));
}

function mergeOne(
  previous: EvaluationItem | undefined,
  incoming: EvaluationItem,
  now: () => string
): EvaluationItem {
  const merged: EvaluationItem = { ...incoming };

  if (previous) {
    for (const key of RUN_OWNED_KEYS) {
      if (merged[key] === undefined && previous[key] !== undefined) {
        Object.assign(merged, { [key]: previous[key] });
      }
    }
  }

  merged.autoStatus = merged.autoStatus ?? deriveEvaluationRunStatus(merged);

  const hasFinalVerdict =
    merged.finalStatus !== undefined || merged.finalAnswerScore !== undefined;

  if (!hasFinalVerdict) {
    merged.reviewedBy = undefined;
    merged.reviewedAt = undefined;
    merged.reviewReason = undefined;
    merged.status = merged.autoStatus;
    if (merged.autoAnswerScore !== undefined) {
      merged.answerScore = merged.autoAnswerScore;
    }
    return merged;
  }

  const verdictChanged =
    previous?.finalStatus !== merged.finalStatus ||
    previous?.finalAnswerScore !== merged.finalAnswerScore;
  merged.reviewedAt =
    merged.reviewedAt ?? (verdictChanged ? now() : previous?.reviewedAt);
  merged.status = merged.finalStatus ?? merged.autoStatus;
  if (merged.finalAnswerScore !== undefined) {
    merged.answerScore = merged.finalAnswerScore;
  }
  return merged;
}
