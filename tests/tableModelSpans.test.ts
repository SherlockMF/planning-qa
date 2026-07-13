import test from "node:test";
import assert from "node:assert/strict";

import { buildTableModelFromMatrix } from "../lib/rag/tableModel.ts";
import { buildRagTablesFromObjects } from "../lib/rag/ragTable.ts";
import { buildStructuredTableObjects } from "../lib/rag/tables/tableObjects.ts";
import type { Block } from "../lib/types.ts";

test("propagates horizontal parent headers across colspan-covered slots", () => {
  const model = buildTableModelFromMatrix(
    [
      ["设施名称", "规模性指标", null, "千人指标", null],
      [null, "建筑面积", "用地面积", "建筑面积", "用地面积"],
      ["社区卫生服务站", "350", "1000", "30", "50"],
    ],
    { tableId: "tbl-span" }
  );

  assert.deepEqual(model.headers, [
    "设施名称",
    "规模性指标-建筑面积",
    "规模性指标-用地面积",
    "千人指标-建筑面积",
    "千人指标-用地面积",
  ]);
  assert.deepEqual(model.rows, [["社区卫生服务站", "350", "1000", "30", "50"]]);
});

test("keeps explicit header paths for propagated colspan headers", () => {
  const model = buildTableModelFromMatrix(
    [
      ["设施名称", "规模性指标", null],
      [null, "建筑面积", "用地面积"],
      ["社区卫生服务站", "350", "1000"],
    ],
    { tableId: "tbl-paths" }
  );

  assert.deepEqual((model as any).headerPaths, [
    ["设施名称"],
    ["规模性指标", "建筑面积"],
    ["规模性指标", "用地面积"],
  ]);
});

test("structured table objects prefer explicit header paths over splitting header text", () => {
  const blocks: Block[] = [
    {
      type: "table",
      pageStart: 1,
      pageEnd: 1,
      rawText: "",
      normalizedText: "",
      table: {
        tableId: "tbl-explicit-path",
        headers: ["A-B", "Value"],
        headerPaths: [["A-B"], ["Value"]],
        rows: [["alpha", "1"]],
        markdown: "",
      },
    },
  ];

  const [table] = buildStructuredTableObjects("doc-test", blocks);

  assert.deepEqual(table.headers[0].path, ["A-B"]);
  assert.equal(table.headers[0].name, "A-B");
});

test("structured table objects keep collapsed display header names while preserving paths", () => {
  const blocks: Block[] = [
    {
      type: "table",
      pageStart: 1,
      pageEnd: 1,
      rawText: "",
      normalizedText: "",
      table: {
        tableId: "tbl-display-name",
        headers: ["设施名称", "服务规模"],
        headerPaths: [["设施名称"], ["规模性指标", "服务规模"]],
        rows: [["社区卫生服务站", "每个街道1处"]],
        markdown: "",
      },
    },
  ];

  const [table] = buildStructuredTableObjects("doc-test", blocks);

  assert.equal(table.headers[1].name, "服务规模");
  assert.deepEqual(table.headers[1].path, ["规模性指标", "服务规模"]);
  assert.equal(table.rows[0].fields["服务规模"], "每个街道1处");
});

test("rag table columns preserve explicit structured header paths", () => {
  const blocks: Block[] = [
    {
      type: "table",
      pageStart: 1,
      pageEnd: 1,
      rawText: "",
      normalizedText: "",
      table: {
        tableId: "tbl-rag-path",
        headers: ["A-B", "Value"],
        headerPaths: [["A-B"], ["Value"]],
        rows: [["alpha", "1"]],
        markdown: "",
      },
    },
  ];
  const objects = buildStructuredTableObjects("doc-test", blocks);
  const [ragTable] = buildRagTablesFromObjects(objects, "doc.pdf");

  assert.deepEqual(ragTable.columns[0].headerPath, ["A-B"]);
});
