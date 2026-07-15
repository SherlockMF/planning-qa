import type {
  AutoIssueType,
  AutoReviewItemResult,
  AutoReviewMode,
} from "./types.ts";

const ISSUE_TYPES: AutoIssueType[] = [
  "reading_order_noise",
  "row_boundary_contamination",
  "column_misalignment",
  "merged_cell_scope_error",
  "missing_content",
  "source_mapping_error",
  "semantic_assignment_error",
  "other",
];

export interface AutoReviewEvalGoldItem {
  auditItemId: string;
  trueStatus: "issue" | "clean";
  severity: "severe" | "non_severe" | "none";
  issueTypes: AutoIssueType[];
  correctSource: {
    pageStart: number;
    pageEnd?: number;
    tableId?: string;
    rowIndex?: number;
  };
}

export interface AutoReviewEvalActual {
  mode: AutoReviewMode;
  items: AutoReviewItemResult[];
}

export interface IssueTypeEvalMetrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
}

export interface AutoReviewEvalMetrics {
  confusion: { tp: number; fp: number; tn: number; fn: number; unavailable: number };
  rawCounts: {
    total: number;
    severe: number;
    severeHighRisk: number;
    clean: number;
    localizedPredictions: number;
    correctLocalizations: number;
    unavailable: number;
  };
  severeRecall: number;
  severeMissRate: number;
  falsePositiveRate: number;
  localizationAccuracy: number;
  unavailableRate: number;
  byIssueType: Record<AutoIssueType, IssueTypeEvalMetrics>;
  meetsPilotGate: boolean;
}

export function computeAutoReviewEval(
  gold: AutoReviewEvalGoldItem[],
  actual: AutoReviewEvalActual,
): AutoReviewEvalMetrics {
  const actualById = new Map(actual.items.map((item) => [item.auditItemId, item]));
  const confusion = { tp: 0, fp: 0, tn: 0, fn: 0, unavailable: 0 };
  let severe = 0;
  let severeHighRisk = 0;
  let clean = 0;
  let localizedPredictions = 0;
  let correctLocalizations = 0;

  for (const expected of gold) {
    const observed = actualById.get(expected.auditItemId);
    if (!observed) throw new Error(`missing_auto_review_result:${expected.auditItemId}`);
    if (expected.trueStatus === "clean") clean += 1;
    if (expected.severity === "severe") severe += 1;
    if (isUnavailable(observed)) {
      confusion.unavailable += 1;
      continue;
    }

    const predictedIssue = observed.status === "suspected_issue";
    if (expected.trueStatus === "issue") {
      if (predictedIssue) confusion.tp += 1;
      else confusion.fn += 1;
    } else {
      if (predictedIssue) confusion.fp += 1;
      else confusion.tn += 1;
    }
    if (expected.severity === "severe") {
      if (predictedIssue && observed.riskScore >= 70) severeHighRisk += 1;
    }
    if (predictedIssue) {
      localizedPredictions += 1;
      if (sourceMatches(expected.correctSource, observed.source)) correctLocalizations += 1;
    }
  }

  const byIssueType = Object.fromEntries(ISSUE_TYPES.map((issueType) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const expected of gold) {
      const observed = actualById.get(expected.auditItemId)!;
      if (isUnavailable(observed)) continue;
      const expectedType = expected.issueTypes.includes(issueType);
      const predictedType = observed.status === "suspected_issue"
        && observed.issueTypes.includes(issueType);
      if (expectedType && predictedType) tp += 1;
      else if (!expectedType && predictedType) fp += 1;
      else if (expectedType) fn += 1;
    }
    return [issueType, {
      tp,
      fp,
      fn,
      precision: ratio(tp, tp + fp, 0),
      recall: ratio(tp, tp + fn, 0),
    }];
  })) as Record<AutoIssueType, IssueTypeEvalMetrics>;

  const severeRecall = ratio(severeHighRisk, severe, 1);
  const severeMissRate = ratio(severe - severeHighRisk, severe, 0);
  const falsePositiveRate = ratio(confusion.fp, clean, 0);
  const localizationAccuracy = ratio(correctLocalizations, localizedPredictions, 1);
  const unavailableRate = ratio(confusion.unavailable, gold.length, 0);
  const meetsPilotGate = actual.mode === "hybrid"
    && severeRecall >= 0.90
    && severeMissRate <= 0.10
    && falsePositiveRate <= 0.15
    && localizationAccuracy >= 0.95
    && unavailableRate <= 0.05;

  return {
    confusion,
    rawCounts: {
      total: gold.length,
      severe,
      severeHighRisk,
      clean,
      localizedPredictions,
      correctLocalizations,
      unavailable: confusion.unavailable,
    },
    severeRecall,
    severeMissRate,
    falsePositiveRate,
    localizationAccuracy,
    unavailableRate,
    byIssueType,
    meetsPilotGate,
  };
}

function isUnavailable(item: AutoReviewItemResult): boolean {
  return item.status === "unavailable" || item.mode === "partial" || item.mode === "unavailable";
}

function sourceMatches(
  expected: AutoReviewEvalGoldItem["correctSource"],
  actual: AutoReviewItemResult["source"],
): boolean {
  return actual.pageStart === expected.pageStart
    && optionalMatches(actual.pageEnd, expected.pageEnd)
    && optionalMatches(actual.tableId, expected.tableId)
    && optionalMatches(actual.rowIndex, expected.rowIndex);
}

function optionalMatches<T>(actual: T | undefined, expected: T | undefined): boolean {
  return expected === undefined || actual === expected;
}

function ratio(numerator: number, denominator: number, emptyValue: number): number {
  return denominator === 0 ? emptyValue : numerator / denominator;
}
