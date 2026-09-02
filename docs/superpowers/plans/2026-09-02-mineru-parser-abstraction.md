# MinerU Parser Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不部署 MinerU、不增加外部依赖的前提下，为 PDF 解析建立统一契约、Native 适配器和明确的 MinerU 后端占位。

**Architecture:** 新增一个只返回现有 `Block[]` 的 `DocumentParser` 契约，由 Native 适配器封装 `extractBlocksWithTables`，并由 `parseDocument` 统一选择后端。初次摄取与表格重处理均改用该入口；默认和唯一可运行实现仍为 Native，选择 `mineru` 时返回明确的 unavailable 错误。

**Tech Stack:** TypeScript 5.6、Node.js 24 `node:test`、Next.js 14、现有 PDF.js 表格解析链路。

## Global Constraints

- 默认解析后端必须是 `native`，未设置 `DOCUMENT_PARSER` 时行为与当前版本一致。
- `Block[]`、`TableModel`、`processDocument`、RagTable 和 RAG 公共结构不得改变。
- `mineru` 仅作为已知但未实现的后端值；本阶段不发起任何外部网络请求。
- 不安装或启动 MinerU、Python、Docker、WSL 或 GPU 环境。
- 不增加生产或开发依赖。
- 非 PDF 文档继续使用现有 `extractText`。
- 配置错误、后端不可用和 Native 执行错误不得被静默吞掉或自动回退。

---

## File Map

- Create `lib/parse/documentParser.ts`: 解析器后端、输入输出、接口及类型化错误。
- Create `lib/parse/nativeDocumentParser.ts`: 对现有 `extractBlocksWithTables` 的薄适配器。
- Create `lib/parse/parseDocument.ts`: 配置解析、后端选择和统一调用入口。
- Create `tests/documentParser.test.ts`: 后端选择、错误分类和适配器委托测试。
- Modify `tests/index.ts`: 将新测试加入单进程测试入口。
- Modify `.env.example`: 记录默认 Native 和 MinerU 未启用的配置语义。
- Modify `lib/workflow/ingestionTrace.ts`: 在内容解析审计中记录实际 PDF 解析后端。
- Modify `tests/workflowIngestion.test.ts`: 验证审计输出包含 `native` 后端。
- Modify `app/api/documents/[id]/process/route.ts`: PDF 初次摄取改用统一解析入口。
- Modify `lib/reprocess/tableReprocessRuntime.ts`: PDF 表格重处理改用统一解析入口。

---

### Task 1: DocumentParser 契约、Native 适配器与路由

**Files:**
- Create: `lib/parse/documentParser.ts`
- Create: `lib/parse/nativeDocumentParser.ts`
- Create: `lib/parse/parseDocument.ts`
- Create: `tests/documentParser.test.ts`
- Modify: `tests/index.ts:1-80`
- Modify: `.env.example:1-58`

**Interfaces:**
- Consumes: `extractBlocksWithTables(buffer: Buffer): Promise<Block[]>` from `lib/parse/tablesSidecar.ts`.
- Produces: `DocumentParserBackend`, `ParseDocumentInput`, `ParseDocumentResult`, `DocumentParser`, `DocumentParserConfigurationError`, `DocumentParserUnavailableError`, `nativeDocumentParser`, `resolveDocumentParser()`, and `parseDocument()`.

- [ ] **Step 1: Write the failing parser-selection tests**

Create `tests/documentParser.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run:

```powershell
node --experimental-strip-types tests/documentParser.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/parse/documentParser.ts` or `lib/parse/parseDocument.ts`.

- [ ] **Step 3: Add the parser contract and typed errors**

Create `lib/parse/documentParser.ts`:

```ts
import type { Block } from "../types.ts";

export type DocumentParserBackend = "native" | "mineru";

export interface ParseDocumentInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

export interface ParseDocumentResult {
  blocks: Block[];
  backend: DocumentParserBackend;
}

export interface DocumentParser {
  readonly backend: DocumentParserBackend;
  parse(input: ParseDocumentInput): Promise<ParseDocumentResult>;
}

export class DocumentParserConfigurationError extends Error {
  readonly code = "document_parser_configuration_error";

  constructor(readonly configuredBackend: string) {
    super(`Unsupported document parser backend: ${configuredBackend}`);
    this.name = "DocumentParserConfigurationError";
  }
}

export class DocumentParserUnavailableError extends Error {
  readonly code = "document_parser_unavailable";

  constructor(readonly backend: DocumentParserBackend) {
    super(`Document parser backend is unavailable: ${backend}`);
    this.name = "DocumentParserUnavailableError";
  }
}
```

- [ ] **Step 4: Add the Native adapter**

Create `lib/parse/nativeDocumentParser.ts`:

```ts
import type { DocumentParser } from "./documentParser.ts";
import { extractBlocksWithTables } from "./tablesSidecar.ts";

