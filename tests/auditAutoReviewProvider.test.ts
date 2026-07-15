import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAutoReviewProvider,
  parseModelAssessment,
} from "../lib/audit/autoReviewProvider.ts";

test("parseModelAssessment accepts the exact automatic-review contract", async () => {
  const assessment = await parseModelAssessment(JSON.stringify({
    status: "suspected_issue",
    riskScore: 72,
    issueTypes: ["reading_order_noise"],
    summary: "数字与单位顺序异常",
    sourceEvidence: "第 3 页目标行",
  }));

  assert.deepEqual(assessment, {
    status: "suspected_issue",
    riskScore: 72,
    issueTypes: ["reading_order_noise"],
    summary: "数字与单位顺序异常",
    sourceEvidence: "第 3 页目标行",
  });
});

test("parseModelAssessment rejects invalid status, score, evidence, and issue count", async () => {
  await assert.rejects(
    () => parseModelAssessment(JSON.stringify({
      status: "passed",
      riskScore: 20,
      issueTypes: [],
      summary: "未发现问题",
      sourceEvidence: "第 1 页",
    })),
    /invalid_auto_review_status/,
  );
  await assert.rejects(
    () => parseModelAssessment(JSON.stringify({
      status: "clean",
      riskScore: 101,
      issueTypes: [],
      summary: "未发现问题",
      sourceEvidence: "第 1 页",
    })),
    /invalid_auto_review_risk_score/,
  );
  await assert.rejects(
    () => parseModelAssessment(JSON.stringify({
      status: "clean",
      riskScore: 10,
      issueTypes: [],
      summary: "未发现问题",
    })),
    /missing_auto_review_source_evidence/,
  );
  await assert.rejects(
    () => parseModelAssessment(JSON.stringify({
      status: "suspected_issue",
      riskScore: 70,
      issueTypes: ["other", "missing_content", "column_misalignment", "source_mapping_error", "reading_order_noise"],
      summary: "问题过多",
      sourceEvidence: "第 1 页",
    })),
    /too_many_auto_review_issue_types/,
  );
});

test("dedicated provider is enabled independently with temperature zero", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const provider = createAutoReviewProvider({
    env: {
      AUTO_REVIEW_ENABLED: "1",
      AUTO_REVIEW_API_KEY: "review-secret",
      AUTO_REVIEW_API_URL: "https://review.example/v1/chat/completions",
      AUTO_REVIEW_MODEL: "vision-reviewer",
    },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          status: "clean",
          riskScore: 12,
          issueTypes: [],
          summary: "未发现问题",
          sourceEvidence: "第 1 页目标行",
        }) } }],
      }), { status: 200 });
    },
  });

  assert.ok(provider);
  assert.deepEqual(provider.metadata, { name: "auto_review_compatible", model: "vision-reviewer" });
  await provider.review({
    item: {
      auditItemId: "item-1",
      objectType: "table_row",
      title: "设施",
      content: "服务规模 1000 户",
      warnings: [],
      selectedForReview: true,
      source: { pageStart: 1, blockIds: [], chunkIds: [] },
    },
    ruleSignals: [],
    pageImage: { mimeType: "image/png", base64: "AA==" },
  });

  assert.equal(requests.length, 1);
  const body = JSON.parse(String(requests[0].init.body));
  assert.equal(body.temperature, 0);
  assert.equal(body.model, "vision-reviewer");
  assert.match(JSON.stringify(body.messages), /sourceEvidence/);
});

test("provider selection requires explicit enablement and never imports the answer LLM", async () => {
  assert.equal(createAutoReviewProvider({ env: { ZHIPU_API_KEY: "qa-secret" } }), undefined);
  const fallback = createAutoReviewProvider({
    env: { AUTO_REVIEW_ENABLED: "1", ZHIPU_API_KEY: "review-secret" },
    fetchImpl: async () => new Response("{}", { status: 500 }),
  });
  assert.deepEqual(fallback?.metadata, { name: "zhipu_auto_review", model: "glm-4v-flash" });

  const source = await readFile(new URL("../lib/audit/autoReviewProvider.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getLLMProvider|\.\.\/ai\/llm/);
});
