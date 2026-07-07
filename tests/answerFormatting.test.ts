import test from "node:test";
import assert from "node:assert/strict";

import {
  finalizeConclusionText,
  isIncompleteConclusionText,
  sanitizeConclusionText,
} from "../lib/rag/answerFormatting.ts";
import {
  rankStructuredEvidenceForQuestion,
  recoverConclusionFromStructuredEvidence,
} from "../lib/rag/structuredFieldSelector.ts";

test("strips nested LLM answer template and keeps conclusion body only", () => {
  const text = [
    "【结论】",
    "托幼服务范围为6岁以下，服务规模应以引用原文页面为准。",
    "",
    "【依据】",
    "北京市居住公共服务设施配置指标京政发〔2025〕25号。",
    "",
    "【注意】",
    "以具体文件为准。",
  ].join("\n");

  assert.equal(
    sanitizeConclusionText(text),
    "托幼服务范围为6岁以下，服务规模应以引用原文页面为准。"
  );
});

test("detects incomplete conclusions that stop on a dangling number", () => {
  assert.equal(
    isIncompleteConclusionText(
      "社区卫生服务站配置指标为：在满足步行可达的前提下，原则上每个社区设置1个社区卫生服务站，15"
    ),
    true
  );
});

test("replaces incomplete source-page-required conclusions with a safe fallback", () => {
  const result = finalizeConclusionText(
    "社区卫生服务站配置指标为：在满足步行可达的前提下，原则上每个社区设置1个社区卫生服务站，15",
    [
      {
        excerptDisplayPolicy: "source_page_required",
        extractionWarnings: ["noisy_extraction_text"],
      },
    ]
  );

  assert.equal(result.reflection.needsFallback, true);
  assert.match(result.text, /已定位到相关原文位置/);
  assert.match(result.text, /不直接提炼为确定结论/);
});

test("recovers a deterministic conclusion from clean structured indicator evidence", () => {
  const recovered = recoverConclusionFromStructuredEvidence([
    {
      chunkType: "indicator",
      excerptDisplayPolicy: "show_extracted_text",
      excerpt: [
        "【结构化指标项】",
        "指标对象：社区卫生服务站",
        "来源表格：表 — 医疗卫生类设施配置要求表",
        "配置要求：指标使用说明",
        "设施名称：社区卫生服务站",
        "详细配置要求：1.在满足步行15分钟可达的前提下,原则上每2个社区设置1个社区卫生服务站,15分钟步行范围内有社区卫生服务中心的可不再设置。2.业务用房及必须配建的楼梯间、电梯间、走廊等辅助空间建筑面积占总建筑面积比例不应低于85%。3.具体科室按照主管部门要求设置。",
      ].join("\n"),
    },
  ]);

  assert.ok(recovered);
  assert.match(recovered, /社区卫生服务站/);
  assert.match(recovered, /15分钟步行范围内/);
  assert.match(recovered, /社区卫生服务中心的可不再设置/);
  assert.match(recovered, /85%/);
});

test("does not recover conclusions from low-fidelity structured evidence", () => {
  const recovered = recoverConclusionFromStructuredEvidence([
    {
      chunkType: "indicator",
      lowFidelity: true,
      extractionWarnings: ["noisy_extraction_text"],
      excerptDisplayPolicy: "source_page_required",
      excerpt: [
        "【结构化指标项】",
        "指标对象：社区卫生1服5务中心",
        "详细配置要求：2. 、 、85%具",
      ].join("\n"),
    },
  ]);

  assert.equal(recovered, null);
});

