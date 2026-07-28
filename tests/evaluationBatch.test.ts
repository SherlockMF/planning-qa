import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { EvaluationItem } from "../lib/types.ts";
import { FileEvaluationBatchStore } from "../lib/db/evaluationBatches.ts";
import { createEvaluationBatch } from "../lib/evaluation/batch.ts";

function item(patch: Partial<EvaluationItem>): EvaluationItem {
  return {
    id: patch.id ?? "eval-1",
    question: patch.question ?? "问题",
    standardAnswer: patch.standardAnswer ?? "答案",
    correctFile: patch.correctFile ?? "文件.pdf",
    correctArticle: patch.correctArticle ?? "",
    correctPage: patch.correctPage ?? "",
    shouldRefuse: patch.shouldRefuse ?? false,
    answerScore: 2,
    workflowTraceId: "old-trace",
    ...patch,
  };
}

test("createEvaluationBatch freezes input snapshot and fingerprints", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-batches-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new FileEvaluationBatchStore(
    path.join(dir, "evaluation-batches.json")
  );

  const batch = createEvaluationBatch({
    versionLabel: "v1",
    changeNote: "baseline",
    caseIds: ["eval-1", "eval-2"],
    items: [
      item({ id: "eval-1", question: "一" }),
      item({ id: "eval-2", question: "二" }),
      item({ id: "eval-3", question: "三" }),
    ],
    knowledge: {
      documents: [
        {
          id: "doc-1",
          fileName: "a.pdf",
          city: "北京",
          fileType: "技术标准",
          enabled: true,
          status: "indexed",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      chunks: [
        {
          id: "c1",
          documentId: "doc-1",
          fileName: "a.pdf",
          city: "北京",
          chunkType: "section",
          content: "x",
          keywords: [],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      ragTables: [],
    },
    modelConfigSnapshot: { llm: "mock" },
    ragConfigSnapshot: { city: "北京" },
    store,
    now: () => "2026-07-28T06:00:00.000Z",
    newId: () => "batch-1",
  });

  assert.equal(batch.id, "batch-1");
  assert.equal(batch.status, "queued");
  assert.deepEqual(batch.caseIds, ["eval-1", "eval-2"]);
  assert.equal(batch.caseSnapshot.length, 2);
  assert.equal(batch.caseSnapshot[0].workflowTraceId, undefined);
  assert.equal(batch.caseSnapshot[0].answerScore, undefined);
  assert.equal(batch.caseResults.length, 0);
  assert.equal(batch.passed, 0);
  assert.equal(batch.productPassRate, null);
  assert.ok(batch.caseSetHash.length >= 16);
  assert.ok(batch.knowledgeIndexFingerprint.length >= 16);
  assert.equal(batch.modelConfigSnapshot.llm, "mock");
  assert.equal(store.get("batch-1")?.versionLabel, "v1");
});

test("duplicate clientRequestId within 15s returns the same batch", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-batches-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new FileEvaluationBatchStore(
    path.join(dir, "evaluation-batches.json")
  );
  const deps = {
    items: [item({ id: "eval-1" })],
    knowledge: { documents: [], chunks: [], ragTables: [] },
    modelConfigSnapshot: {},
    ragConfigSnapshot: {},
    store,
    now: () => "2026-07-28T06:00:00.000Z",
    newId: () => `batch-${store.list().length + 1}`,
  };

  const first = createEvaluationBatch({
    ...deps,
    versionLabel: "v1",
    changeNote: "first",
    clientRequestId: "req-1",
  });
  const second = createEvaluationBatch({
    ...deps,
    versionLabel: "v1-dup",
    changeNote: "should not create",
    clientRequestId: "req-1",
    now: () => "2026-07-28T06:00:10.000Z",
  });

  assert.equal(first.id, second.id);
  assert.equal(store.list().length, 1);
  assert.equal(second.changeNote, "first");
});

test("duplicate clientRequestId after 15s creates a new batch", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-batches-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new FileEvaluationBatchStore(
    path.join(dir, "evaluation-batches.json")
  );
  let seq = 0;
  const deps = {
    items: [item({ id: "eval-1" })],
    knowledge: { documents: [], chunks: [], ragTables: [] },
    modelConfigSnapshot: {},
    ragConfigSnapshot: {},
    store,
    newId: () => `batch-${++seq}`,
  };

  const first = createEvaluationBatch({
    ...deps,
    versionLabel: "v1",
    changeNote: "first",
    clientRequestId: "req-2",
    now: () => "2026-07-28T06:00:00.000Z",
  });
  const second = createEvaluationBatch({
    ...deps,
    versionLabel: "v2",
    changeNote: "later",
    clientRequestId: "req-2",
    now: () => "2026-07-28T06:00:16.000Z",
  });

  assert.notEqual(first.id, second.id);
  assert.equal(store.list().length, 2);
});

test("createEvaluationBatch skips draft items unless explicitly selected", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-batches-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new FileEvaluationBatchStore(
    path.join(dir, "evaluation-batches.json")
  );
  const batch = createEvaluationBatch({
    versionLabel: "v-draft",
    changeNote: "skip drafts",
    items: [
      item({ id: "live" }),
      item({ id: "draft-1", draft: true, question: "草稿" }),
    ],
    knowledge: { documents: [], chunks: [], ragTables: [] },
    modelConfigSnapshot: {},
    ragConfigSnapshot: {},
    store,
    newId: () => "batch-draft-skip",
  });
  assert.deepEqual(batch.caseIds, ["live"]);

  const forced = createEvaluationBatch({
    versionLabel: "v-draft-forced",
    changeNote: "explicit",
    caseIds: ["draft-1"],
    items: [
      item({ id: "live" }),
      item({ id: "draft-1", draft: true, question: "草稿" }),
    ],
    knowledge: { documents: [], chunks: [], ragTables: [] },
    modelConfigSnapshot: {},
    ragConfigSnapshot: {},
    store,
    newId: () => "batch-draft-forced",
  });
  assert.deepEqual(forced.caseIds, ["draft-1"]);
});
