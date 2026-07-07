import test from "node:test";
import assert from "node:assert/strict";
import {
  isCitationTable,
  shouldRenderAnswerTextAsTable,
} from "../lib/ui/tableDisplay.ts";

test("answer text with markdown table syntax is still rendered as prose without answerBlocks", () => {
  const conclusion = [
    "该段为模型复述的普通结论。",
    "| 字段 | 内容 |",
    "| --- | --- |",
    "| 说明 | 这里只是引用中的竖线文本 |",
  ].join("\n");

  assert.equal(shouldRenderAnswerTextAsTable(conclusion), false);
});

test("citation table badge depends on chunkType rather than pipe syntax", () => {
  assert.equal(
    isCitationTable({
      chunkType: "clause",
      excerpt: "| 这 | 不是 | 表格依据 |",
    }),
    false
  );
  assert.equal(
    isCitationTable({
      chunkType: "table_row",
      excerpt: "服务规模：0.96万人",
    }),
    true
  );
});

test("citation without chunkType is not guessed as table from text", () => {
  assert.equal(
    isCitationTable({
      excerpt: "第一列\t第二列\t第三列",
    }),
    false
  );
});
