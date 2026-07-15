import assert from "node:assert/strict";
import test from "node:test";
import type { Block, Document } from "../lib/types.ts";
import { WorkflowTraceRecorder, createWorkflowTrace } from "../lib/workflow/trace.ts";
import {
  recordContentParsing,
  recordUploadRegistration,
} from "../lib/workflow/ingestionTrace.ts";

test("upload registration records file metadata without persisting raw bytes", () => {
  const trace = createWorkflowTrace({
    id: "ingestion-upload",
    kind: "ingestion",
    actorUserId: "user-admin",
    documentId: "doc-1",
  });
  const recorder = new WorkflowTraceRecorder(trace);
  const document = makeDocument();

  recordUploadRegistration(recorder, {
    document,
    fileSize: 971607,
    uploadUserId: "user-admin",
  });

  const step = trace.steps[0];
  assert.equal(step.status, "completed");
  assert.equal(step.metrics?.fileSize, 971607);
  assert.equal(step.outputSummary?.fileName, document.fileName);
  assert.equal("rawBuffer" in (step.outputSummary ?? {}), false);
});

test("content parsing records block and table counts for PDF IR", () => {
  const trace = createWorkflowTrace({
    id: "ingestion-parse",
    kind: "ingestion",
    actorUserId: "user-admin",
    documentId: "doc-1",
  });
  const recorder = new WorkflowTraceRecorder(trace);
  recordUploadRegistration(recorder, {
    document: makeDocument(),
    fileSize: 100,
    uploadUserId: "user-admin",
  });
  const blocks = [
    makeBlock("heading", "第一章"),
    makeBlock("paragraph", "公共服务设施配置要求"),
    makeBlock("table", "设施配置表"),
  ];

  recorder.start("content_parsing", "2026-07-14T10:00:00.000Z");
  recordContentParsing(
    recorder,
    { fileName: "公共服务设施标准.pdf", extractedChars: 18, blocks },
    "2026-07-14T10:00:00.250Z"
  );

  const step = trace.steps[1];
  assert.equal(step.status, "completed");
  assert.equal(step.durationMs, 250);
  assert.equal(step.metrics?.blockCount, 3);
  assert.equal(step.metrics?.tableCount, 1);
  assert.deepEqual(step.outputSummary?.blockTypes, {
    heading: 1,
    paragraph: 1,
    table: 1,
  });
});

function makeDocument(): Document {
  return {
    id: "doc-1",
    fileName: "公共服务设施标准.pdf",
    city: "北京",
    fileType: "技术标准",
    enabled: true,
    status: "pending",
    createdAt: "2026-07-14T09:00:00.000Z",
    permissionLevel: 1,
  };
}

function makeBlock(type: Block["type"], normalizedText: string): Block {
  return {
    type,
    pageStart: 1,
    pageEnd: 1,
    rawText: normalizedText,
    normalizedText,
  };
}
