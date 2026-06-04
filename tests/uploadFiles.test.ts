import assert from "node:assert/strict";
import test from "node:test";
import { getUploadFiles } from "../lib/documents/uploadForm.ts";

test("reads every selected upload file from multipart form data", () => {
  const form = new FormData();
  form.append("file", new File(["a"], "a.txt", { type: "text/plain" }));
  form.append("file", new File(["b"], "b.txt", { type: "text/plain" }));

  const files = getUploadFiles(form);

  assert.deepEqual(
    files.map((file) => file.name),
    ["a.txt", "b.txt"]
  );
});
