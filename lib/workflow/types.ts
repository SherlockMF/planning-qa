export type WorkflowTraceKind = "ingestion" | "query";

export type WorkflowTraceStatus =
  | "running"
  | "completed"
  | "blocked"
  | "failed";

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export type WorkflowStepSource = "recorded" | "reconstructed";

export interface WorkflowDecision {
  outcome: string;
  reasonCode?: string;
  explanation?: string;
}

export interface WorkflowStep {
  key: string;
  title: string;
  sequence: number;
  status: WorkflowStepStatus;
  source: WorkflowStepSource;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
  metrics?: Record<string, number | string | boolean>;
  decision?: WorkflowDecision;
  warnings: string[];
  detailRefs?: string[];
}
export interface WorkflowResultSummary {
  foundEvidence?: boolean;
  confidence?: string;
  refusalReason?: string;
  answerPreview?: string;
}

export interface WorkflowTrace {
  id: string;
  kind: WorkflowTraceKind;
  status: WorkflowTraceStatus;
  startedAt: string;
  completedAt?: string;
  actorUserId: string;
  simulatedUserId?: string;
  question?: string;
  documentId?: string;
  relatedDocumentIds: string[];
  ingestionTraceIds: string[];
  steps: WorkflowStep[];
  resultSummary?: WorkflowResultSummary;
  warnings: string[];
}

export type WorkflowTraceEvent =
  | { type: "trace.created"; trace: WorkflowTrace }
  | { type: "step.started"; traceId: string; step: WorkflowStep }
  | { type: "step.completed"; traceId: string; step: WorkflowStep }
  | { type: "step.blocked"; traceId: string; step: WorkflowStep }
  | { type: "step.failed"; traceId: string; step: WorkflowStep }
  | { type: "trace.completed"; trace: WorkflowTrace };

export interface WorkflowStepUpdate {
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
  metrics?: Record<string, number | string | boolean>;
  decision?: WorkflowDecision;
  warnings?: string[];
  detailRefs?: string[];
}
