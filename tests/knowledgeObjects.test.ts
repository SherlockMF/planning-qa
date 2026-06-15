import test from "node:test";
import assert from "node:assert/strict";

import type { Block, DocProfile, Document } from "../lib/types.ts";
import { buildSectionTree } from "../lib/rag/sectionTree.ts";
import { extractKnowledgeObjects } from "../lib/rag/normalizers/index.ts";
import { buildRetrievalChunksFromObjects } from "../lib/rag/chunk.ts";
import {
  buildExactIndex,
  exactSearchChunks,
} from "../lib/rag/retrieval/exactIndex.ts";
import { analyzeQuery, topKForQuerySignals } from "../lib/rag/retrieval/searchSignals.ts";
import {
  renderChunkAnswerContext,
  renderTableSubset,
} from "../lib/rag/retrieval/renderAnswerContext.ts";
import { extractSourceVersionInfo } from "../lib/rag/version.ts";
import { rerank } from "../lib/rag/rerank.ts";
import { buildRagTablesFromChunks, buildRagTablesFromObjects } from "../lib/rag/ragTable.ts";
import { expandHit } from "../lib/rag/expand.ts";
import type { Chunk, RetrievedChunk } from "../lib/types.ts";
import { buildContextBlock, MockLLMProvider, toContextChunk } from "../lib/ai/llm.ts";

const doc: Document = {
  id: "doc-test",
  fileName: "通用标准.txt",
  city: "测试城市",
  fileType: "其他",
  enabled: true,
  status: "indexed",
  createdAt: "2026-06-04T00:00:00.000Z",
};

const profile: DocProfile = {
  docTitle: "通用标准",
  docTypeCandidates: ["technical_standard"],
  hasClauseNumbers: true,
  hasChapterStructure: true,
  hasTables: true,
  hasLargeTables: false,
  hasCodeTable: true,
  hasDefinitions: true,
  hasDeliverableList: true,
  hasProcedureSteps: true,
  hasScannedPages: false,
  headingPatternsDetected: ["chapter", "article"],
  tableCount: 2,
  estimatedPageCount: 4,
};

function block(
  type: Block["type"],
  normalizedText: string,
  extra: Partial<Block> = {}
): Block {
  return {
    type,
    pageStart: extra.pageStart ?? 1,
    pageEnd: extra.pageEnd ?? extra.pageStart ?? 1,
    rawText: normalizedText,
    normalizedText,
    ...extra,
  };
}

const blocks: Block[] = [
  block("heading", "第一章 总则", {
    level: 2,
    headingPattern: "chapter",
    pageStart: 1,
  }),
  block("heading", "第1条 适用范围", {
    level: 4,
    headingPattern: "article",
    pageStart: 1,
  }),
  block("paragraph", "本标准适用于公共服务设施配置。居住社区应配置社区服务站，不得擅自减少必配设施。", {
    pageStart: 1,
  }),
  block("heading", "术语和定义", {
    level: 3,
    headingPattern: "section",
    pageStart: 2,
  }),
  block("paragraph", "社区服务站是指为居民提供公共服务的基层服务设施。", {
    pageStart: 2,
  }),
  block("table", "表1 分类代码表", {
    pageStart: 3,
    pageEnd: 3,
    table: {
      tableId: "tbl-code",
      title: "表1 分类代码表",
      headers: ["代码", "名称", "内容"],
      rows: [
        ["A1", "公共管理", "行政办公等设施"],
        ["A11", "行政办公", "党政机关办公设施"],
      ],
      markdown: "",
    },
  }),
  block("table_row", "A1 公共管理 行政办公等设施", {
    pageStart: 3,
    rowCells: ["A1", "公共管理", "行政办公等设施"],
  }),
  block("table_row", "A11 行政办公 党政机关办公设施", {
    pageStart: 3,
    rowCells: ["A11", "行政办公", "党政机关办公设施"],
  }),
  block("table", "表2 配置指标表", {
    pageStart: 4,
    pageEnd: 4,
    table: {
      tableId: "tbl-indicator",
      title: "表2 配置指标表",
      headers: ["层级", "设施名称", "建筑面积(平方米/处)", "服务规模"],
      rows: [["居住社区级", "社区服务站", "1200-1500", "每个社区1处"]],
      markdown: "",
    },
  }),
  block("table_row", "居住社区级 社区服务站 1200-1500 每个社区1处", {
    pageStart: 4,
    rowCells: ["居住社区级", "社区服务站", "1200-1500", "每个社区1处"],
  }),
];

