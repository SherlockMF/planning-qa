import type {
  AutoIssueType,
  AutoReviewItemStatus,
  AutoReviewMode,
  AutoRuleSignal,
  ModelAutoReviewAssessment,
  RiskLevel,
} from "./types.ts";

export interface AggregateAutoRiskInput {
  mode: AutoReviewMode;
  ruleSignals: AutoRuleSignal[];
  modelAssessment?: ModelAutoReviewAssessment;
}

export interface AggregatedAutoRisk {
  status: AutoReviewItemStatus;
  mode: AutoReviewMode;
  riskScore: number;
  riskLevel: RiskLevel;
  issueTypes: AutoIssueType[];
  summary: string;
}

export function riskLevelForScore(score: number): RiskLevel {
  const clampedScore = clampRiskScore(score);
  if (clampedScore >= 70) return "high";
  if (clampedScore >= 40) return "medium";
  return "low";
}

export function aggregateAutoRisk(input: AggregateAutoRiskInput): AggregatedAutoRisk {
  const ruleRiskScore = Math.max(0, ...input.ruleSignals.map((signal) => signal.riskScore));
  const modelRiskScore = input.modelAssessment?.riskScore ?? 0;
  const riskScore = clampRiskScore(Math.max(ruleRiskScore, modelRiskScore));
  const missingHybridAssessment = input.mode === "hybrid" && !input.modelAssessment;
  const mode = missingHybridAssessment ? "partial" : input.mode;
  const cannotPass = mode === "partial" || mode === "unavailable";
  const status: AutoReviewItemStatus = riskScore >= 40
    ? "suspected_issue"
    : cannotPass
      ? "unavailable"
      : "clean";
  const issueTypes = unique([
    ...input.ruleSignals.map((signal) => signal.issueType),
    ...(input.modelAssessment?.issueTypes ?? []),
  ]);

  return {
    status,
    mode,
    riskScore,
    riskLevel: riskLevelForScore(riskScore),
    issueTypes,
    summary: summarize(status, input),
  };
}

function clampRiskScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

function summarize(status: AutoReviewItemStatus, input: AggregateAutoRiskInput): string {
  if (status === "unavailable") return "自动审核未完整完成，需人工确认";
  if (status === "clean") return "未发现确定性切分风险";
  return input.modelAssessment?.summary
    ?? input.ruleSignals[0]?.summary
    ?? "发现疑似切分风险，待人工确认";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
