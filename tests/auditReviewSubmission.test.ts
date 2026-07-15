import test from "node:test";
import assert from "node:assert/strict";

import {
  applyReviewSubmission,
  ReviewSubmissionError,
} from "../lib/audit/reviewSubmission.ts";
import { evaluateReviewAvailability } from "../lib/audit/reviewAvailability.ts";
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

const validDraftBody = {
  action: "save_draft",
  items: [
    {
      auditItemId: "obj:a",
      status: "passed",
      issueTypes: [],
      comment: "",
    },
  ],
};

function assertSubmissionError(
  run: () => unknown,
  message: string,
  status: 400 | 409
) {
  assert.throws(
    run,
    (error) =>
      error instanceof ReviewSubmissionError &&
      error.status === status &&
      error.message === message
  );
}

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

test("rejects an empty or whitespace-only reviewer id", () => {
  for (const reviewerUserId of ["", "   "]) {
    assertSubmissionError(
      () =>
        applyReviewSubmission({
          manifest,
          current: pending,
          reviewerUserId,
          now: "2026-07-15T01:00:00.000Z",
          body: validDraftBody,
        }),
      "审核用户无效",
      400
    );
  }
});

test("normalizes the reviewer id before ownership checks and persistence", () => {
  const owned = {
    ...pending,
    status: "draft",
    reviewerUserId: "user-admin",
  } as ReviewResult;

  const result = applyReviewSubmission({
    manifest,
    current: owned,
    reviewerUserId: "  user-admin  ",
    now: "2026-07-15T01:00:00.000Z",
    body: validDraftBody,
  });

  assert.equal(result.reviewerUserId, "user-admin");
});

test("rejects empty, invalid, or noncanonical review timestamps", () => {
  for (const now of ["", "not-a-date", "2026-07-15T01:00:00Z"]) {
    assertSubmissionError(
      () =>
        applyReviewSubmission({
          manifest,
          current: pending,
          reviewerUserId: "user-admin",
          now,
          body: validDraftBody,
        }),
      "审核时间无效",
      400
    );
  }
});

test("fails closed for unsupported stored review versions", () => {
  assertSubmissionError(
    () =>
      applyReviewSubmission({
        manifest,
        current: { ...pending, schemaVersion: 2 } as unknown as ReviewResult,
        reviewerUserId: "",
        now: "",
        body: validDraftBody,
      }),
    "审核结果版本无效",
    409
  );
});

test("fails closed for unknown stored review statuses", () => {
  assertSubmissionError(
    () =>
      applyReviewSubmission({
        manifest,
        current: { ...pending, status: "unknown" } as unknown as ReviewResult,
        reviewerUserId: "user-admin",
        now: "2026-07-15T01:00:00.000Z",
        body: validDraftBody,
      }),
    "审核结果状态无效",
    409
  );
});

test("treats terminal statuses as submitted even without finalizedAt", () => {
  for (const status of ["passed", "issues_found"] as const) {
    assertSubmissionError(
      () =>
        applyReviewSubmission({
          manifest,
          current: { ...pending, status },
          reviewerUserId: "user-admin",
          now: "2026-07-15T01:00:00.000Z",
          body: validDraftBody,
        }),
      "审核结果已提交",
      409
    );
  }
});

test("treats any finalizedAt field as submitted", () => {
  assertSubmissionError(
    () =>
      applyReviewSubmission({
        manifest,
        current: { ...pending, status: "draft", finalizedAt: "" },
        reviewerUserId: "user-admin",
        now: "2026-07-15T01:00:00.000Z",
        body: validDraftBody,
      }),
    "审核结果已提交",
    409
  );
});

test("rejects duplicate issue types", () => {
  assertSubmissionError(
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
              issueTypes: ["ocr_error", "ocr_error"],
              comment: "OCR 重复文本",
            },
          ],
        },
      }),
    "问题类型重复",
    400
  );
});

