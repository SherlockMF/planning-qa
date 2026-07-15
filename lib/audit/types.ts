import type { Block, Chunk, Document, RagTable } from "../types.ts";
import type { KnowledgeObject } from "../rag/objects.ts";

export const REVIEW_ISSUE_TYPES = [
  "missing_content",
  "ocr_error",
  "structure_error",
  "table_error",
  "source_location_error",
  "object_type_error",
  "other",
] as const;

export type ReviewIssueType = (typeof REVIEW_ISSUE_TYPES)[number];
export type ReviewItemStatus = "passed" | "issue";
export type ReviewStatus = "pending" | "draft" | "passed" | "issues_found";

export interface AuditPipelineSnapshot {
  blocks: Block[];
  knowledgeObjects: KnowledgeObject[];
  chunks: Chunk[];
  ragTables: RagTable[];
  warnings: string[];
}

export interface AuditManifestItem {
  auditItemId: string;
  objectType: string;
  title: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
  sourceBlockIds: string[];
  sourceTableId?: string;
  sourceRowIndex?: number;
  knowledgeObjectId: string;
  chunkIds: string[];
  ragTableId?: string;
  confidence: number;
  warnings: string[];
  contentSha256: string;
  selectedForReview: boolean;
  selectionReason?: string;
}

export interface AuditSourceItem extends AuditManifestItem {
  content: string;
  sourceExcerpt?: string;
  tableMarkdown?: string;
}

export interface AuditManifest {
  schemaVersion: 1;
  artifactId: string;
  generatedAt: string;
  document: {
    id: string;
    fileName: string;
    sourceFileSha256: string;
  };
  pipeline: {
    dataSchemaVersion: string;
    embeddingSignature: string;
  };
  summary: {
    blockCount: number;
    knowledgeObjectCount: number;
    chunkCount: number;
    ragTableCount: number;
    warningCount: number;
    focusItemCount: number;
    selectionWarnings: string[];
  };
  items: AuditManifestItem[];
  files: {
    reviewMdSha256: string;
    reviewHtmlSha256: string;
  };
}

export interface ReviewResultItem {
  auditItemId: string;
  status: ReviewItemStatus;
  issueTypes: ReviewIssueType[];
  comment: string;
}

export interface ReviewResult {
  schemaVersion: 1;
  artifactId: string;
  reviewerUserId?: string;
  status: ReviewStatus;
  startedAt?: string;
  updatedAt?: string;
  finalizedAt?: string;
  items: ReviewResultItem[];
}

export interface ReviewArtifactSummary {
  documentId: string;
  artifactId: string;
  generatedAt: string;
  status: ReviewStatus;
  reviewerUserId?: string;
  finalizedAt?: string;
  focusItemCount: number;
  issueCount: number;
}

export type AuditArtifactCreationResult =
  | { status: "created"; artifactId: string; generatedAt: string }
  | { status: "failed"; error: string };

export interface ProcessDocumentResult {
  chunkCount: number;
  auditSnapshot: AuditPipelineSnapshot;
}

export interface CreateReviewArtifactInput {
  document: Document;
  sourceBuffer: Buffer;
  snapshot: AuditPipelineSnapshot;
  now?: Date;
  artifactId?: string;
  rootDir?: string;
}

export interface FocusSelectionResult {
  items: AuditSourceItem[];
  selectionWarnings: string[];
}
