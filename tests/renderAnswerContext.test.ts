import test from "node:test";
import assert from "node:assert/strict";
import { renderChunkAnswerContext } from "../lib/rag/retrieval/renderAnswerContext.ts";
import type { Chunk } from "../lib/types.ts";

test("indicator answer context keeps important fields beyond the display limit", () => {
  const fields: Record<string, string> = {
    层级: "社区级",
    编号: "1",
    设施名称: "托幼",
    服务范围: "6岁以下",
    "规模性指标.一般规模.办学规模": "8",
    "地上建筑面积(平方米/处)": "3100",
    列7: "3900",
    "用地面积(平方米/处)": "4000",
    列9: "5000",
    "千人指标.地上建筑面积(平方米)": "304-322",
    列11: "383-406",
    "用地面积(平方米)": "15.3-16.7",
    列13: "479-520",
    "生均规模.地上建筑面积(平方米)": "12.2-12.9",
    列15: "15.3-16.3",
    列17: "19.2-20.8",
    服务规模: "0.96万人",
  };

  const text = renderChunkAnswerContext({
    id: "chunk-1",
    documentId: "doc-1",
    fileName: "test.pdf",
    city: "北京",
    chunkType: "indicator",
    objectType: "indicator_item",
    itemName: "托幼",
    tableTitle: "表 — 基础教育类设施配置指标表",
    fields,
    content: "托幼",
    keywords: [],
    createdAt: new Date(0).toISOString(),
  } as Chunk);

  assert.match(text ?? "", /服务规模：0\.96万人/);
});
