import assert from "node:assert/strict";
import test from "node:test";

import {
  parseReviewArtifactSummaries,
  reviewStatusMeta,
} from "../lib/audit/reviewPresentation.ts";

test("maps every review status to its management UI presentation", () => {
  assert.deepEqual(reviewStatusMeta("pending"), {
    label: "待审核",
    variant: "warning",
  });
  assert.deepEqual(reviewStatusMeta("draft"), {
    label: "审核中",
    variant: "info",
  });
  assert.deepEqual(reviewStatusMeta("passed"), {
    label: "审核通过",
    variant: "success",
  });
  assert.deepEqual(reviewStatusMeta("issues_found"), {
    label: "发现问题",
    variant: "destructive",
  });
});

const validSummary = {
  documentId: "doc-audit",
  artifactId: "artifact-20260715",
  generatedAt: "2026-07-15T10:00:00.000Z",
  status: "draft",
  reviewerUserId: "user-admin",
  finalizedAt: "2026-07-15T10:30:00.000Z",
  focusItemCount: 12,
  issueCount: 2,
};

test("parses valid review artifact summaries", () => {
  assert.deepEqual(parseReviewArtifactSummaries([validSummary]), [validSummary]);
});

test("rejects an unknown review artifact status", () => {
  assert.throws(
    () =>
      parseReviewArtifactSummaries([
        { ...validSummary, status: "archived" },
      ]),
    /审核副本数据无效/
  );
});

test("rejects a review artifact without an artifact id", () => {
  const { artifactId: _artifactId, ...missingArtifactId } = validSummary;
  assert.throws(
    () => parseReviewArtifactSummaries([missingArtifactId]),
    /审核副本数据无效/
  );
});

test("rejects a review artifact with an invalid generated time", () => {
  assert.throws(
    () =>
      parseReviewArtifactSummaries([
        { ...validSummary, generatedAt: "not-a-date" },
      ]),
    /审核副本数据无效/
  );
});

test("rejects a non-array review artifact payload", () => {
  assert.throws(
    () => parseReviewArtifactSummaries({ artifacts: [validSummary] }),
    /审核副本数据无效/
  );
});
