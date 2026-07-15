import type {
  AuditItemSource,
  AutoIssueType,
  AutoReviewRun,
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
  documentId: string;
  trueStatus: "clean" | "issue";
  severity: "severe" | "non_severe" | "none";
  issueTypes: AutoIssueType[];
  correctSourceLocation: Pick<AuditItemSource, "pageStart" | "pageEnd" | "tableId" | "rowIndex">;
}

export interface AutoReviewEvalMetrics {
  runMode: AutoReviewRun["mode"];
  counts: {
    total: number;
    severe: number;
    severeHighRiskDetected: number;
    clean: number;
    locatableTruePositives: number;
    correctlyLocalized: number;
  };
  confusion: { tp: number; fp: number; tn: number; fn: number; unavailable: number };
  severeRecall: number;
  severeMissRate: number;
  falsePositiveRate: number;
  localizationAccuracy: number;
  unavailableRate: number;
  issueTypes: Record<AutoIssueType, { tp: number; fp: number; fn: number }>;
  byDocument: Record<string, { total: number; suspected: number; unavailable: number }>;
  findings: {
    falseNegatives: AutoReviewEvalFinding[];
    falsePositives: AutoReviewEvalFinding[];
    unavailable: AutoReviewEvalFinding[];
  };
  meetsPilotGate: boolean;
}

export interface AutoReviewEvalFinding {
  auditItemId: string;
  documentId: string;
  riskScore?: number;
  issueTypes: AutoIssueType[];
  source?: AuditItemSource;
  reason?: string;
}

export function computeAutoReviewEval(
  gold: AutoReviewEvalGoldItem[],
  actual: AutoReviewRun,
): AutoReviewEvalMetrics {
  const actualById = new Map(actual.items.map((item) => [item.auditItemId, item]));
  const confusion = { tp: 0, fp: 0, tn: 0, fn: 0, unavailable: 0 };
  const issueTypes = Object.fromEntries(ISSUE_TYPES.map((issueType) => [
    issueType,
    { tp: 0, fp: 0, fn: 0 },
  ])) as AutoReviewEvalMetrics["issueTypes"];
  const byDocument: AutoReviewEvalMetrics["byDocument"] = {};
  const findings: AutoReviewEvalMetrics["findings"] = {
    falseNegatives: [],
    falsePositives: [],
    unavailable: [],
  };
  let severeHighRiskDetected = 0;
  let locatableTruePositives = 0;
  let correctlyLocalized = 0;

  for (const expected of gold) {
    const observed = actualById.get(expected.auditItemId);
    const unavailable = !observed
      || observed.status === "unavailable"
      || observed.mode === "partial"
      || observed.mode === "unavailable";
    const predictedIssue = !unavailable && observed.status === "suspected_issue";
    const trueIssue = expected.trueStatus === "issue";

    const documentMetrics = byDocument[expected.documentId]
      ?? { total: 0, suspected: 0, unavailable: 0 };
    documentMetrics.total += 1;
    if (predictedIssue) documentMetrics.suspected += 1;
    if (unavailable) documentMetrics.unavailable += 1;
    byDocument[expected.documentId] = documentMetrics;

    if (unavailable) confusion.unavailable += 1;
    else if (trueIssue && predictedIssue) confusion.tp += 1;
    else if (trueIssue) confusion.fn += 1;
    else if (predictedIssue) confusion.fp += 1;
    else confusion.tn += 1;

    const finding = {
      auditItemId: expected.auditItemId,
      documentId: expected.documentId,
      riskScore: observed?.riskScore,
      issueTypes: observed?.issueTypes ?? [],
      source: observed?.source,
      reason: observed?.unavailableReason,
    };
    if (unavailable) findings.unavailable.push(finding);
    else if (trueIssue && !predictedIssue) findings.falseNegatives.push(finding);
    else if (!trueIssue && predictedIssue) findings.falsePositives.push(finding);

    if (expected.severity === "severe"
      && predictedIssue
      && (observed?.riskScore ?? 0) >= 70) {
      severeHighRiskDetected += 1;
    }

    if (trueIssue && predictedIssue && hasLocation(expected.correctSourceLocation)) {
      locatableTruePositives += 1;
      if (sameLocation(expected.correctSourceLocation, observed!.source)) correctlyLocalized += 1;
    }

    const expectedTypes = new Set(expected.issueTypes);
    const observedTypes = new Set(unavailable ? [] : observed!.issueTypes);
    for (const issueType of ISSUE_TYPES) {
      if (expectedTypes.has(issueType) && observedTypes.has(issueType)) issueTypes[issueType].tp += 1;
      else if (!expectedTypes.has(issueType) && observedTypes.has(issueType)) issueTypes[issueType].fp += 1;
      else if (expectedTypes.has(issueType)) issueTypes[issueType].fn += 1;
    }
  }

  const severe = gold.filter((item) => item.severity === "severe").length;
  const clean = gold.filter((item) => item.trueStatus === "clean").length;
  const severeRecall = rate(severeHighRiskDetected, severe);
  const severeMissRate = rate(severe - severeHighRiskDetected, severe);
  const falsePositiveRate = rate(confusion.fp, clean);
  const localizationAccuracy = rate(correctlyLocalized, locatableTruePositives);
  const unavailableRate = rate(confusion.unavailable, gold.length);
  const meetsPilotGate = actual.mode === "hybrid"
    && severeRecall >= 0.90
    && severeMissRate <= 0.10
    && falsePositiveRate <= 0.15
    && localizationAccuracy >= 0.95
    && unavailableRate <= 0.05;

  return {
    runMode: actual.mode,
    counts: {
      total: gold.length,
      severe,
      severeHighRiskDetected,
      clean,
      locatableTruePositives,
      correctlyLocalized,
    },
    confusion,
    severeRecall,
    severeMissRate,
    falsePositiveRate,
    localizationAccuracy,
    unavailableRate,
    issueTypes,
    byDocument,
    findings,
    meetsPilotGate,
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function hasLocation(location: AutoReviewEvalGoldItem["correctSourceLocation"]): boolean {
  return location.pageStart !== undefined
    || location.pageEnd !== undefined
    || location.tableId !== undefined
    || location.rowIndex !== undefined;
}

function sameLocation(
  expected: AutoReviewEvalGoldItem["correctSourceLocation"],
  actual: AuditItemSource,
): boolean {
  return (["pageStart", "pageEnd", "tableId", "rowIndex"] as const)
    .every((key) => expected[key] === undefined || expected[key] === actual[key]);
}
