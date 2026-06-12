import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyHeader,
  parseEvaluationImport,
  parseRowsToEvaluation,
} from "../lib/evaluation/importParser.ts";

test("classifyHeader maps Chinese headers to fields by specificity", () => {
  assert.equal(classifyHeader("序号"), "seq");
  assert.equal(classifyHeader("问题"), "question");
  assert.equal(classifyHeader("标准答案"), "standardAnswer");
  assert.equal(classifyHeader("答案来源"), "correctFile");
  assert.equal(classifyHeader("来源/出处"), "correctFile");
  assert.equal(classifyHeader("答案"), "standardAnswer");
  assert.equal(classifyHeader("备注"), null);
});

test("parses CSV with header row and maps columns", () => {
  const csv = [
    "序号,问题,标准答案,答案来源",
    "1,二类居住用地是什么？,指以多中高层住宅为主的用地,用地分类标准.pdf",
    "2,绿地率不应低于多少？,不应低于30%,技术规定.pdf",
  ].join("\n");
  const res = parseEvaluationImport(csv);
  assert.equal(res.headerDetected, true);
  assert.equal(res.delimiter, "comma");
  assert.equal(res.rows.length, 2);
  assert.deepEqual(res.rows[0], {
    seq: "1",
    question: "二类居住用地是什么？",
    standardAnswer: "指以多中高层住宅为主的用地",
    correctFile: "用地分类标准.pdf",
  });
});

test("recognizes columns regardless of order", () => {
  const csv = [
    "问题,答案来源,标准答案",
    "停车位标准？,停车标准.pdf,每户1个",
  ].join("\n");
  const res = parseEvaluationImport(csv);
  assert.equal(res.headerDetected, true);
  assert.deepEqual(res.rows[0], {
    question: "停车位标准？",
    standardAnswer: "每户1个",
    correctFile: "停车标准.pdf",
  });
});

test("parses tab-separated values", () => {
  const tsv = "问题\t标准答案\t答案来源\n问题A\t答案A\t来源A.pdf";
  const res = parseEvaluationImport(tsv);
  assert.equal(res.delimiter, "tab");
  assert.equal(res.rows[0].question, "问题A");
  assert.equal(res.rows[0].correctFile, "来源A.pdf");
});

test("parses markdown table and skips separator row", () => {
  const md = [
    "| 序号 | 问题 | 标准答案 | 答案来源 |",
    "| --- | --- | --- | --- |",
    "| 1 | 问A | 答A | 源A.pdf |",
  ].join("\n");
  const res = parseEvaluationImport(md);
  assert.equal(res.delimiter, "pipe");
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].seq, "1");
  assert.equal(res.rows[0].question, "问A");
});

test("headerless positional parsing detects leading seq column", () => {
  const csv = ["1,问A,答A,源A.pdf", "2,问B,答B,源B.pdf"].join("\n");
  const res = parseEvaluationImport(csv);
  assert.equal(res.headerDetected, false);
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[1].seq, "2");
  assert.equal(res.rows[1].question, "问B");
});

test("headerless positional parsing without seq column", () => {
  const csv = ["问A,答A,源A.pdf"].join("\n");
  const res = parseEvaluationImport(csv);
  assert.equal(res.headerDetected, false);
  assert.equal(res.rows[0].seq, undefined);
  assert.equal(res.rows[0].question, "问A");
  assert.equal(res.rows[0].standardAnswer, "答A");
  assert.equal(res.rows[0].correctFile, "源A.pdf");
});

test("respects quoted commas in CSV", () => {
  const csv = ['问题,标准答案,答案来源', '"含,逗号的问题","含,逗号的答案",源.pdf'].join(
    "\n"
  );
  const res = parseEvaluationImport(csv);
  assert.equal(res.rows[0].question, "含,逗号的问题");
  assert.equal(res.rows[0].standardAnswer, "含,逗号的答案");
});

test("skips rows with empty question", () => {
  const csv = ["问题,标准答案", "有效问题,答案", ",只有答案"].join("\n");
  const res = parseEvaluationImport(csv);
  assert.equal(res.rows.length, 1);
});

test("parseRowsToEvaluation handles 2D cells (XLSX path) with header", () => {
  const rows = [
    ["序号", "问题", "标准答案", "答案来源"],
    ["1", "问A", "答A", "源A.xlsx"],
    ["2", "问B", "答B", "源B.xlsx"],
  ];
  const res = parseRowsToEvaluation(rows);
  assert.equal(res.delimiter, "xlsx");
  assert.equal(res.headerDetected, true);
  assert.equal(res.rows.length, 2);
  assert.deepEqual(res.rows[1], {
    seq: "2",
    question: "问B",
    standardAnswer: "答B",
    correctFile: "源B.xlsx",
  });
});

test("parseRowsToEvaluation coerces non-string cells and drops blank rows", () => {
  const rows: unknown[][] = [
    ["问题", "标准答案"],
    [123, 45.6],
    ["", ""],
    [null, undefined],
  ];
  const res = parseRowsToEvaluation(rows as string[][]);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].question, "123");
  assert.equal(res.rows[0].standardAnswer, "45.6");
});
