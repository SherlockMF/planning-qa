import assert from "node:assert/strict";
import test from "node:test";

import { runAutoReview } from "../lib/audit/runAutoReview.ts";
import type { AuditReviewItem } from "../lib/audit/types.ts";
import type { AutoReviewProvider } from "../lib/audit/autoReviewProvider.ts";

function item(auditItemId: string, pageStart = 1): AuditReviewItem {
  return {
    auditItemId,
    objectType: "section",
    title: auditItemId,
    content: "普通内容",
    warnings: [],
    selectedForReview: true,
    source: { pageStart, blockIds: [], chunkIds: [] },
  };
}

test("rules-only run stays visibly unavailable as a hybrid Agent completion", async () => {
  let renderCount = 0;
  const run = await runAutoReview({ artifactId: "artifact-a", items: [item("item-1")] }, {
    renderPage: async () => {
      renderCount += 1;
      return { mimeType: "image/png", base64: "AA==" };
    },
    now: () => "2026-07-16T00:00:00.000Z",
    concurrency: 1,
  });

  assert.equal(run.mode, "rules_only");
  assert.equal(run.items[0].mode, "rules_only");
  assert.equal(run.summary.status, "unavailable");
  assert.equal(renderCount, 0);
});

test("configured provider reuses one rendered page and completes hybrid review", async () => {
  let renderCount = 0;
  const provider: AutoReviewProvider = {
    metadata: { name: "independent-review", model: "vision-1" },
    async review() {
      return {
        status: "clean",
        riskScore: 10,
        issueTypes: [],
        summary: "未发现问题",
        sourceEvidence: "第 1 页目标行",
      };
    },
  };

  const run = await runAutoReview({
    artifactId: "artifact-a",
    items: [item("item-1"), item("item-2")],
  }, {
    provider,
    renderPage: async () => {
      renderCount += 1;
      return { mimeType: "image/png", base64: "AA==" };
    },
    now: () => "2026-07-16T00:00:00.000Z",
    concurrency: 2,
  });

  assert.equal(renderCount, 1);
  assert.equal(run.mode, "hybrid");
  assert.equal(run.summary.status, "completed");
  assert.equal(run.summary.reviewedCount, 2);
});

test("one provider rejection does not fail the batch or masquerade as completed", async () => {
  const provider: AutoReviewProvider = {
    metadata: { name: "independent-review", model: "vision-1" },
    async review({ item: current }) {
      if (current.auditItemId === "item-2") throw new Error("provider_rejected");
      return {
        status: "clean",
        riskScore: 10,
        issueTypes: [],
        summary: "未发现问题",
        sourceEvidence: "第 1 页目标行",
      };
    },
  };

  const run = await runAutoReview({
    artifactId: "artifact-a",
    items: [item("item-1"), item("item-2", 2)],
  }, {
    provider,
    renderPage: async () => ({ mimeType: "image/png", base64: "AA==" }),
    now: () => "2026-07-16T00:00:00.000Z",
    concurrency: 1,
  });

  assert.equal(run.items.find((entry) => entry.auditItemId === "item-2")?.status, "unavailable");
  assert.equal(run.items.find((entry) => entry.auditItemId === "item-2")?.mode, "partial");
  assert.equal(run.mode, "partial");
  assert.equal(run.summary.unavailableCount, 1);
  assert.notEqual(run.summary.status, "completed");
});

test("image failure is isolated to the affected item", async () => {
  const provider: AutoReviewProvider = {
    metadata: { name: "independent-review", model: "vision-1" },
    async review() {
      return {
        status: "clean",
        riskScore: 10,
        issueTypes: [],
        summary: "未发现问题",
        sourceEvidence: "目标行",
      };
    },
  };
  const run = await runAutoReview({
    artifactId: "artifact-a",
    items: [item("item-1", 1), item("item-2", 2)],
  }, {
    provider,
    renderPage: async (pageNumber) => {
      if (pageNumber === 2) throw new Error("image_missing");
      return { mimeType: "image/png", base64: "AA==" };
    },
    now: () => "2026-07-16T00:00:00.000Z",
    concurrency: 2,
  });

  assert.equal(run.items[0].status, "clean");
  assert.equal(run.items[1].status, "unavailable");
  assert.match(run.items[1].unavailableReason ?? "", /image_missing/);
});
