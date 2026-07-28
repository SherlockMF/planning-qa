import test from "node:test";
import assert from "node:assert/strict";

import type { Chunk, Document, EvaluationItem, RagTable } from "../lib/types.ts";
import {
  EVALUATOR_VERSION,
  hashCaseSet,
  knowledgeIndexFingerprint,
} from "../lib/evaluation/hash.ts";

function caseItem(patch: Partial<EvaluationItem>): EvaluationItem {
  return {
    id: patch.id ?? "c1",
    question: patch.question ?? "q",
    standardAnswer: patch.standardAnswer ?? "a",
    correctFile: patch.correctFile ?? "f.pdf",
    correctArticle: patch.correctArticle ?? "",
    correctPage: patch.correctPage ?? "",
    shouldRefuse: patch.shouldRefuse ?? false,
    ...patch,
  };
}

function doc(patch: Partial<Document>): Document {
  return {
    id: patch.id ?? "doc-1",
    fileName: patch.fileName ?? "a.pdf",
    city: patch.city ?? "北京",
    fileType: patch.fileType ?? "技术标准",
    enabled: patch.enabled ?? true,
    status: patch.status ?? "indexed",
    createdAt: patch.createdAt ?? "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function chunk(patch: Partial<Chunk> & { id: string; documentId: string }): Chunk {
  const { id, documentId, ...rest } = patch;
  return {
    id,
    documentId,
    fileName: rest.fileName ?? "a.pdf",
    city: rest.city ?? "北京",
    chunkType: rest.chunkType ?? "section",
    content: rest.content ?? "x",
    keywords: rest.keywords ?? [],
    createdAt: rest.createdAt ?? "2026-01-01T00:00:00.000Z",
    ...rest,
  };
}

test("hashCaseSet is stable for same cases regardless of order", () => {
  const a = caseItem({ id: "a", question: "一" });
  const b = caseItem({ id: "b", question: "二" });
  assert.equal(hashCaseSet([a, b]), hashCaseSet([b, a]));
  assert.notEqual(
    hashCaseSet([a, b]),
    hashCaseSet([a, caseItem({ id: "b", question: "二改" })])
  );
});

test("hashCaseSet ignores run result fields", () => {
  const base = caseItem({ id: "a" });
  const withResult = caseItem({
    id: "a",
    answerScore: 2,
    workflowTraceId: "t",
    autoStatus: "PASS",
  });
  assert.equal(hashCaseSet([base]), hashCaseSet([withResult]));
});

test("knowledgeIndexFingerprint changes when indexed corpus changes", () => {
  const docs = [doc({ id: "d1" }), doc({ id: "d2", enabled: false })];
  const chunks: Chunk[] = [
    chunk({ id: "c1", documentId: "d1", content: "hello" }),
  ];
  const tables: RagTable[] = [];

  const fp1 = knowledgeIndexFingerprint({
    documents: docs,
    chunks,
    ragTables: tables,
  });
  const fp2 = knowledgeIndexFingerprint({
    documents: docs,
    chunks: [
      ...chunks,
      chunk({ id: "c2", documentId: "d1", content: "world" }),
    ],
    ragTables: tables,
  });
  const fp3 = knowledgeIndexFingerprint({
    documents: [doc({ id: "d1" }), doc({ id: "d3", fileName: "b.pdf" })],
    chunks,
    ragTables: tables,
  });

  assert.equal(typeof fp1, "string");
  assert.ok(fp1.length >= 16);
  assert.notEqual(fp1, fp2, "chunk count change must alter fingerprint");
  assert.notEqual(fp1, fp3, "document set change must alter fingerprint");
  assert.equal(
    knowledgeIndexFingerprint({ documents: docs, chunks, ragTables: tables }),
    fp1,
    "same corpus must reproduce"
  );
});

test("disabled or non-indexed documents are excluded from fingerprint", () => {
  const chunks: Chunk[] = [
    chunk({ id: "c1", documentId: "d1", content: "x" }),
    chunk({ id: "c2", documentId: "d2", fileName: "b.pdf", content: "y" }),
  ];
  const withDisabled = knowledgeIndexFingerprint({
    documents: [doc({ id: "d1" }), doc({ id: "d2", enabled: false })],
    chunks,
    ragTables: [],
  });
  const onlyIndexed = knowledgeIndexFingerprint({
    documents: [doc({ id: "d1" })],
    chunks: chunks.filter((c) => c.documentId === "d1"),
    ragTables: [],
  });
  assert.equal(withDisabled, onlyIndexed);
});

test("evaluator version constant is non-empty", () => {
  assert.ok(EVALUATOR_VERSION.length > 0);
});
