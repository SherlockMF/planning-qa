import test from "node:test";
import assert from "node:assert/strict";
import type { AuditReviewItem, AutoRuleSignal } from "../lib/audit/types.ts";
import { detectAuditRiskSignals } from "../lib/audit/riskSignals.ts";
import { aggregateAutoRisk, riskLevelForScore } from "../lib/audit/riskScore.ts";

function item(overrides: Partial<AuditReviewItem>): AuditReviewItem {
  return {
    auditItemId: "item-1",
    objectType: "structured_table_row",
    title: "配置指标",
    content: "正常内容",
    confidence: 0.95,
    warnings: [],
    selectedForReview: false,
    source: {
      pageStart: 1,
      pageEnd: 1,
      blockIds: [],
      chunkIds: [],
    },
    ...overrides,
  };
}

test("figure 1 flags reading-order noise and title distortion", () => {
  const result = detectAuditRiskSignals(item({
    title: "3.、5、10、15。",
    content: "社区卫生1服5务中心 2 1 ,15。建筑面积比例不应低于2. 、 、85%具。",
  }));

  assert.ok(result.some((signal) => signal.issueType === "reading_order_noise"));
  assert.ok(Math.max(...result.map((signal) => signal.riskScore)) >= 70);
});

test("figure 2 flags a value absent from the target source row", () => {
  const result = detectAuditRiskSignals(item({
    content: "服务规模：20 / 1000—5000户",
    tableContext: {
      headers: ["编号", "设施名称", "服务规模"],
      targetRow: ["15", "综合通信机房", "1000—5000户"],
      previousRow: ["14", "污水处置及再生利用装置", "20平方米/万平方米"],
    },
  }));

  assert.ok(result.some((signal) => signal.issueType === "row_boundary_contamination"));
  assert.ok(Math.max(...result.map((signal) => signal.riskScore)) >= 85);
});

test("figure 3 flags semantic assignment while keeping a clean long cell negative", () => {
  const figure3Item = item({
    title: "指标修改说明",
    content: "设施名称：指标修改说明。指标修改说明：结合地区实际优化配置，并统筹相邻设施。",
    tableContext: {
      headers: ["设施名称", "指标修改说明"],
      targetRow: ["指标修改说明", "结合地区实际优化配置，并统筹相邻设施。"],
    },
  });
  const cleanLongCellItem = item({
    title: "社区卫生服务中心",
    content: "设施名称：社区卫生服务中心。指标修改说明：结合地区实际优化配置，并统筹相邻设施，满足全生命周期健康服务需求。",
    tableContext: {
      headers: ["设施名称", "指标修改说明"],
      targetRow: ["社区卫生服务中心", "结合地区实际优化配置，并统筹相邻设施，满足全生命周期健康服务需求。"],
    },
  });

  assert.ok(detectAuditRiskSignals(figure3Item).some(
    (signal) => signal.issueType === "semantic_assignment_error"
  ));
  assert.deepEqual(detectAuditRiskSignals(cleanLongCellItem), []);
});

test("does not treat an ordinary explanation section as a table assignment error", () => {
  assert.deepEqual(detectAuditRiskSignals(item({
    objectType: "plain_section",
    title: "说明",
    content: "本节说明适用范围和使用方法。",
  })), []);
});

test("flags column mismatch and non-empty overflow cells", () => {
  const result = detectAuditRiskSignals(item({
    tableContext: {
      headers: ["设施名称", "服务规模"],
      targetRow: ["社区服务站", "每社区1处", "串入相邻列"],
    },
  }));

  assert.ok(result.some((signal) => signal.issueType === "column_misalignment"));
  assert.ok(Math.max(...result.map((signal) => signal.riskScore)) >= 80);
});

test("risk boundaries are stable", () => {
  assert.equal(riskLevelForScore(39), "low");
  assert.equal(riskLevelForScore(40), "medium");
  assert.equal(riskLevelForScore(69), "medium");
  assert.equal(riskLevelForScore(70), "high");
});

test("aggregation uses maximum risk, clamps the score, and preserves rules-only mode", () => {
  const ruleSignals: AutoRuleSignal[] = [{
    ruleId: "rule-high",
    issueType: "reading_order_noise",
    riskScore: 70,
    summary: "阅读顺序异常",
    evidence: "异常文本",
  }];
  const result = aggregateAutoRisk({
    mode: "rules_only",
    ruleSignals,
    modelAssessment: {
      status: "suspected_issue",
      riskScore: 120,
      issueTypes: ["other"],
      summary: "模型异常",
      sourceEvidence: "原页",
    },
  });

  assert.equal(result.riskScore, 100);
  assert.equal(result.riskLevel, "high");
  assert.equal(result.status, "suspected_issue");
  assert.equal(result.mode, "rules_only");
  assert.deepEqual(result.issueTypes, ["reading_order_noise", "other"]);
});

test("configured hybrid without a model result cannot be summarized as clean", () => {
  const result = aggregateAutoRisk({ mode: "hybrid", ruleSignals: [] });

  assert.equal(result.status, "unavailable");
  assert.equal(result.mode, "partial");
  assert.equal(result.riskScore, 0);
});

test("partial and unavailable inputs cannot be summarized as automatic passes", () => {
  assert.equal(aggregateAutoRisk({ mode: "partial", ruleSignals: [] }).status, "unavailable");
  assert.equal(aggregateAutoRisk({ mode: "unavailable", ruleSignals: [] }).status, "unavailable");
});
