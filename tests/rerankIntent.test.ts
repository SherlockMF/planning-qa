import test from "node:test";
import assert from "node:assert/strict";

import type { Chunk, RetrievedChunk } from "../lib/types.ts";
import { rerank } from "../lib/rag/rerank.ts";

test("rerank prioritizes drawing deliverable evidence over generic indicator rows for drawing questions", () => {
  const noisyIndicator = hit({
    id: "indicator-noise",
    chunkType: "indicator",
    objectType: "indicator_item",
    fileName: "北京市居住公共服务设施配置指标京政发〔2025〕25号.pdf",
    content:
      "列1：说明。综合考虑出生人口变化趋势各年龄组占居住人口比例延续号文的核算标准。",
    rowKey: "说明",
    tableTitle: "基础教育类设施配置指标表",
  });
  const drawingRequirement = hit({
    id: "drawing-requirement",
    chunkType: "deliverable",
    objectType: "drawing_requirement",
    fileName: "全-规划综合实施方案指南2022.12 最终最新.pdf",
    content:
      "规划图纸包括现状分析图纸和规划分析图纸，分为必选和可选，也可根据项目区位条件和自身情况增补其他论证图纸。",
    sectionPath: "规划条件成果要求 / 一、规划图纸内容与要求",
  });

  const ranked = rerank([noisyIndicator, drawingRequirement], {
    question: "片区控规优化项目需要提交哪些图纸和说明文件？",
    keywords: ["图纸", "提交", "说明"],
    city: "北京",
  });

  assert.equal(ranked[0].chunk.id, "drawing-requirement");
});

function hit(patch: Partial<Chunk>): RetrievedChunk {
  const chunk: Chunk = {
    id: "chunk",
    documentId: "doc",
    fileName: "source.pdf",
    city: "北京",
    chunkType: "clause",
    content: "",
    keywords: [],
    createdAt: "2026-07-09T00:00:00.000Z",
    ...patch,
  };

  return {
    chunk,
    keywordScore: 1,
    vectorScore: 0,
    rerankScore: 0,
    source: "keyword",
    matchedKeywords: [],
  };
}