test("extracts government-rag knowledge objects before retrieval chunks", () => {
  const sectionTree = buildSectionTree(blocks);
  const objects = extractKnowledgeObjects({
    docId: doc.id,
    blocks,
    sectionTree,
    tables: [],
    profile,
  });

  const types = objects.map((o) => o.objectType);
  assert.ok(types.includes("structured_table"));
  assert.ok(types.includes("structured_table_row"));
  assert.ok(types.includes("classification_code"));
  assert.ok(types.includes("indicator_item"));
  assert.ok(types.includes("regulation_clause"));
  assert.ok(types.includes("definition"));
  assert.ok(types.includes("requirement"));
  assert.ok(types.includes("plain_section"));

  const code = objects.find((o) => o.objectType === "classification_code");
  assert.equal(code && "code" in code ? code.code : undefined, "A1");

  const indicator = objects.find((o) => o.objectType === "indicator_item");
  assert.equal(indicator && "itemName" in indicator ? indicator.itemName : undefined, "社区服务站");

  const chunks = buildRetrievalChunksFromObjects(doc, objects, profile);
  assert.ok(chunks.length >= objects.length);
  assert.ok(chunks.some((c) => c.objectType === "classification_code" && c.code === "A1"));
  assert.ok(chunks.some((c) => c.objectType === "indicator_item" && c.itemName === "社区服务站"));
  assert.ok(chunks.some((c) => c.objectType === "structured_table" && c.chunkRole === "parent"));
  assert.ok(chunks.some((c) => c.objectType === "structured_table" && c.chunkRole === "summary"));
  assert.ok(chunks.some((c) => c.objectType === "structured_table_row" && c.chunkRole === "atomic"));
  assert.ok(chunks.every((c) => c.embeddingText && c.bm25Text && c.displayText));

  const exact = buildExactIndex(objects);
  assert.ok(exact.some((entry) => entry.normalizedKey === "a1"));
  assert.ok(exact.some((entry) => entry.key === "社区服务站"));

  const signals = analyzeQuery("社区服务站必须配置多少建筑面积？");
  assert.equal(signals.asksIndicator, true);
  assert.equal(signals.asksObligation, true);

  const tableMarkdown = renderTableSubset(
    objects.filter((o) => o.objectType === "structured_table_row")
  );
  assert.ok(tableMarkdown.includes("| 代码 | 名称 | 内容 |"));
  assert.ok(tableMarkdown.includes("| A1 | 公共管理 | 行政办公等设施 |"));
});

