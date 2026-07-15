import test from "node:test";
import assert from "node:assert/strict";

import {
  applyReviewSubmission,
  ReviewSubmissionError,
} from "../lib/audit/reviewSubmission.ts";
import type { AuditManifest, ReviewResult } from "../lib/audit/types.ts";

const manifest = {
  schemaVersion: 1,
  artifactId: "artifact-a",
  items: [
    { auditItemId: "obj:a", selectedForReview: true },
    { auditItemId: "obj:b", selectedForReview: true },
    { auditItemId: "obj:c", selectedForReview: false },
  ],
} as AuditManifest;

const pending: ReviewResult = {
  schemaVersion: 1,
  artifactId: "artifact-a",
  status: "pending",
  items: [],
};

test("saves a valid draft and assigns its reviewer", () => {
  const result = applyReviewSubmission({
    manifest,
    current: pending,
    reviewerUserId: "user-admin",
    now: "2026-07-15T01:00:00.000Z",
    body: {
      action: "save_draft",
      items: [
        {
          auditItemId: "obj:a",
          status: "passed",
          issueTypes: [],
          comment: "",
        },
      ],
    },
  });

  assert.equal(result.status, "draft");
  assert.equal(result.reviewerUserId, "user-admin");
  assert.equal(result.startedAt, "2026-07-15T01:00:00.000Z");
});

test("requires every focus item before finalizing", () => {
  assert.throws(
    () =>
      applyReviewSubmission({
        manifest,
        current: pending,
        reviewerUserId: "user-admin",
        now: "2026-07-15T01:00:00.000Z",
        body: {
          action: "finalize",
          items: [
            {
              auditItemId: "obj:a",
              status: "passed",
              issueTypes: [],
              comment: "",
            },
          ],
        },
      }),
    (error) =>
      error instanceof ReviewSubmissionError &&
      error.status === 400 &&
      error.message === "重点审核项尚未全部完成"
  );
});

test("requires issue type and comment", () => {
  assert.throws(
    () =>
      applyReviewSubmission({
        manifest,
        current: pending,
        reviewerUserId: "user-admin",
        now: "2026-07-15T01:00:00.000Z",
        body: {
          action: "save_draft",
          items: [
            {
              auditItemId: "obj:a",
              status: "issue",
              issueTypes: [],
              comment: "",
            },
          ],
        },
      }),
    /问题项必须选择问题类型并填写备注/
  );
});

test("locks a draft to one reviewer and never overwrites final results", () => {
  const owned = {
    ...pending,
    status: "draft",
    reviewerUserId: "user-admin",
    startedAt: "2026-07-15T01:00:00.000Z",
  } as ReviewResult;
  assert.throws(
    () =>
      applyReviewSubmission({
        manifest,
        current: owned,
        reviewerUserId: "user-manager",
        now: "2026-07-15T02:00:00.000Z",
        body: { action: "save_draft", items: [] },
      }),
    /审核草稿已由其他用户领取/
  );

  const final = {
    ...owned,
    status: "passed",
    finalizedAt: "2026-07-15T02:00:00.000Z",
  } as ReviewResult;
  assert.throws(
    () =>
      applyReviewSubmission({
        manifest,
        current: final,
        reviewerUserId: "user-admin",
        now: "2026-07-15T03:00:00.000Z",
        body: { action: "save_draft", items: [] },
      }),
    /审核结果已提交/
  );
});