export const nativeDocumentParser: DocumentParser = {
  backend: "native",
  async parse(input) {
    return {
      blocks: await extractBlocksWithTables(input.buffer),
      backend: "native",
    };
  },
};
```

- [ ] **Step 5: Add strict backend selection and the unified entry point**

Create `lib/parse/parseDocument.ts`:

```ts
import {
  DocumentParserConfigurationError,
  DocumentParserUnavailableError,
  type DocumentParser,
  type ParseDocumentInput,
  type ParseDocumentResult,
} from "./documentParser.ts";
import { nativeDocumentParser } from "./nativeDocumentParser.ts";

export interface ParseDocumentOptions {
  backend?: string;
  parser?: DocumentParser;
}

export function resolveDocumentParser(
  configuredBackend: string | undefined,
  nativeParser: DocumentParser = nativeDocumentParser
): DocumentParser {
  const backend = (configuredBackend ?? "native").trim().toLowerCase() || "native";
  if (backend === "native") return nativeParser;
  if (backend === "mineru") {
    throw new DocumentParserUnavailableError("mineru");
  }
  throw new DocumentParserConfigurationError(configuredBackend ?? backend);
}

export async function parseDocument(
  input: ParseDocumentInput,
  options: ParseDocumentOptions = {}
): Promise<ParseDocumentResult> {
  const parser =
    options.parser ??
    resolveDocumentParser(options.backend ?? process.env.DOCUMENT_PARSER);
  return parser.parse(input);
}
```

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```powershell
node --experimental-strip-types tests/documentParser.test.ts
```

Expected: 5 tests PASS and 0 tests FAIL.

- [ ] **Step 7: Register the test and document the environment setting**

Add this import near the other parsing tests in `tests/index.ts`:

```ts
import "./documentParser.test.ts";
```

Append this section to `.env.example`:

```dotenv
# ── PDF 文档解析后端（默认 native）──
# 当前 Demo 仅启用 native；mineru 是预留值，选择后会明确报告服务未接入。
# DOCUMENT_PARSER=native
```

- [ ] **Step 8: Run the complete test entry and commit Task 1**

Run:

```powershell
npm test
```

Expected: all imported tests PASS, including the 5 `document parser` tests.

Commit only Task 1 files:

```powershell
git add -- .env.example lib/parse/documentParser.ts lib/parse/nativeDocumentParser.ts lib/parse/parseDocument.ts tests/documentParser.test.ts tests/index.ts
git commit -m "feat: add document parser abstraction"
```

---

### Task 2: 摄取审计与两条 PDF 调用链迁移

**Files:**
- Modify: `lib/workflow/ingestionTrace.ts:1-67`
- Modify: `tests/workflowIngestion.test.ts:1-88`
- Modify: `app/api/documents/[id]/process/route.ts:1-158`
- Modify: `lib/reprocess/tableReprocessRuntime.ts:1-80`

**Interfaces:**
- Consumes: `parseDocument(input: ParseDocumentInput): Promise<ParseDocumentResult>` and `DocumentParserBackend` from Task 1.
- Produces: ingestion audit output field `parserBackend`, plus initial ingestion and reprocessing callers that no longer import `extractBlocksWithTables` directly.

- [ ] **Step 1: Extend the existing audit test with the expected backend**

In `tests/workflowIngestion.test.ts`, add the type import:

```ts
import type { DocumentParserBackend } from "../lib/parse/documentParser.ts";
```

Change the `recordContentParsing` input in `content parsing records block and table counts for PDF IR` to:

```ts
  recordContentParsing(
    recorder,
    {
      fileName: "公共服务设施标准.pdf",
      extractedChars: 18,
      blocks,
      parserBackend: "native" satisfies DocumentParserBackend,
    },
    "2026-07-14T10:00:00.250Z"
  );
```

Add this assertion after the existing `tableCount` assertion:

```ts
  assert.equal(step.outputSummary?.parserBackend, "native");
```

- [ ] **Step 2: Run the focused audit test and verify it fails**

Run:

```powershell
node --experimental-strip-types tests/workflowIngestion.test.ts
```

Expected: FAIL because `step.outputSummary.parserBackend` is `undefined`.

- [ ] **Step 3: Record the actual parser backend in ingestion traces**

In `lib/workflow/ingestionTrace.ts`, add:

```ts
import type { DocumentParserBackend } from "../parse/documentParser.ts";
```

Extend the `recordContentParsing` input type:

```ts
  input: {
    fileName: string;
    extractedChars: number;
    blocks?: Block[];
    text?: string;
    parserBackend?: DocumentParserBackend;
  },
```

Extend `outputSummary` without emitting an undefined field for non-PDF files:

```ts
      outputSummary: {
        parseMode: input.blocks ? "block_ir" : "plain_text",
        ...(input.parserBackend
          ? { parserBackend: input.parserBackend }
          : {}),
        blockTypes,
        textLength: input.text?.length ?? 0,
      },