test("extracts deliverable, drawing, checklist, and procedure objects from section context", () => {
  const workflowBlocks: Block[] = [
    block("heading", "成果要求", { level: 2, headingPattern: "chapter", pageStart: 1 }),
    block("table", "表3 成果要求表", {
      pageStart: 1,
      table: {
        tableId: "tbl-deliverable",
        title: "表3 成果要求表",
        headers: ["阶段", "成果名称", "成果类型", "是否必选", "要求"],
        rows: [
          ["方案阶段", "规划说明书", "文本", "必选", "应包括现状分析和规划方案"],
          ["方案阶段", "用地规划图", "图纸", "必选", "标明用地性质、边界、代码和比例尺"],
        ],
        markdown: "",
      },
    }),
    block("table_row", "方案阶段 规划说明书 文本 必选 应包括现状分析和规划方案", {
      pageStart: 1,
      rowCells: ["方案阶段", "规划说明书", "文本", "必选", "应包括现状分析和规划方案"],
    }),
    block("table_row", "方案阶段 用地规划图 图纸 必选 标明用地性质、边界、代码和比例尺", {
      pageStart: 1,
      rowCells: ["方案阶段", "用地规划图", "图纸", "必选", "标明用地性质、边界、代码和比例尺"],
    }),
    block("heading", "任务清单", { level: 2, headingPattern: "chapter", pageStart: 2 }),
    block("list_item", "1、提交基础资料", { pageStart: 2, listMarker: "1、" }),
    block("heading", "编制流程", { level: 2, headingPattern: "chapter", pageStart: 3 }),
    block("list_item", "1、开展资料收集", { pageStart: 3, listMarker: "1、" }),
  ];
  const sectionTree = buildSectionTree(workflowBlocks);
  const objects = extractKnowledgeObjects({
    docId: doc.id,
    blocks: workflowBlocks,
    sectionTree,
    tables: [],
    profile,
  });
  const types = objects.map((o) => o.objectType);

  assert.ok(types.includes("deliverable_requirement"));
  assert.ok(types.includes("drawing_requirement"));
  assert.ok(types.includes("checklist_item"));
  assert.ok(types.includes("procedure_step"));

  const drawing = objects.find((o) => o.objectType === "drawing_requirement");
  assert.equal(drawing && "drawingName" in drawing ? drawing.drawingName : undefined, "用地规划图");
});

test("version info and query signals influence actual rerank priority", () => {
  const versionBlocks: Block[] = [
    block("paragraph", "某某配置标准 发布日期：2023年6月1日 实施日期：2023年9月1日", {
      pageStart: 1,
    }),
    block("paragraph", "本标准代替《旧版配置标准》，旧版同时废止。", { pageStart: 1 }),
  ];
  const version = extractSourceVersionInfo(versionBlocks, "某某配置标准");
  assert.equal(version.publishDate, "2023-06-01");
  assert.equal(version.effectiveDate, "2023-09-01");
  assert.equal(version.status, "current");
  assert.ok(version.supersedes?.some((item) => item.includes("旧版配置标准")));

  const current = retrieved(chunk("current", {
    chunkType: "requirement",
    objectType: "requirement",
    content: "社区服务站应配置建筑面积1200平方米。",
    normativeLevel: "shall",
    versionInfo: { status: "current", effectiveDate: "2024-01-01" },
  }));
  const old = retrieved(chunk("old", {
    chunkType: "requirement",
    objectType: "requirement",
    content: "社区服务站应配置建筑面积800平方米。",
    normativeLevel: "shall",
    versionInfo: { status: "superseded", effectiveDate: "2020-01-01" },
  }));

  const ranked = rerank([old, current], {
    question: "社区服务站应当配置多少建筑面积？",
    keywords: ["社区服务站", "应当", "建筑面积"],
  });

  assert.equal(ranked[0].chunk.id, "current");
});

test("derived object chunks bind to structured table rows without duplicating RagTable rows", () => {
  const sectionTree = buildSectionTree(blocks);
  const objects = extractKnowledgeObjects({
    docId: doc.id,
    blocks,
    sectionTree,
    tables: [],
    profile,
  });
  const drafts = buildRetrievalChunksFromObjects(doc, objects, profile);
  const chunks: Chunk[] = drafts.map((draft) => ({
    ...draft,
    fileName: doc.fileName,
    city: doc.city,
    createdAt: "2026-06-04T00:00:00.000Z",
  }));

  const tables = buildRagTablesFromChunks(chunks, () => profile.docTitle);
  const codeTable = tables.find((table) => table.tableId === "tbl-code");
  assert.equal(codeTable?.rows.length, 2);

  const codeChunk = chunks.find(
    (item) => item.objectType === "classification_code" && item.code === "A1"
  );
  const rowChunk = chunks.find(
    (item) =>
      item.objectType === "structured_table_row" &&
      item.tableId === "tbl-code" &&
      item.sourceRowIndex === 0
  );
  assert.ok(codeChunk?.rowId);
  assert.equal(codeChunk?.rowId, rowChunk?.rowId);
  assert.equal(codeChunk?.tableType, "code_table");
});

