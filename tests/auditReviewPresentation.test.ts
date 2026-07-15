import assert from "node:assert/strict";
import test from "node:test";

import { reviewStatusMeta } from "../lib/audit/reviewPresentation.ts";

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
