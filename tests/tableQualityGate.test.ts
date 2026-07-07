import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRagTablesFromChunks,
  shouldSuppressHighConfidenceTableSlice,
} from "../lib/rag/ragTable.ts";
import type { Chunk } from "../lib/types.ts";

test("marks low-fidelity cells while building RagTable rows", () => {
  const chunks = [
    chunk("table-full", {
      chunkType: "table_full",
      tableId: "tbl-low",
      tableTitle: "医疗卫生类设施配置要求表",
      tableHeaders: ["配置要求", "设施名称", "详细配置要求"],
      content: "table",
    }),
    chunk("row-low", {
      chunkType: "table_row",
      tableId: "tbl-low",
      tableTitle: "医疗卫生类设施配置要求表",
      tableHeaders: ["配置要求", "设施名称", "详细配置要求"],
      rowKey: "社区卫生服务站",
      fields: {
        配置要求: "指标使用说明",
        设施名称: "社区卫生服务站",
        详细配置要求:
          "分钟步行范围1内.有社区卫生1服5务中心的可不再设置 , 2 1 ,15。建筑面积比例不应低于2. 、 、85%具。",
      },
      content:
        "配置要求：指标使用说明。设施名称：社区卫生服务站。详细配置要求：分钟步行范围1内.有社区卫生1服5务中心的可不再设置 , 2 1 ,15。建筑面积比例不应低于2. 、 、85%具。",
    }),
  ];

  const [table] = buildRagTablesFromChunks(chunks, () => "目标文档");
  const [row] = table.rows;

  assert.equal(row.lowFidelity, true);
  assert.ok(row.extractionWarnings?.includes("noisy_extraction_text"));
  assert.ok(table.warnings.includes("low_fidelity_table"));
  assert.equal(chunks[1].lowFidelity, true);
  assert.ok(chunks[1].extractionWarnings?.includes("noisy_extraction_text"));
});

test("checks RagTable cells even when the retrieval chunk type is code", () => {
  const chunks = [
    chunk("row-code-low", {
      chunkType: "code",
      tableId: "tbl-code-low",
      tableTitle: "用地分类和代码表",
      tableHeaders: ["类别代码", "类别名称", "说明"],
      rowKey: "A1",
      fields: {
        类别代码: "A1",
        类别名称: "居住用地",
        说明: "社区卫生1服5务中心 2 1 ,15。",
      },
      content: "类别代码：A1。类别名称：居住用地。说明：社区卫生1服5务中心 2 1 ,15。",
    }),
  ];

  const [table] = buildRagTablesFromChunks(chunks, () => "目标文档");
  const [row] = table.rows;

  assert.equal(row.lowFidelity, true);
  assert.equal(chunks[0].lowFidelity, true);
  assert.ok(table.warnings.includes("low_fidelity_table"));
});

test("suppresses low-fidelity RagTable rows from high-confidence table slices", () => {
  assert.equal(
    shouldSuppressHighConfidenceTableSlice([
      {
        rowId: "doc-low_tbl-low_row_0",
        tableId: "tbl-low",
        rowIndex: 0,
        rowType: "data",
        rowKey: "社区卫生服务站",
        cells: {
          配置要求: "指标使用说明",
          设施名称: "社区卫生服务站",
          详细配置要求: "社区卫生1服5务中心 2 1 ,15。",
        },
        pageStart: 18,
        pageEnd: 18,
        searchText: "社区卫生1服5务中心 2 1 ,15。",
        lowFidelity: true,
        extractionWarnings: ["noisy_extraction_text"],
      },
    ]),
    true
  );

  assert.equal(
    shouldSuppressHighConfidenceTableSlice([
      {
        rowId: "doc-ok_tbl_row_0",
        tableId: "tbl-ok",
        rowIndex: 0,
        rowType: "data",
        rowKey: "社区卫生服务站",
        cells: {
          设施名称: "社区卫生服务站",
          详细配置要求: "15分钟步行范围内有社区卫生服务中心的可不再设置。",
        },
        pageStart: 18,
        pageEnd: 18,
        searchText: "15分钟步行范围内有社区卫生服务中心的可不再设置。",
      },
    ]),
    false
  );
});

test("suppresses high-confidence table slices when the table is marked low fidelity", () => {
  assert.equal(
    shouldSuppressHighConfidenceTableSlice(
      [
        {
          rowId: "doc-ok_tbl_row_0",
          tableId: "tbl-ok",
          rowIndex: 0,
          rowType: "data",
          rowKey: "社区卫生服务站",
          cells: {
            设施名称: "社区卫生服务站",
            详细配置要求: "15分钟步行范围内有社区卫生服务中心的可不再设置。",
          },
          pageStart: 18,
          pageEnd: 18,
          searchText: "15分钟步行范围内有社区卫生服务中心的可不再设置。",
        },
      ],
      ["low_fidelity_table"]
    ),
    true
  );
});

function chunk(id: string, overrides: Partial<Chunk>): Chunk {
  return {
    id,
    documentId: "doc-test",
    fileName: "目标文档.pdf",
    city: "北京",
    chunkType: "section",
    content: "",
    keywords: [],
    createdAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}