test("builds RagTable directly from structured table objects", () => {
  const sectionTree = buildSectionTree(blocks);
  const objects = extractKnowledgeObjects({
    docId: doc.id,
    blocks,
    sectionTree,
    tables: [],
    profile,
  });
  const chunks: Chunk[] = buildRetrievalChunksFromObjects(doc, objects, profile).map((draft) => ({
    ...draft,
    fileName: doc.fileName,
    city: doc.city,
    createdAt: "2026-06-04T00:00:00.000Z",
  }));

  const tables = buildRagTablesFromObjects(objects, profile.docTitle, chunks);
  const codeTable = tables.find((table) => table.tableId === "tbl-code");

  assert.equal(codeTable?.rows.length, 2);
  assert.deepEqual(codeTable?.columns.map((column) => column.header), ["代码", "名称", "内容"]);
  assert.equal(codeTable?.rows[0]?.cells["代码"], "A1");
  assert.ok(chunks.some((item) => item.objectType === "classification_code" && item.rowId === codeTable?.rows[0]?.rowId));
});

test("LLM context carries structured object metadata without polluting mock conclusion", async () => {
  const c = chunk("code-context", {
    chunkType: "code",
    objectId: "classification-code-A1",
    objectType: "classification_code",
    code: "A1",
    parentCode: "A",
    tableId: "tbl-code",
    tableTitle: "classification table",
    tableType: "code_table",
    sourceRowIndex: 0,
    fields: { code: "A1", name: "Public management" },
    versionInfo: { status: "current", effectiveDate: "2024-01-01" },
    content: "A1 Public management means administrative office facilities.",
  });

  const context = toContextChunk(c, 1);
  assert.ok(context.structuredContext?.includes("objectType=classification_code"));
  assert.ok(context.structuredContext?.includes("code=A1"));
  assert.ok(context.structuredContext?.includes("field.code=A1"));
  assert.ok(buildContextBlock([context]).includes("structured_metadata"));

  const conclusion = await new MockLLMProvider().synthesizeConclusion({
    question: "What does A1 mean?",
    chunks: [context],
  });
  assert.equal(conclusion, c.content);
});

test("renders structured answer context from retrieved object chunks", () => {
  const indicator = chunk("indicator-context", {
    chunkType: "indicator",
    objectType: "indicator_item",
    itemName: "社区服务站",
    tableTitle: "表2 配置指标表",
    fields: {
      层级: "居住社区级",
      设施名称: "社区服务站",
      "建筑面积(平方米/处)": "1200-1500",
      服务规模: "每个社区1处",
    },
    content: "层级：居住社区级。设施名称：社区服务站。建筑面积(平方米/处)：1200-1500。服务规模：每个社区1处",
  });
  const clause = chunk("clause-context", {
    chunkType: "clause",
    objectType: "regulation_clause",
    clauseNo: "第1条",
    normativeLevel: "shall",
    content: "居住社区应配置社区服务站。",
  });

  assert.match(renderChunkAnswerContext(indicator) ?? "", /指标对象：社区服务站/);
  assert.match(renderChunkAnswerContext(indicator) ?? "", /建筑面积\(平方米\/处\)：1200-1500/);
  assert.match(renderChunkAnswerContext(clause) ?? "", /条文：第1条/);
  assert.match(renderChunkAnswerContext(clause) ?? "", /约束等级：shall/);

  const row = chunk("row-context", {
    chunkType: "table_row",
    objectType: "structured_table_row",
    tableTitle: "表1 分类代码表",
    rowKey: "A1",
    fields: { code: "A1", name: "Public management" },
    content: "row text",
  });
  const rowContext = renderChunkAnswerContext(row) ?? "";
  assert.match(rowContext, /\| code \| name \|/);
  assert.match(rowContext, /\| A1 \| Public management \|/);
});

