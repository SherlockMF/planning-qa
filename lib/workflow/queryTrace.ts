import type { ChatResponse, RetrievedChunk } from "../types.ts";
import { WorkflowTraceRecorder } from "./trace.ts";

interface ScopeDecision {
  shouldRefuse: boolean;
  reasonCode?: string;
  reason?: string;
}

export function recordQueryPreflight(
  recorder: WorkflowTraceRecorder,
  input: { question: string; scope: ScopeDecision }
): boolean {
  const question = input.question.trim();
  recorder.start("input_safety");
  if (!question) {
    recorder.block("input_safety", {
      outcome: "blocked",
      reasonCode: "输入为空",
      explanation: "问题为空，未进入检索",
    });
    return false;
  }
  if (input.scope.reasonCode === "提示词注入/越权") {
    recorder.block("input_safety", {
      outcome: "blocked",
      reasonCode: input.scope.reasonCode,
      explanation: input.scope.reason,
    });
    return false;
  }
  recorder.complete("input_safety", {
    inputSummary: { question, questionLength: question.length },
    outputSummary: { safe: true },
    decision: { outcome: "passed" },
  });

  recorder.start("scope_check");
  if (input.scope.shouldRefuse) {
    recorder.block("scope_check", {
      outcome: "blocked",
      reasonCode: input.scope.reasonCode,
      explanation: input.scope.reason,
    });
    return false;
  }
  recorder.complete("scope_check", {
    outputSummary: { inScope: true },
    decision: { outcome: "passed" },
  });
  return true;
}

export function finalizeQueryTrace(
  recorder: WorkflowTraceRecorder,
  response: ChatResponse,
  retrieved: RetrievedChunk[]
): void {
  mapQueryTraceResult(recorder, response, retrieved);
  const documentIds = recorder.trace.relatedDocumentIds;
  recorder.start("final_output");
  recorder.complete("final_output", {
    metrics: {
      citationCount: response.citations.length,
      relatedDocumentCount: documentIds.length,
      foundEvidence: response.foundEvidence,
    },
    outputSummary: {
      confidence: response.confidence,
      confidenceLabel: response.confidenceLabel,
      refusalReason: response.refusalReason,
    },
    decision: {
      outcome: response.foundEvidence ? "answered" : "refused",
      reasonCode: response.refusalReason,
    },
  });
  recorder.finish();
}

export function mapQueryTraceResult(
  recorder: WorkflowTraceRecorder,
  response: ChatResponse,
  retrieved: RetrievedChunk[]
): void {
  const documentIds = new Set<string>();
  for (const citation of response.citations) {
    if (citation.documentId) documentIds.add(citation.documentId);
  }
  for (const result of retrieved) documentIds.add(result.chunk.documentId);

  recorder.trace.relatedDocumentIds = [...documentIds];
  recorder.trace.resultSummary = {
    foundEvidence: response.foundEvidence,
    confidence: response.confidence,
    refusalReason: response.refusalReason,
    answerPreview:
      response.answer.length > 280
        ? `${response.answer.slice(0, 280)}…`
        : response.answer,
  };
}