```

- [ ] **Step 4: Run the focused audit test and verify it passes**

Run:

```powershell
node --experimental-strip-types tests/workflowIngestion.test.ts
```

Expected: 2 tests PASS and 0 tests FAIL.

- [ ] **Step 5: Route initial PDF ingestion through `parseDocument`**

In `app/api/documents/[id]/process/route.ts`, remove:

```ts
import { extractBlocksWithTables } from "@/lib/parse/tablesSidecar";
```

Add:

```ts
import { parseDocument } from "@/lib/parse/parseDocument";
import type { DocumentParserBackend } from "@/lib/parse/documentParser";
```

Beside `blocks` and `text`, declare the actual backend:

```ts
    let blocks: Block[] | undefined;
    let text: string | undefined;
    let parserBackend: DocumentParserBackend | undefined;
    let extractedChars = 0;
```

Replace the PDF branch with:

```ts
    if (doc.fileName.toLowerCase().endsWith(".pdf")) {
      const parsed = await parseDocument({
        buffer: buf,
        fileName: doc.fileName,
        mimeType: "application/pdf",
      });
      blocks = parsed.blocks;
      parserBackend = parsed.backend;
      extractedChars = blocks.reduce(
        (sum, block) => sum + block.normalizedText.length,
        0
      );
    } else {
      text = await extractText(buf, doc.fileName);
      extractedChars = text.length;
    }
```

Pass the backend into the existing trace call:

```ts
    recordContentParsing(recorder, {
      fileName: doc.fileName,
      extractedChars,
      blocks,
      text,
      parserBackend,
    });
```

- [ ] **Step 6: Route PDF table reprocessing through the same entry point**

In `lib/reprocess/tableReprocessRuntime.ts`, remove:

```ts
import { extractBlocksWithTables } from "../parse/tablesSidecar.ts";
```

Add:

```ts
import { parseDocument } from "../parse/parseDocument.ts";
```

Replace the PDF branch inside `buildDocumentIndex` with:

```ts
  if (document.fileName.toLowerCase().endsWith(".pdf")) {
    const parsed = await parseDocument({
      buffer: sourceBuffer,
      fileName: document.fileName,
      mimeType: "application/pdf",
    });
    input = { blocks: parsed.blocks };
  } else {
    input = { text: await extractText(sourceBuffer, document.fileName) };
  }
```

- [ ] **Step 7: Verify no production caller bypasses the parser abstraction**

Run:

```powershell
rg -n "extractBlocksWithTables" app lib
```

Expected: only the function declaration in `lib/parse/tablesSidecar.ts` and the import/call in `lib/parse/nativeDocumentParser.ts`; no route or reprocess runtime match.

- [ ] **Step 8: Run type checking and all automated tests**

Run:

```powershell
npx tsc --noEmit
npm test
```

Expected: both commands exit with code 0; all tests PASS.

- [ ] **Step 9: Commit Task 2**

```powershell
git add -- 'app/api/documents/[id]/process/route.ts' lib/reprocess/tableReprocessRuntime.ts lib/workflow/ingestionTrace.ts tests/workflowIngestion.test.ts
git commit -m "refactor: route pdf parsing through adapter"
```

---

### Task 3: Production-build verification and final scope audit

**Files:**
- Verify only; no planned source modifications.

**Interfaces:**
- Consumes: all Task 1 and Task 2 outputs.
- Produces: evidence that the Next.js server bundle resolves the new TypeScript modules and that the change stayed within the approved Demo scope.

- [ ] **Step 1: Run the production build**

Run:

```powershell
npm run build
```

Expected: Next.js build completes successfully with exit code 0.

- [ ] **Step 2: Verify no MinerU network client or dependency was added**

Run:

```powershell
git diff e3e5711..HEAD -- package.json package-lock.json
rg -n "MINERU_BASE_URL|/file_parse|fetch\(" lib/parse app/api/documents
```

Expected:

- no dependency diff in `package.json` or `package-lock.json`;
- no `MINERU_BASE_URL`, `/file_parse`, or new MinerU `fetch()` implementation;
- `DOCUMENT_PARSER=mineru` remains an explicit unavailable path only.

- [ ] **Step 3: Inspect the final scoped diff and working tree**

Run:

```powershell
git diff --check e3e5711..HEAD
git diff --stat e3e5711..HEAD
git status --short --branch
```

Expected:

- `git diff --check` exits with code 0;
- tracked changes since the design commit are limited to the files listed in this plan plus this plan document;
- pre-existing untracked logs, backups, plans, and evaluation files remain untouched.

No additional commit is needed when verification finds no source change. If verification requires a source fix, repeat the smallest relevant focused test, then commit only that fix with a message describing the root cause.

---

## Completion Criteria

- `DOCUMENT_PARSER` unset or `native` uses the existing table-aware Native PDF parser.
- `DOCUMENT_PARSER=mineru` fails with `DocumentParserUnavailableError` and does not make a network request.
- Unknown backend values fail with `DocumentParserConfigurationError`.
- Initial PDF ingestion and PDF table reprocessing both call `parseDocument`.
- PDF ingestion trace exposes `parserBackend: "native"`.
- Non-PDF extraction remains on `extractText`.
- No package dependency or MinerU runtime was added.
- Focused tests, complete tests, TypeScript type checking, and production build all pass.
