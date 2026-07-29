import test from "node:test";
import assert from "node:assert/strict";

import { buildTableModelFromMatrix } from "../lib/rag/tableModel.ts";

test("matrix builder preserves visual newlines inside data cells", () => {
  const model = buildTableModelFromMatrix(
    [
      ["设施名称", "一般规模-建筑面积"],
      ["机构养老设施", "50-100 床\n2000-4000\n100-500 床\n4000-15000"],
    ],
    { tableId: "t1", title: "表 — 社会福利类设施配置指标表" }
  );

  assert.match(model.rows[0][1], /\n/);
  assert.match(model.rows[0][1], /50-100 床/);
  assert.match(model.rows[0][1], /2000-4000/);
});
