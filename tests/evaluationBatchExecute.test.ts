import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { EvaluationBatchCaseResult, EvaluationItem } from "../lib/types.ts";
import { FileEvaluationBatchStore } from "../lib/db/evaluationBatches.ts";
import {
  cancelEvaluationBatch,
  createEvaluationBatch,
  executeEvaluationBatch,
} from "../lib/evaluation/batch.ts";

function item(id: string): EvaluationItem {
  return {
    id,
    question: id,
    standardAnswer: "a",
    correctFile: "f.pdf",
    correctArticle: "",
    correctPage: "",
    shouldRefuse: false,
  };
}

function result(
  caseId: string,
  status: EvaluationBatchCaseResult["status"]
): EvaluationBatchCaseResult {
  return {
    caseId,
    status,
    autoAnswerScore: status === "PASS" ? 2 : status === "REVIEW" ? 1 : 0,
  };
}

test("executeEvaluationBatch persists each case and finishes as done", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-batches-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new FileEvaluationBatchStore(
    path.join(dir, "evaluation-batches.json")
  );
  const batch = createEvaluationBatch({
    versionLabel: "v1",
    changeNote: "run",
    items: [item("a"), item("b"), item("c")],
    knowledge: { documents: [], chunks: [], ragTables: [] },
    modelConfigSnapshot: {},
    ragConfigSnapshot: {},
    store,
    newId: () => "batch-exec-1",
  });

  const seenPersists: number[] = [];
  await executeEvaluationBatch(batch.id, {
    store,
    concurrency: 2,
    scoreCase: async (caseItem) => {
      await new Promise((r) => setTimeout(r, 20));
      return result(caseItem.id, "PASS");
    },
    onPersist: (current) => {
      seenPersists.push(current.caseResults.length);
    },
  });

  const done = store.get(batch.id)!;
  assert.equal(done.status, "done");
  assert.equal(done.caseResults.length, 3);
  assert.equal(done.passed, 3);
  assert.equal(done.productPassRate, 1);
  assert.ok(done.startedAt);
  assert.ok(done.finishedAt);
  assert.ok(seenPersists.includes(1) || seenPersists.includes(2));
  assert.ok(seenPersists.at(-1) === 3);
});

test("cancelEvaluationBatch stops further case appends", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-batches-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new FileEvaluationBatchStore(
    path.join(dir, "evaluation-batches.json")
  );
  const batch = createEvaluationBatch({
    versionLabel: "v1",
    changeNote: "cancel",
    items: [item("a"), item("b"), item("c"), item("d")],
    knowledge: { documents: [], chunks: [], ragTables: [] },
    modelConfigSnapshot: {},
    ragConfigSnapshot: {},
    store,
    newId: () => "batch-cancel-1",
  });

  let started = 0;
  const run = executeEvaluationBatch(batch.id, {
    store,
    concurrency: 1,
    scoreCase: async (caseItem) => {
      started += 1;
      if (started === 1) {
        cancelEvaluationBatch(batch.id, store);
      }
      await new Promise((r) => setTimeout(r, 30));
      return result(caseItem.id, "PASS");
    },
  });

  await run;
  const final = store.get(batch.id)!;
  assert.equal(final.status, "cancelled");
  assert.ok(final.caseResults.length < 4);
  assert.ok(final.finishedAt);
});

test("executeEvaluationBatch is not re-entrant for the same id", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-batches-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new FileEvaluationBatchStore(
    path.join(dir, "evaluation-batches.json")
  );
  createEvaluationBatch({
    versionLabel: "v1",
    changeNote: "once",
    items: [item("a")],
    knowledge: { documents: [], chunks: [], ragTables: [] },
    modelConfigSnapshot: {},
    ragConfigSnapshot: {},
    store,
    newId: () => "batch-once-1",
  });

  let calls = 0;
  const scoreCase = async (caseItem: EvaluationItem) => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 40));
    return result(caseItem.id, "PASS");
  };

  const first = executeEvaluationBatch("batch-once-1", {
    store,
    scoreCase,
  });
  const second = executeEvaluationBatch("batch-once-1", {
    store,
    scoreCase,
  });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});
