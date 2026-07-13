import test from "node:test";
import assert from "node:assert/strict";

import { buildAnswerDiagnostics } from "../lib/rag/answerDiagnostics.ts";

test("buildAnswerDiagnostics exposes blocked extraction draft when fallback changed the conclusion", () => {
  const diagnostics = buildAnswerDiagnostics({
    rawConclusion: "片区要求沿江公共开放空间连续贯通，街坊内部公共服务设施宜优先布置在",
    sanitizedConclusion:
      "片区要求沿江公共开放空间连续贯通，街坊内部公共服务设施宜优先布置在",
    displayConclusion:
      "已检索到相关依据，但自动提炼结果不完整，系统不直接输出半截结论。请结合下方引用原文核对。",
    fallbackReasons: ["dangling_connector"],
  });

  assert.ok(diagnostics);
  assert.equal(diagnostics.rawConclusion, "片区要求沿江公共开放空间连续贯通，街坊内部公共服务设施宜优先布置在");
  assert.equal(diagnostics.wasReplaced, true);
  assert.deepEqual(diagnostics.fallbackReasons, ["dangling_connector"]);
});
