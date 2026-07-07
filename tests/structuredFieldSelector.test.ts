import test from "node:test";
import assert from "node:assert/strict";

import {
  preferCleanStructuredCitations,
  recoverConclusionFromStructuredEvidence,
  rankStructuredEvidenceForQuestion,
} from "../lib/rag/structuredFieldSelector.ts";

test("structured field selector chooses general scale for square-meter shorthand", () => {
  const recovered = recoverConclusionFromStructuredEvidence(
    [
      citation([
        "【结构化指标项】",
        "指标对象：社区卫生服务站",
        "来源表格：表 — 医疗卫生类设施配置要求表",
        "配置要求：指标使用说明",
        "设施名称：社区卫生服务站",
        "详细配置要求：业务用房及辅助空间建筑面积占总建筑面积比例不应低于85%。",
      ]),
      citation([
        "【结构化指标项】",
        "指标对象：社区卫生服务站",
        "来源表格：表 — 医疗卫生类设施配置指标表",
        "设施名称：社区卫生服务站",
        "规模性指标.一般规模：350",
      ]),
    ],
    "社区卫生服务站多少平方米"
  );

  assert.ok(recovered);
  assert.match(recovered, /一般规模：350/);
  assert.doesNotMatch(recovered, /85%/);
});

test("structured field selector ranks matching citations before formatting", () => {
  const ranked = rankStructuredEvidenceForQuestion(
    [
      citation([
        "【结构化指标项】",
        "指标对象：社区卫生服务站",
        "来源表格：表 — 医疗卫生类设施配置要求表",
        "详细配置要求：建筑面积占总建筑面积比例不应低于85%。",
      ]),
      citation([
        "【结构化指标项】",
        "指标对象：社区卫生服务站",
        "来源表格：表 — 医疗卫生类设施配置指标表",
        "规模性指标.一般规模：350",
      ]),
    ],
    "社区卫生服务站一般多少面积"
  );

  assert.match(ranked[0].excerpt ?? "", /一般规模：350/);
});

test("structured field selector aggregates service scale rows for the same facility", () => {
  const recovered = recoverConclusionFromStructuredEvidence(
    [
      citation([
        "【结构化指标项】",
        "指标对象：托幼",
        "来源表格：表 — 基础教育类设施配置指标表",
        "设施名称：托幼",
        "规模性指标.一般规模.办学规模：12",
        "服务规模：1.44万人",
      ]),
      citation([
        "【结构化指标项】",
        "指标对象：托幼",
        "来源表格：表 — 基础教育类设施配置指标表",
        "设施名称：托幼",
        "规模性指标.一般规模.办学规模：8",
        "服务规模：0.96万人",
      ]),
    ],
    "托幼服务规模是多少？"
  );

  assert.ok(recovered);
  assert.match(recovered, /0\.96万人/);
  assert.match(recovered, /1\.44万人/);
  assert.match(recovered, /办学规模：8/);
  assert.match(recovered, /办学规模：12/);
  assert.ok(recovered.indexOf("办学规模：8") < recovered.indexOf("办学规模：12"));
});

test("structured field selector drops low-fidelity citations when clean structured evidence answers the question", () => {
  const clean = citation([
    "【结构化指标项】",
    "指标对象：托幼",
    "来源表格：表 — 基础教育类设施配置指标表",
    "服务规模：0.96万人",
  ]);
  const noisy = {
    ...citation(["已定位到相关原文页面；当前自动提取片段存在阅读顺序噪声。"]),
    lowFidelity: true,
    excerptDisplayPolicy: "source_page_required" as const,
  };

  const filtered = preferCleanStructuredCitations(
    [clean, noisy],
    "托幼服务规模是多少？"
  );

  assert.deepEqual(filtered, [clean]);
});

function citation(lines: string[]) {
  return {
    chunkType: "indicator",
    excerptDisplayPolicy: "show_extracted_text" as const,
    excerpt: lines.join("\n"),
  };
}