test("recovers the structured indicator row matching an area question", () => {
  const recovered = recoverConclusionFromStructuredEvidence(
    [
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务站",
          "来源表格：表 — 医疗卫生类设施配置要求表",
          "配置要求：指标使用说明",
          "设施名称：社区卫生服务站",
          "详细配置要求：业务用房及辅助空间建筑面积占总建筑面积比例不应低于85%。",
        ].join("\n"),
      },
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务站",
          "来源表格：表 — 医疗卫生类设施配置指标表",
          "层级：社区级",
          "设施名称：社区卫生服务站",
          "规模性指标.一般规模：350",
          "千人指标：25",
          "服务规模：每两个社区1处",
        ].join("\n"),
      },
    ],
    "社区卫生服务站一般多少面积"
  );

  assert.ok(recovered);
  assert.match(recovered, /规模性指标\.一般规模：350/);
  assert.doesNotMatch(recovered, /85%/);
  assert.doesNotMatch(recovered, /服务规模：每两个社区1处/);
});

test("treats square-meter shorthand questions as general scale questions", () => {
  const recovered = recoverConclusionFromStructuredEvidence(
    [
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务站",
          "来源表格：表 — 医疗卫生类设施配置要求表",
          "配置要求：指标使用说明",
          "设施名称：社区卫生服务站",
          "详细配置要求：业务用房及辅助空间建筑面积占总建筑面积比例不应低于85%。",
        ].join("\n"),
      },
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务站",
          "来源表格：表 — 医疗卫生类设施配置指标表",
          "设施名称：社区卫生服务站",
          "规模性指标.一般规模：350",
        ].join("\n"),
      },
    ],
    "社区卫生服务站多少平方米"
  );

  assert.ok(recovered);
  assert.match(recovered, /一般规模：350/);
  assert.doesNotMatch(recovered, /85%/);
});

test("ranks structured citations matching an area question first", () => {
  const ranked = rankStructuredEvidenceForQuestion(
    [
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务站",
          "来源表格：表 — 医疗卫生类设施配置要求表",
          "详细配置要求：建筑面积占总建筑面积比例不应低于85%。",
        ].join("\n"),
      },
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务站",
          "来源表格：表 — 医疗卫生类设施配置指标表",
          "规模性指标.一般规模：350",
        ].join("\n"),
      },
    ],
    "社区卫生服务站一般多少面积"
  );

  assert.match(ranked[0].excerpt ?? "", /一般规模：350/);
});

test("keeps ratio questions on detailed requirement evidence instead of general scale", () => {
  const recovered = recoverConclusionFromStructuredEvidence(
    [
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务站",
          "来源表格：表 — 医疗卫生类设施配置指标表",
          "设施名称：社区卫生服务站",
          "规模性指标.一般规模：350",
        ].join("\n"),
      },
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务站",
          "来源表格：表 — 医疗卫生类设施配置要求表",
          "配置要求：指标使用说明",
          "设施名称：社区卫生服务站",
          "详细配置要求：业务用房及辅助空间建筑面积占总建筑面积比例不应低于85%。",
        ].join("\n"),
      },
    ],
    "社区卫生服务站业务用房比例不低于多少"
  );

  assert.ok(recovered);
  assert.match(recovered, /85%/);
  assert.doesNotMatch(recovered, /一般规模：350/);
});

test("recovers service scale without confusing it with general scale", () => {
  const recovered = recoverConclusionFromStructuredEvidence(
    [
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务站",
          "来源表格：表 — 医疗卫生类设施配置指标表",
          "设施名称：社区卫生服务站",
          "规模性指标.一般规模：350",
          "服务规模：每两个社区1处",
        ].join("\n"),
      },
    ],
    "社区卫生服务站服务规模是多少"
  );

  assert.ok(recovered);
  assert.match(recovered, /服务规模：每两个社区1处/);
  assert.doesNotMatch(recovered, /一般规模：350/);
});

