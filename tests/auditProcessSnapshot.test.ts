import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";

const projectRoot = path.resolve(import.meta.dirname, "..");
const projectLibUrl = pathToFileURL(`${path.join(projectRoot, "lib")}${path.sep}`)
  .href;
const moduleWithHooks = nodeModule as unknown as {
  registerHooks(input: {
    resolve(
      specifier: string,
      context: { parentURL?: string },
      nextResolve: (
        specifier: string,
        context: { parentURL?: string }
      ) => unknown
    ): unknown;
  }): unknown;
};

moduleWithHooks.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const resolved = path.resolve(projectRoot, specifier.slice(2));
      const target = path.extname(resolved) ? resolved : `${resolved}.ts`;
      return nextResolve(pathToFileURL(target).href, context);
    }
    if (
      specifier.startsWith(".") &&
      !path.extname(specifier) &&
      context.parentURL?.startsWith(projectLibUrl)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

test("uses cleaned block numbering for audit source excerpts", async () => {
  const [{ buildChunksWithObjects }, { buildAuditReviewItems }, chunksModule] =
    await Promise.all([
      import("../lib/rag/chunk.ts"),
      import("../lib/audit/reviewItems.ts"),
      import("../lib/db/chunks.ts"),
    ]);
  const document = {
    id: "doc-cleaned-source",
    fileName: "cleaned-source.txt",
    city: "测试城市",
    fileType: "其他" as const,
    enabled: true,
    status: "indexed" as const,
    createdAt: "2026-07-15T00:00:00.000Z",
  };
  const sourceText =
    "本标准适用于企业知识库审核流程，正文内容需要保留并可追溯到清洗后的来源块。";
  const buildResult = buildChunksWithObjects(document, {
    blocks: [
      {
        type: "paragraph",
        pageStart: 1,
        pageEnd: 1,
        rawText: "- 1 -",
        normalizedText: "- 1 -",
      },
      {
        type: "paragraph",
        pageStart: 1,
        pageEnd: 1,
        rawText: sourceText,
        normalizedText: sourceText,
      },
    ],
  });
  assert.equal(buildResult.blocks[0]?.normalizedText, "- 1 -");
  assert.equal(buildResult.cleanedBlocks[0]?.normalizedText, sourceText);
  assert.ok(buildResult.knowledgeObjects.length > 0);

  const chunks = buildResult.drafts.map((draft, index) => ({
    ...draft,
    fileName: document.fileName,
    city: document.city,
    embedding: [index],
    createdAt: "2026-07-15T00:00:00.000Z",
  }));
  const processed = chunksModule.buildProcessDocumentResult(
    buildResult,
    chunks,
    []
  );
  const items = buildAuditReviewItems(processed.auditSnapshot);
  const traced = items.find((item) => item.sourceBlockIds.includes("block-0"));

  assert.equal(traced?.sourceExcerpt, sourceText);
  assert.doesNotMatch(traced?.sourceExcerpt ?? "", /- 1 -/);
});

function withBlockedPersistWrites(
  failOn: "chunks.json" | "schema.json" | "ragtables.json",
  run: () => void
): void {
  const originalWriteFileSync = fs.writeFileSync;
  const originalConsoleError = console.error;
  fs.writeFileSync = ((target: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    const fileName = path.basename(String(target));
    if (fileName === failOn) throw new Error(`blocked ${fileName}`);
    if (["chunks.json", "schema.json", "ragtables.json"].includes(fileName)) {
      return;
    }
    return (originalWriteFileSync as (...values: unknown[]) => void)(
      target,
      ...args
    );
  }) as typeof fs.writeFileSync;
  console.error = () => undefined;
  try {
    run();
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    console.error = originalConsoleError;
  }
}

test("strict chunk persistence propagates chunk and schema write failures", async () => {
  const persist = await import("../lib/db/persist.ts");

  for (const fileName of ["chunks.json", "schema.json"] as const) {
    withBlockedPersistWrites(fileName, () => {
      assert.throws(() => persist.saveChunksStrict([]), new RegExp(fileName));
      assert.doesNotThrow(() => persist.saveChunks([]));
    });
  }
});

test("strict RagTable persistence propagates write failures", async () => {
  const persist = await import("../lib/db/persist.ts");

  withBlockedPersistWrites("ragtables.json", () => {
    assert.throws(
      () => persist.saveRagTablesStrict([]),
      /blocked ragtables\.json/
    );
    assert.doesNotThrow(() => persist.saveRagTables([]));
  });
});

test("strict document RagTable replacement propagates persistence failures", async () => {
  const [{ replaceRagTablesForDocStrict }, { getStore }] = await Promise.all([
    import("../lib/db/ragTables.ts"),
    import("../lib/db/store.ts"),
  ]);
  const store = getStore();
  const originalTables = store.ragTables;

  try {
    withBlockedPersistWrites("ragtables.json", () => {
      assert.throws(
        () => replaceRagTablesForDocStrict("doc-strict-test", []),
        /blocked ragtables\.json/
      );
    });
  } finally {
    store.ragTables = originalTables;
  }
});
