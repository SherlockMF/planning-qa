import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLowFidelityFallback,
  classifyEvidenceQuality,
  detectExtractionWarnings,
  hasAnswerBlockingWarning,
} from "../lib/rag/evidenceQuality.ts";

test("detects scrambled numeric table evidence", () => {
  const warnings = detectExtractionWarnings({
    chunkType: "table_row",
    text: "服务范围：岁6以下；服务规模：0万.9人6、1万.4人4。",
  });

  assert.ok(warnings.includes("scrambled_numeric_unit"));
});

test("does not flag ordinary clause numbers as low fidelity", () => {
  const warnings = detectExtractionWarnings({
    chunkType: "clause",
    text: "第1条规定，本标准适用于新建居住社区。3.0.1 应符合相关规划要求。",
  });

  assert.deepEqual(warnings, []);
});

test("detects noisy extraction order without blocking the answer", () => {
  const quality = classifyEvidenceQuality({
    chunkType: "indicator",
    text: "在满足步行分钟可达的前提下原则上每个社区设置个社区卫生服务站分钟步行范围1内.有社区卫生1服5务中心的可不再设置 , 2 1 ,15。业务用房建筑面积比例不应低于2. 、 、85%。",
  });

  assert.ok(quality.warnings.includes("noisy_extraction_text"));
  assert.ok(quality.categories.includes("reading_order_noise"));
  assert.equal(quality.blocksAnswer, false);
  assert.equal(quality.displayPolicy, "source_page_required");
});

test("detects numeric sequence and numbered-list fragments inside table cells", () => {
  const quality = classifyEvidenceQuality({
    chunkType: "table_row",
    text: "详细配置要求：分钟步行范围1内.有社区卫生1服5务中心的可不再设置 , 2 1 ,15。建筑面积比例不应低于2. 、 、85%具。",
  });

  assert.ok(quality.warnings.includes("noisy_extraction_text"));
  assert.ok(quality.categories.includes("reading_order_noise"));
  assert.equal(quality.displayPolicy, "source_page_required");
});

test("does not flag normal quantified Chinese table cells", () => {
  const quality = classifyEvidenceQuality({
    chunkType: "table_row",
    text: "1.在满足步行15分钟可达的前提下,原则上每2个社区设置1个社区卫生服务站,15分钟步行范围内有社区卫生服务中心的可不再设置。2.业务用房及必须配建的楼梯间、电梯间、走廊等辅助空间建筑面积占总建筑面积比例不应低于85%。3.具体科室按照主管部门要求设置。",
  });

  assert.deepEqual(quality.warnings, []);
  assert.deepEqual(quality.categories, []);
  assert.equal(quality.displayPolicy, "show_extracted_text");
});

test("does not flag normal numeric ranges in Chinese table cells", () => {
  const quality = classifyEvidenceQuality({
    chunkType: "table_row",
    text: "原则上每个街道设置1处,服务人口超过10万的街道,每增加5至10万人增设1个社区卫生服务中心或分中心。按照每张病床不少于30平方米建筑面积(约1.0-1.5张/千人)配置床位。业务用房建筑面积占比不应低于85%。",
  });

  assert.deepEqual(quality.warnings, []);
  assert.deepEqual(quality.categories, []);
  assert.equal(quality.displayPolicy, "show_extracted_text");
});

test("detects paragraph-table glue noise without blocking the answer", () => {
  const quality = classifyEvidenceQuality({
    chunkType: "requirement",
    text: "层医疗设施服务适应全人群全生命周期健康管理需求高社区卫生服务设施配置指标统筹地区内各级各类医疗卫生资源布局17 1街道)万 1)含 5街",
  });

  assert.ok(quality.warnings.includes("noisy_extraction_text"));
  assert.ok(quality.categories.includes("table_text_glue"));
  assert.equal(quality.blocksAnswer, false);
  assert.equal(quality.displayPolicy, "source_page_required");
});

test("numeric-unit scrambling blocks direct numeric conclusions", () => {
  const quality = classifyEvidenceQuality({
    chunkType: "indicator",
    text: "服务范围：岁6以下；服务规模：0万.9人6。",
  });

  assert.ok(quality.warnings.includes("scrambled_numeric_unit"));
  assert.ok(quality.categories.includes("numeric_value_corruption"));
  assert.equal(quality.blocksAnswer, true);
  assert.equal(quality.displayPolicy, "source_page_required");
});

test("low fidelity citations replace numeric conclusion with source-page fallback", () => {
  const conclusion = "托幼服务规模为0万.9人6，服务范围为岁6以下。";
  const safe = applyLowFidelityFallback(conclusion, [
    {
      id: "c1",
      fileName: "北京市居住公共服务设施配置指标.pdf",
      pageNumber: 12,
      excerpt: "服务规模：0万.9人6",
      relevance: "高",
      chunkType: "table_row",
      lowFidelity: true,
      extractionWarnings: ["scrambled_numeric_unit"],
    },
  ]);

  assert.equal(safe.includes("0万.9人6"), false);
  assert.equal(safe.includes("岁6以下"), false);
  assert.match(safe, /以引用的原文页面为准/);
});