test("exact search recalls chunks by structured metadata keys", () => {
  const codeChunk = chunk("code-a11", {
    chunkType: "code",
    objectId: "obj-a11",
    objectType: "classification_code",
    code: "A11",
    rowKey: "A11 行政办公",
    content: "该片段正文故意不重复查询里的完整代码。",
  });
  const indicatorChunk = chunk("indicator-service", {
    chunkType: "indicator",
    objectId: "obj-service",
    objectType: "indicator_item",
    itemName: "社区服务站",
    content: "配置指标行。",
  });
  const mandatoryChunk = chunk("mandatory-deliverable", {
    chunkType: "deliverable",
    objectId: "obj-mandatory",
    objectType: "deliverable_requirement",
    mandatory: true,
    rowKey: "application form",
    content: "deliverable row",
  });

  const byCode = exactSearchChunks([indicatorChunk, codeChunk], "A11是什么意思？");
  assert.equal(byCode[0]?.chunk.id, "code-a11");
  assert.equal(byCode[0]?.source, "exact");
  assert.ok(byCode[0]?.matchedKeywords.includes("A11"));

  const byItem = exactSearchChunks([codeChunk, indicatorChunk], "社区服务站配置要求");
  assert.equal(byItem[0]?.chunk.id, "indicator-service");

  const byMandatory = exactSearchChunks([codeChunk, mandatoryChunk], "mandatory application form");
  assert.equal(byMandatory[0]?.chunk.id, "mandatory-deliverable");
});

test("dynamic TopK follows query intent and expansion keeps direct hit role", () => {
  assert.equal(topKForQuerySignals(analyzeQuery("A11代码是什么意思？")), 5);
  assert.equal(topKForQuerySignals(analyzeQuery("第1条规定了什么？")), 8);
  assert.equal(topKForQuerySignals(analyzeQuery("是否必须配置社区服务站？")), 10);
  assert.equal(topKForQuerySignals(analyzeQuery("社区服务站指标是多少？")), 12);
  assert.equal(topKForQuerySignals(analyzeQuery("表1中A1和A11两行是什么？")), 20);
  assert.equal(topKForQuerySignals(analyzeQuery("成果清单包括哪些？")), 30);

  const parent = chunk("table-parent", {
    chunkType: "table_full",
    tableId: "tbl",
    tableTitle: "table parent",
    tableHeaders: ["code", "name"],
    content: "parent",
  });
  const seed = retrieved(chunk("table-row", {
    chunkType: "table_row",
    tableId: "tbl",
    tableTitle: "table parent",
    tableHeaders: ["code", "name"],
    parentChunkId: "table-parent",
    content: "A1 row",
  }));
  const expanded = expandHit(seed, new Map([[parent.id, parent], [seed.chunk.id, seed.chunk]]));
  assert.equal(expanded.contextRole, "direct_hit");
  assert.ok(expanded.expandedContextRoles?.includes("expanded_parent"));
});

test("plain sections are demoted unless structured hits are absent", () => {
  const plain = retrieved(chunk("plain", {
    chunkType: "section",
    objectType: "plain_section",
    content: "社区服务站配置要求",
  }));
  const structured = retrieved(chunk("structured", {
    chunkType: "requirement",
    objectType: "requirement",
    content: "社区服务站配置要求",
  }));

  const ranked = rerank([plain, structured], {
    question: "社区服务站配置要求",
    keywords: ["社区服务站", "配置要求"],
  });

  assert.equal(ranked[0].chunk.id, "structured");
});

