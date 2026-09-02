import test from "node:test";
import assert from "node:assert/strict";

import { usesDedicatedRouteShell } from "../lib/knowledge/routeShell.ts";

test("dedicated route shells match only qa and lab route segments", () => {
  for (const pathname of ["/qa", "/qa/documents", "/lab", "/lab/evaluation"]) {
    assert.equal(usesDedicatedRouteShell(pathname), true, pathname);
  }

  for (const pathname of ["/", "/documents", "/quality", "/laboratory"]) {
    assert.equal(usesDedicatedRouteShell(pathname), false, pathname);
  }
});
