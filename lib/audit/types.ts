import type { Block, Chunk, Document, RagTable } from "../types.ts";
import type { KnowledgeObject } from "../rag/objects.ts";

export type AutoReviewItemStatus = "clean" | "suspected_issue" | "unavailable";
export type AutoReviewMode = "hybrid" | "rules_only" | "partial" | "unavailable";
export type RiskLevel = "low" | "medium" | "high";
export type AutoIssueType =
  | "reading_order_noise"
  | "row_boundary_contamination"
  | "column_misalignment"
  | "merged_cell_scope_error"
  | "missing_content"
  | "source_mapping_error"
  | "semantic_assignment_error"
  | "other";
export type HumanItemStatus = "passed" | "issue";
export type HumanReviewStatus = "pending" | "draft" | "passed" | "issues_found";

export interface AuditItemSource {
  pageStart?: number;
  pageEnd?: number;
  blockIds: string[];
  tableId?: string;
  rowIndex?: number;
  ragTableId?: string;
  knowledgeObjectId?: string;
  chunkIds: string[];
}

export interface AuditReviewItem {
  auditItemId: string;
  objectType: string;
  title: string;
  content: string;
  confidence?: number;
  warnings: string[];
  selectedForReview: boolean;
  selectionReason?: "warning" | "low_confidence" | "table_coverage" | "stable_sample";
  source: AuditItemSource;
  tableContext?: {
    headers: string[];
    targetRow: string[];
    previousRow?: string[];
    nextRow?: string[];
  };
}

export interface AutoRuleSignal {
  ruleId: string;
  issueType: AutoIssueType;
  riskScore: number;
  summary: string;
  evidence: string;
}

export interface ModelAutoReviewAssessment {
  status: "clean" | "suspected_issue";
  riskScore: number;
  issueTypes: AutoIssueType[];
  summary: string;
  sourceEvidence: string;
}

export interface AutoReviewItemResult {
  auditItemId: string;
  status: AutoReviewItemStatus;
  mode: AutoReviewMode;
  riskScore: number;
  riskLevel: RiskLevel;
  issueTypes: AutoIssueType[];
  summary: string;
  ruleSignals: AutoRuleSignal[];
  modelAssessment?: ModelAutoReviewAssessment;
  source: AuditItemSource;
  provider?: { name: string; model: string };
  reviewedAt: string;
  unavailableReason?: string;
}

export interface AutoReviewRun {
  runId: string;
  artifactId: string;
  mode: AutoReviewMode;
  provider?: { name: string; model: string };
  startedAt: string;
  finishedAt: string;
  items: AutoReviewItemResult[];
  summary: {
    status: "completed" | "partial" | "unavailable";
    reviewedCount: number;
    suspectedCount: number;
    unavailableCount: number;
  };
}

export interface HumanReviewItem {
  auditItemId: string;
  status: HumanItemStatus;
  issueTypes: AutoIssueType[];
  comment: string;
  reviewedAt: string;
}

export interface HumanReviewRound {
  reviewId: string;
  artifactId: string;
  parentReviewId?: string;
  reviewerUserId?: string;
  status: HumanReviewStatus;
  startedAt?: string;
  updatedAt?: string;
  finalizedAt?: string;
  samplingPlan: { requiredItemIds: string[]; lowRiskSampleItemIds: string[] };
  items: HumanReviewItem[];
}

export interface AuditManifest {
  artifactId: string;
  docId: string;
  documentFileName: string;
  sourceFileSha256: string;
  createdAt: string;
  files: Record<string, { sha256: string }>;
  reviewItems?: AuditReviewItem[];
}

export interface ReviewArtifactSummary {
  artifactId: string;
  docId: string;
  createdAt: string;
  autoReviewMode: AutoReviewMode;
  suspectedCount: number;
  unavailableCount: number;
  latestHumanReviewStatus?: HumanReviewStatus;
}

export interface ProcessDocumentResult {
  chunkCount: number;
  snapshot: {
    blocks: Block[];
    knowledgeObjects: KnowledgeObject[];
    chunks: Chunk[];
    ragTables: RagTable[];
    warnings: string[];
  };
}

export interface CreateReviewArtifactInput {
  artifactId: string;
  document: Document;
  sourceBuffer: Uint8Array;
  processResult: ProcessDocumentResult;
  createdAt: string;
}
