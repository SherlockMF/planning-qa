import test from "node:test";
import assert from "node:assert/strict";

import { categoryFromFileType } from "../lib/knowledge/categories.ts";
import type { FileType } from "../lib/types.ts";

test("planning institute file types map to enterprise knowledge categories", () => {
  assert.equal(categoryFromFileType("项目资料" as FileType), "项目资料");
  assert.equal(categoryFromFileType("规划法规" as FileType), "规划法规");
  assert.equal(categoryFromFileType("技术标准" as FileType), "技术标准");
  assert.equal(categoryFromFileType("设计指引" as FileType), "设计指引");
  assert.equal(categoryFromFileType("成果要求" as FileType), "成果要求");
  assert.equal(categoryFromFileType("审查报批" as FileType), "流程指引");
  assert.equal(categoryFromFileType("企业制度" as FileType), "企业制度");
  assert.equal(categoryFromFileType("财务与报销" as FileType), "财务与报销");
});