test("keeps specific emergency-station area questions on detailed requirements", () => {
  const recovered = recoverConclusionFromStructuredEvidence(
    [
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务中心",
          "来源表格：表 — 医疗卫生类设施配置指标表",
          "设施名称：社区卫生服务中心",
          "规模性指标.一般规模：5000",
        ].join("\n"),
      },
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务中心",
          "来源表格：表 — 医疗卫生类设施配置要求表",
          "配置要求：指标使用说明",
          "设施名称：社区卫生服务中心",
          "详细配置要求：设有院前医疗急救工作站的社区卫生服务中心,按照A级急救工作站至少增加200平方米、B级急救工作站至少增加80平方米的标准增加建筑面积(不含公摊)。",
        ].join("\n"),
      },
    ],
    "社区卫生服务中心A级急救工作站至少增加多少建筑面积"
  );

  assert.ok(recovered);
  assert.match(recovered, /A级急救工作站至少增加200平方米/);
  assert.doesNotMatch(recovered, /一般规模：5000/);
});

test("keeps bed area questions on detailed requirements instead of general scale", () => {
  const recovered = recoverConclusionFromStructuredEvidence(
    [
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务中心",
          "来源表格：表 — 医疗卫生类设施配置指标表",
          "设施名称：社区卫生服务中心",
          "规模性指标.一般规模：5000",
        ].join("\n"),
      },
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务中心",
          "来源表格：表 — 医疗卫生类设施配置要求表",
          "配置要求：指标使用说明",
          "设施名称：社区卫生服务中心",
          "详细配置要求：新建社区卫生服务中心除设置相关科室外,还应结合实际需求按照每张病床不少于30平方米建筑面积配置床位。",
        ].join("\n"),
      },
    ],
    "社区卫生服务中心每张病床不少于多少建筑面积"
  );

  assert.ok(recovered);
  assert.match(recovered, /每张病床不少于30平方米/);
  assert.doesNotMatch(recovered, /一般规模：5000/);
});

test("focuses bed shorthand questions on the bed-area sentence", () => {
  const recovered = recoverConclusionFromStructuredEvidence(
    [
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务中心",
          "来源表格：表 — 医疗卫生类设施配置要求表",
          "配置要求：指标使用说明",
          "设施名称：社区卫生服务中心",
          "详细配置要求：1.原则上每个街道设置1处。2.周边步行15分钟内可达三甲医院的,可减少其他科室设置。3.新建社区卫生服务中心按照每张病床不少于30平方米建筑面积配置床位。",
        ].join("\n"),
      },
    ],
    "社区卫生服务中心每张床需要多少平米"
  );

  assert.ok(recovered);
  assert.match(recovered, /每张病床不少于30平方米/);
  assert.doesNotMatch(recovered, /原则上每个街道设置1处/);
});

test("extracts the relevant sentence from long detailed requirements", () => {
  const recovered = recoverConclusionFromStructuredEvidence(
    [
      {
        chunkType: "indicator",
        excerptDisplayPolicy: "show_extracted_text",
        excerpt: [
          "【结构化指标项】",
          "指标对象：社区卫生服务中心",
          "来源表格：表 — 医疗卫生类设施配置要求表",
          "配置要求：指标使用说明",
          "设施名称：社区卫生服务中心",
          "详细配置要求：1.原则上每个街道设置1处。2.周边步行15分钟内可达三甲医院的,可减少其他科室设置。3.新建社区卫生服务中心按照每张病床不少于30平方米建筑面积配置床位。4.共享用房按复合利用情况核算。5.设有院前医疗急救工作站的社区卫生服务中心,按照A级急救工作站至少增加200平方米、B级急救工作站至少增加80平方米的标准增加建筑面积(不含公摊)。6.业务用房及辅助空间建筑面积占总建筑面积比例不应低于85%。",
        ].join("\n"),
      },
    ],
    "社区卫生服务中心A级急救工作站至少增加多少建筑面积"
  );

  assert.ok(recovered);
  assert.match(recovered, /A级急救工作站至少增加200平方米/);
  assert.doesNotMatch(recovered, /原则上每个街道设置1处/);
  assert.doesNotMatch(recovered, /不应低于85%/);
});