test("project file name match promotes project-specific chunks over generic policy chunks", () => {
  const generic = retrieved(chunk("generic-green-ratio", {
    documentId: "doc-tech-rule",
    fileName: "控制性详细规划技术规定（演示版）.docx",
    chunkType: "clause",
    content:
      "居住用地的绿地率不应低于百分之三十（30%）。旧区改建的居住用地绿地率可适当降低。",
    sectionPath: "第五章 绿地与公共空间控制",
  }));
  generic.source = "vector";
  generic.keywordScore = 0;
  generic.vectorScore = 0.27;

  const project = retrieved(chunk("project-riverfront", {
    documentId: "doc-project-riverfront",
    fileName: "滨江片区控规优化项目资料（演示版）.md",
    chunkType: "requirement",
    content:
      "新增公共绿地应优先补足十五分钟生活圈缺口；商业服务设施宜集中在轨道站点 500 米范围内，避免侵占连续滨水公共界面。",
  }));
  project.source = "vector";
  project.keywordScore = 0;
  project.vectorScore = 0.23;

  const ranked = rerank([generic, project], {
    question: "片区控规优化项目的用地调整原则是什么？",
    keywords: ["片区", "控规优化", "用地调整原则"],
  });

  assert.equal(ranked[0].chunk.id, "project-riverfront");
});

test("version info does not mark referenced deprecated material as current document superseded", () => {
  const version = extractSourceVersionInfo([
    block("paragraph", "本文件引用的旧标准已废止，仅作为历史参考。", { pageStart: 1 }),
  ], "现行文件");

  assert.notEqual(version.status, "superseded");
  assert.ok(version.warnings?.some((warning) => warning.includes("version")));
});

test("extracts classification and indicator objects from real UTF-8 Chinese headers", () => {
  const utf8Blocks: Block[] = [
    block("heading", "第一章 总则", { level: 2, headingPattern: "chapter", pageStart: 1 }),
    block("heading", "术语和定义", { level: 3, headingPattern: "section", pageStart: 1 }),
    block("paragraph", "社区服务站是指为居民提供公共服务的基层服务设施。", { pageStart: 1 }),
    block("paragraph", "居住社区应配置社区服务站，不得擅自减少必配设施。", { pageStart: 1 }),
    block("table", "表1 分类代码表", {
      pageStart: 2,
      table: {
        tableId: "utf8-code",
        title: "表1 分类代码表",
        headers: ["代码", "名称", "内容"],
        rows: [
          ["A1", "公共管理", "行政办公等设施"],
          ["A11", "行政办公", "党政机关办公设施"],
        ],
        markdown: "",
      },
    }),
    block("table", "表2 配置指标表", {
      pageStart: 3,
      table: {
        tableId: "utf8-indicator",
        title: "表2 配置指标表",
        headers: ["层级", "设施名称", "建筑面积(平方米/处)", "服务规模"],
        rows: [["居住社区级", "社区服务站", "1200-1500", "每个社区1处"]],
        markdown: "",
      },
    }),
  ];
  const sectionTree = buildSectionTree(utf8Blocks);
  const objects = extractKnowledgeObjects({
    docId: "utf8-doc",
    blocks: utf8Blocks,
    sectionTree,
    tables: [],
    profile,
  });

  assert.ok(objects.some((o) => o.objectType === "definition"));
  assert.ok(objects.some((o) => o.objectType === "requirement"));
  assert.ok(objects.some((o) => o.objectType === "classification_code" && o.code === "A1"));
  assert.ok(objects.some((o) => o.objectType === "indicator_item" && o.itemName === "社区服务站"));
});

function chunk(id: string, overrides: Partial<Chunk>): Chunk {
  return {
    id,
    documentId: "doc-test",
    fileName: "通用标准.txt",
    city: "测试城市",
    chunkType: "section",
    content: "",
    keywords: [],
    createdAt: "2026-06-04T00:00:00.000Z",
    ...overrides,
  };
}

function retrieved(chunkValue: Chunk): RetrievedChunk {
  return {
    chunk: chunkValue,
    keywordScore: 0.5,
    vectorScore: 0.5,
    rerankScore: 0,
    source: "hybrid",
    matchedKeywords: [],
  };
}
