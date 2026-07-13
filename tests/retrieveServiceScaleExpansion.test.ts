import test from "node:test";
import assert from "node:assert/strict";

import type { Chunk, RetrievedChunk } from "../lib/types.ts";
import { expandServiceScaleSiblingRows } from "../lib/rag/retrieval/serviceScaleSiblings.ts";

test("service-scale retrieval expands same-facility sibling rows and skips summary rows", () => {
  const chunks = [
    row("a", "A类", "每个街道1处,大于7万人街道适用", 1),
    row("b", "B类", "每个街道1处,5-7万人(含)街道适用", 2),
    row("c", "C类", "每个街道1处,小于5万人(含)街道适用", 3),
    row("sum", "C类", "每个街道1处,小于5万人(含)街道适用", 4, "小计"),
  ];
  const expanded = expandServiceScaleSiblingRows(
    [hit(chunks[1])],
    chunks,
    "社区卫生服务中心的服务规模是多少？"
  );

  assert.deepEqual(
    expanded.map((item) => item.chunk.id),
    ["b", "a", "c"]
  );
  assert.equal(expanded[1].chunk.fields?.["服务规模"], "每个街道1处,大于7万人街道适用");
  assert.equal(expanded[2].chunk.fields?.["服务规模"], "每个街道1处,小于5万人(含)街道适用");
});

function row(
  id: string,
  category: string,
  serviceScale: string,
  sourceRowIndex: number,
  level = "街道级"
): Chunk {
  return {
    id,
    documentId: "doc",
    fileName: "北京市居住公共服务设施配置指标京政发〔2025〕25号.pdf",
    city: "北京",
    chunkType: "indicator",
    chunkRole: "atomic",
    tableId: "tbl-6",
    rowKey: "社区卫生服务中心",
    sourceTableId: "tbl-6",
    sourceRowIndex,
    fields: {
      层级: level,
      设施名称: "社区卫生服务中心",
      列4: category,
      服务规模: serviceScale,
    },
    content: serviceScale,
    keywords: [],
    createdAt: "2026-07-09T00:00:00.000Z",
  };
}

function hit(chunk: Chunk): RetrievedChunk {
  return {
    chunk,
    keywordScore: 1,
    vectorScore: 0,
    rerankScore: 1,
    source: "keyword",
    matchedKeywords: ["社区卫生服务中心", "服务规模"],
  };
}
