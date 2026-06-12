import assert from "node:assert/strict";
import test from "node:test";
import {
  EVALUATION_EXPORT_HEADERS,
  evaluationItemToRow,
  evaluationItemsToSheetRows,
  defaultEvaluationExportFilename,
} from "../lib/evaluation/exportResults.ts";
import type { EvaluationItem } from "../lib/types.ts";

const SAMPLE: EvaluationItem = {
  id: "eval-1",
  seq: "1",
  question: "二类居住用地是什么？",
  standardAnswer: "以多中高层住宅为主的用地",
  correctFile: "用地分类.pdf",
  correctArticle: "3.2",
  correctPage: "18",
  shouldRefuse: false,
  systemAnswer: "【结论】R2 指…",
  inTop5: true,
  citationCorrect: true,
  answerScore: 2,
  answerDurationMs: 850,
  tokensUsed: 1234,
  errorReason: "",
};

test("export headers match table columns", () => {
  assert.equal(EVALUATION_EXPORT_HEADERS.length, 15);
  assert.equal(EVALUATION_EXPORT_HEADERS[0], "序号");
  assert.equal(EVALUATION_EXPORT_HEADERS[14], "系统回答");
});

test("evaluationItemToRow formats booleans scores and metrics", () => {
  const row = evaluationItemToRow(SAMPLE, 0);
  assert.equal(row[0], "1");
  assert.equal(row[6], "否");
  assert.equal(row[7], "是");
  assert.equal(row[10], "2");
  assert.equal(row[11], "850ms");
  assert.equal(row[12], "1234");
  assert.equal(row[14], "【结论】R2 指…");
});

test("evaluationItemsToSheetRows includes header row", () => {
  const rows = evaluationItemsToSheetRows([SAMPLE]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], [...EVALUATION_EXPORT_HEADERS]);
});

test("defaultEvaluationExportFilename ends with xlsx", () => {
  assert.match(defaultEvaluationExportFilename(), /^测评结果-\d{8}-\d{4}\.xlsx$/);
});
