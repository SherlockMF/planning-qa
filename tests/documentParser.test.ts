import assert from "node:assert/strict";
import test from "node:test";

import type { Block } from "../lib/types.ts";
import {
  DocumentParserConfigurationError,
  DocumentParserUnavailableError,
  type DocumentParser,
  type ParseDocumentInput,
} from "../lib/parse/documentParser.ts";
import {
  parseDocument,
  resolveDocumentParser,
} from "../lib/parse/parseDocument.ts";

const paragraph: Block = {
  type: "paragraph",
  pageStart: 1,
  pageEnd: 1,
  rawText: "演示内容",
  normalizedText: "演示内容",
};

const fakeNative: DocumentParser = {
  backend: "native",
  async parse() {
    return { blocks: [paragraph], backend: "native" };
  },
};

const input: ParseDocumentInput = {
  buffer: Buffer.from("pdf"),
  fileName: "demo.pdf",
  mimeType: "application/pdf",
};

test("document parser defaults to native when configuration is absent", () => {
  assert.equal(resolveDocumentParser(undefined, fakeNative), fakeNative);
  assert.equal(resolveDocumentParser("  ", fakeNative), fakeNative);
});

test("document parser accepts an explicit native backend", () => {
  assert.equal(resolveDocumentParser("native", fakeNative), fakeNative);
  assert.equal(resolveDocumentParser(" NATIVE ", fakeNative), fakeNative);
});

test("document parser reports the reserved MinerU backend as unavailable", () => {
  assert.throws(
    () => resolveDocumentParser("mineru", fakeNative),
    (error) =>
      error instanceof DocumentParserUnavailableError &&
      error.code === "document_parser_unavailable" &&
      error.backend === "mineru"
  );
});

test("document parser rejects unknown backend names", () => {
  assert.throws(
    () => resolveDocumentParser("mineru-local", fakeNative),
    (error) =>
      error instanceof DocumentParserConfigurationError &&
      error.code === "document_parser_configuration_error"
  );
});

test("parseDocument delegates to an injected parser and preserves Block output", async () => {
  let received: ParseDocumentInput | undefined;
  const parser: DocumentParser = {
    backend: "native",
    async parse(nextInput) {
      received = nextInput;
      return { blocks: [paragraph], backend: "native" };
    },
  };

  const result = await parseDocument(input, { parser });

  assert.equal(received, input);
  assert.equal(result.backend, "native");
  assert.deepEqual(result.blocks, [paragraph]);
});
