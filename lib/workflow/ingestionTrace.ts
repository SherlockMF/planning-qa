import type { Block, Document } from "../types.ts";
import { WorkflowTraceRecorder } from "./trace.ts";

export function recordUploadRegistration(
  recorder: WorkflowTraceRecorder,
  input: { document: Document; fileSize: number; uploadUserId: string },
  at = new Date().toISOString()
): void {
  const step = recorder.trace.steps.find(
    (candidate) => candidate.key === "upload_registration"
  );
  if (step?.status === "pending") recorder.start("upload_registration", at);
  recorder.complete(
    "upload_registration",
    {
      metrics: { fileSize: input.fileSize },
      inputSummary: { uploadUserId: input.uploadUserId },
      outputSummary: {
        documentId: input.document.id,
        fileName: input.document.fileName,
        fileType: input.document.fileType,
        city: input.document.city,
        permissionLevel: input.document.permissionLevel,
        projectId: input.document.projectId,
        status: input.document.status,
      },
      decision: { outcome: "registered" },
    },
    at
  );
}
export function recordContentParsing(
  recorder: WorkflowTraceRecorder,
  input: {
    fileName: string;
    extractedChars: number;
    blocks?: Block[];
    text?: string;
  },
  at = new Date().toISOString()
): void {
  const step = recorder.trace.steps.find(
    (candidate) => candidate.key === "content_parsing"
  );
  if (step?.status === "pending") recorder.start("content_parsing");
  const blockTypes: Record<string, number> = {};
  for (const block of input.blocks ?? []) {
    blockTypes[block.type] = (blockTypes[block.type] ?? 0) + 1;
  }
  recorder.complete(
    "content_parsing",
    {
      metrics: {
        extractedChars: input.extractedChars,
        blockCount: input.blocks?.length ?? 0,
        tableCount: input.blocks?.filter((block) => block.type === "table").length ?? 0,
      },
      inputSummary: { fileName: input.fileName },
      outputSummary: {
        parseMode: input.blocks ? "block_ir" : "plain_text",
        blockTypes,
        textLength: input.text?.length ?? 0,
      },
      decision: { outcome: "parsed" },
    },
    at
  );
}
