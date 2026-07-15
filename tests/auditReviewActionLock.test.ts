import assert from "node:assert/strict";
import test from "node:test";

import {
  releaseReviewActionLock,
  tryAcquireReviewActionLock,
} from "../lib/audit/reviewActionLock.ts";

test("acquires a review action lock synchronously until it is released", () => {
  const lock = { current: false };

  assert.equal(tryAcquireReviewActionLock(lock), true);
  assert.equal(tryAcquireReviewActionLock(lock), false);

  releaseReviewActionLock(lock);

  assert.equal(tryAcquireReviewActionLock(lock), true);
});