test("finalizes all-passed focus items and strips passed-only details", () => {
  const now = "2026-07-15T01:00:00.000Z";
  const result = applyReviewSubmission({
    manifest,
    current: pending,
    reviewerUserId: " user-admin ",
    now,
    body: {
      action: "finalize",
      items: [
        {
          auditItemId: "obj:a",
          status: "passed",
          issueTypes: ["ocr_error"],
          comment: "should be removed",
        },
        {
          auditItemId: "obj:b",
          status: "passed",
          issueTypes: [],
          comment: "",
        },
      ],
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.finalizedAt, now);
  assert.equal(result.reviewerUserId, "user-admin");
  assert.deepEqual(result.items[0]?.issueTypes, []);
  assert.equal(result.items[0]?.comment, "");
});

test("finalizes reviewed focus items with issues_found when an issue exists", () => {
  const now = "2026-07-15T01:00:00.000Z";
  const result = applyReviewSubmission({
    manifest,
    current: pending,
    reviewerUserId: "user-admin",
    now,
    body: {
      action: "finalize",
      items: [
        {
          auditItemId: "obj:a",
          status: "issue",
          issueTypes: ["source_location_error"],
          comment: "定位错误",
        },
        {
          auditItemId: "obj:b",
          status: "passed",
          issueTypes: [],
          comment: "",
        },
      ],
    },
  });

  assert.equal(result.status, "issues_found");
  assert.equal(result.finalizedAt, now);
});

test("rejects unknown and duplicate audit item ids", () => {
  for (const items of [
    [{ auditItemId: "obj:unknown", status: "passed" }],
    [
      { auditItemId: "obj:a", status: "passed" },
      { auditItemId: "obj:a", status: "passed" },
    ],
  ]) {
    assertSubmissionError(
      () =>
        applyReviewSubmission({
          manifest,
          current: pending,
          reviewerUserId: "user-admin",
          now: "2026-07-15T01:00:00.000Z",
          body: { action: "save_draft", items },
        }),
      "审核项不存在或重复",
      400
    );
  }
});

test("rejects comments longer than 2000 characters", () => {
  assertSubmissionError(
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
              issueTypes: ["other"],
              comment: "x".repeat(2001),
            },
          ],
        },
      }),
    "备注不能超过 2000 字",
    400
  );
});

test("blocks review submission when artifact integrity fails", () => {
  assert.deepEqual(
    evaluateReviewAvailability({
      integrityOk: false,
      sourceMatches: false,
      status: "passed",
      requesterUserId: "user-admin",
      finalizedAt: "2026-07-15T01:00:00.000Z",
    }),
    { canSubmit: false, error: "审核副本完整性校验失败" }
  );
});

test("blocks review submission when the source file changed", () => {
  assert.deepEqual(
    evaluateReviewAvailability({
      integrityOk: true,
      sourceMatches: false,
      status: "pending",
      requesterUserId: "user-admin",
    }),
    { canSubmit: false, error: "原文件已变化，旧快照不能提交" }
  );
});

test("blocks review submission after the result is finalized", () => {
  assert.deepEqual(
    evaluateReviewAvailability({
      integrityOk: true,
      sourceMatches: true,
      status: "draft",
      requesterUserId: "user-admin",
      finalizedAt: "2026-07-15T01:00:00.000Z",
    }),
    { canSubmit: false, error: "审核结果已提交" }
  );
});

test("allows review submission when all availability checks pass", () => {
  assert.deepEqual(
    evaluateReviewAvailability({
      integrityOk: true,
      sourceMatches: true,
      status: "pending",
      requesterUserId: "user-admin",
    }),
    { canSubmit: true }
  );
});

test("treats terminal review statuses as submitted without finalizedAt", () => {
  for (const status of ["passed", "issues_found"] as const) {
    assert.deepEqual(
      evaluateReviewAvailability({
        integrityOk: true,
        sourceMatches: true,
        status,
        requesterUserId: "user-admin",
      }),
      { canSubmit: false, error: "审核结果已提交" }
    );
  }
});

test("blocks a reviewer from submitting another user's draft", () => {
  assert.deepEqual(
    evaluateReviewAvailability({
      integrityOk: true,
      sourceMatches: true,
      status: "draft",
      reviewerUserId: " user-admin ",
      requesterUserId: " user-manager-tod ",
    }),
    { canSubmit: false, error: "审核草稿已由其他用户领取" }
  );
});

test("allows a draft owner to continue reviewing", () => {
  assert.deepEqual(
    evaluateReviewAvailability({
      integrityOk: true,
      sourceMatches: true,
      status: "draft",
      reviewerUserId: " user-admin ",
      requesterUserId: " user-admin ",
    }),
    { canSubmit: true }
  );
});
