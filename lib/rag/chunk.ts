// ============================================================================
// 文档切分编排器（需求 5、7、8.10）
// ----------------------------------------------------------------------------
// 输入 Block[] + DocProfile，按"叠加策略"路由为带类型/元数据/关系的知识单元：
//   table → table_full + table_row(/code)
//   clause heading(第X条/1.0.3) → clause(+clause_explanation)
//   术语/定义段 → definition
//   列表项 → requirement/deliverable/procedure/list_item（按上下文）
//   其余段落 → section（500–900 目标 / 1200 上限 / 80–120 overlap，不跨章节）
// 关系：table_row→table_full、explanation→clause、list_item→heading；并建 prev/next 链。
// DOCX/TXT 走 blocksFromPlainText 复用同一编排器。
// ============================================================================

import type {
  Block,
  Chunk,
  Document,
  DocProfile,
  ChunkType,
} from "@/lib/types";
import type { KnowledgeObject } from "@/lib/rag/objects";
import { detectHeading } from "./headings.ts";
import { expandRow, rowFields, rowKeyOf } from "./tableModel.ts";
import { cleanBlocks } from "./clean.ts";
import { buildDocProfile } from "./profile.ts";
import { buildSectionTree, type SectionTree } from "./sectionTree.ts";
import { extractKnowledgeObjects } from "./normalizers/index.ts";
import { extractSourceVersionInfo, type SourceVersionInfo } from "./version.ts";

/** chunkDocument 产出：除 fileName/city/embedding/createdAt 及派生字段外的完整 chunk。 */
export type DraftChunk = Omit<
  Chunk,
  "fileName" | "city" | "embedding" | "createdAt" | "articleNo" | "pageNumber"
>;

/** chunk 公共上下文字段（documentId 必填，确保拼装后满足 DraftChunk）。 */
type ChunkBase = Omit<DraftChunk, "id" | "chunkType" | "content" | "keywords">;

export interface BuildChunksResult {
  drafts: DraftChunk[];
  blocks: Block[];
  cleanedBlocks: Block[];
  profile?: DocProfile;
  sectionTree?: SectionTree;
  knowledgeObjects: KnowledgeObject[];
  versionInfo?: SourceVersionInfo;
  fallbackUsed: boolean;
  warnings: string[];
}

const TARGET_MAX = 900; // 正文 chunk 目标上限
const HARD_MAX = 1200; // 绝对上限
const OVERLAP = 100; // 相邻正文 chunk 重叠（80–120 取中）
const MIN_CHUNK = 30;

const DEFINITION_HEADING_RE = /(术语|名词解释|定义|用词说明|统计口径)/;
const DELIVERABLE_RE = /(成果|图纸|附表|附件|清单|数据库|提交材料|申报材料)/;
const PROCEDURE_RE = /(流程|程序|阶段|步骤|路径|时序|机制|审批|报审|审查)/;
const NORMATIVE_RE = /(应当|应|不得|不应|宜|必须|严禁|原则上)/;
const CODE_RE = /\b[A-Z]\d{1,3}\b/;
const CLAUSE_PATTERNS = new Set(["article", "clause-dot3"]);

/** 列表项标记（与 ir.ts 同源，避免循环依赖在此本地实现）。 */
const LIST_MARKER_RE =
  /^\s*(?:[一二三四五六七八九十百]+[、．.]|\d+[、．.]|[（(]\s*\d+\s*[)）]|[①-⑳]|[-•·])\s*/;
function listMarkerOf(text: string): string | null {
  const m = LIST_MARKER_RE.exec(text);
  return m ? m[0].trim() : null;
}

// ────────────────────────────────────────────────────────────────────────────
// 主入口
// ────────────────────────────────────────────────────────────────────────────

/** 块级切分（PDF 路径）。 */
export function chunkBlocks(
  doc: Document,
  blocks: Block[],
  profile: DocProfile
): DraftChunk[] {
  const cleaned = cleanBlocks(blocks).blocks;
  const drafts: DraftChunk[] = [];
  let seq = 0;
  const docType = profile.docTypeCandidates[0];
  const newId = () => `chunk-${doc.id}-${seq++}`;

  // 标题栈（用于 sectionPath）；clause 不入栈
  const stack: { level: number; text: string }[] = [];
  const pathOf = () => stack.map((s) => s.text).join(" / ") || undefined;

  const base = (pageStart: number, pageEnd: number): ChunkBase => ({
    documentId: doc.id,
    docTitle: profile.docTitle,
    docType,
    sectionPath: pathOf(),
    headingText: stack[stack.length - 1]?.text,
    pageStart,
    pageEnd,
  });

  let i = 0;
  while (i < cleaned.length) {
    const b = cleaned[i];

    if (b.type === "page_break" || b.type === "image_page") {
      i++;
      continue;
    }

    // ── 表格 ──
    if (b.type === "table" && b.table) {
      const model = b.table;
      const fullId = newId();
      const headingText = stack[stack.length - 1]?.text;
      const sectionPath = pathOf();
      drafts.push({
        ...base(b.pageStart, b.pageEnd),
        id: fullId,
        chunkType: "table_full",
        headingText,
        tableId: model.tableId,
        tableTitle: model.title,
        tableHeaders: model.headers,
        content: [model.title, model.markdown].filter(Boolean).join("\n"),
        keywords: extractKeywords(
          `${model.title ?? ""} ${model.headers.join(" ")}`
        ),
        aliases: model.title ? [model.title] : [],
      });

      // 紧随的 table_row 块
      let j = i + 1;
      while (j < cleaned.length && cleaned[j].type === "table_row") {
        const rowBlk = cleaned[j];
        const row = rowBlk.rowCells ?? [];
        const key = rowKeyOf(row, model.headers);
        const content = expandRow(model, row, sectionPath);
        const codeMatch = key.match(CODE_RE);
        const fields = rowFields(model.headers, row);
        const aliases = [key, ...(codeMatch ? [codeMatch[0]] : [])].filter(
          Boolean
        );
        drafts.push({
          ...base(rowBlk.pageStart, rowBlk.pageEnd),
          id: newId(),
          chunkType: codeMatch ? "code" : "table_row",
          headingText,
          tableId: model.tableId,
          tableTitle: model.title,
          tableHeaders: model.headers,
          rowKey: key,
          fields,
          code: codeMatch ? codeMatch[0] : undefined,
          parentChunkId: fullId,
          content,
          keywords: extractKeywords(content),
          aliases,
        });
        j++;
      }
      i = j;
      continue;
    }
    if (b.type === "table_row") {
      i++; // 落单的 table_row（正常已被 table 消费）
      continue;
    }

    // ── 标题 ──
    if (b.type === "heading") {
      if (b.headingPattern === "table-caption") {
        i++;
        continue;
      }
      if (b.headingPattern && CLAUSE_PATTERNS.has(b.headingPattern)) {
        // 条文 chunk：标题 + 后续正文（至下一个标题/表格）
        const clauseNo = extractClauseMarker(b.normalizedText);
        const bodyParts: string[] = [b.normalizedText];
        const explanations: { text: string; ps: number; pe: number }[] = [];
        let pe = b.pageEnd;
        let j = i + 1;
        while (
          j < cleaned.length &&
          cleaned[j].type !== "heading" &&
          cleaned[j].type !== "table" &&
          cleaned[j].type !== "table_row"
        ) {
          const nb = cleaned[j];
          if (nb.type === "page_break" || nb.type === "image_page") {
            j++;
            continue;
          }
          if (/^(条文说明|说明|注[:：])/.test(nb.normalizedText)) {
            explanations.push({
              text: nb.normalizedText,
              ps: nb.pageStart,
              pe: nb.pageEnd,
            });
          } else {
            bodyParts.push(nb.normalizedText);
          }
          pe = nb.pageEnd;
          j++;
        }

        const content = bodyParts.join("");
        const clauseIds: string[] = [];
        for (const piece of splitLong(content)) {
          if (piece.length < MIN_CHUNK && clauseIds.length > 0) continue;
          const id = newId();
          clauseIds.push(id);
          drafts.push({
            ...base(b.pageStart, pe),
            id,
            chunkType: "clause",
            clauseNo,
            content: piece,
            keywords: extractKeywords(piece),
            aliases: clauseNo ? [clauseNo] : [],
          });
        }
        // 条文说明 → clause_explanation，父指向首个 clause
        for (const ex of explanations) {
          drafts.push({
            ...base(ex.ps, ex.pe),
            id: newId(),
            chunkType: "clause_explanation",
            clauseNo,
            parentChunkId: clauseIds[0],
            content: ex.text,
            keywords: extractKeywords(ex.text),
          });
        }
        i = j;
        continue;
      }

      // 结构标题 → 更新栈
      const lvl = b.level ?? 5;
      while (stack.length && stack[stack.length - 1].level >= lvl) stack.pop();
      stack.push({ level: lvl, text: b.normalizedText });
      i++;
      continue;
    }

    // ── 段落 / 列表项 ──
    if (b.type === "paragraph" || b.type === "list_item") {
      const body: Block[] = [];
      let j = i;
      while (
        j < cleaned.length &&
        (cleaned[j].type === "paragraph" || cleaned[j].type === "list_item")
      ) {
        body.push(cleaned[j]);
        j++;
      }
      emitBody(body, drafts, base, newId, profile);
      i = j;
      continue;
    }

    i++;
  }

  linkSequential(drafts);
  return drafts;
}

/** 段落/列表块组 → chunks。 */
function emitBody(
  body: Block[],
  drafts: DraftChunk[],
  base: (ps: number, pe: number) => ChunkBase,
  newId: () => string,
  profile: DocProfile
) {
  const heading = base(0, 0).headingText ?? "";
  const definitionMode = DEFINITION_HEADING_RE.test(heading);

  // 1) 定义段：每块一个 definition chunk
  if (definitionMode) {
    for (const blk of body) {
      const text = blk.normalizedText;
      if (text.length < 4) continue;
      const term = termOf(text);
      drafts.push({
        ...base(blk.pageStart, blk.pageEnd),
        id: newId(),
        chunkType: "definition",
        rowKey: term,
        content: text,
        keywords: extractKeywords(text),
        aliases: term ? [term] : [],
      });
    }
    return;
  }

  // 2) 列表项：按上下文定类型，逐项成 chunk
  // 3) 段落：打包为 section chunk（带 overlap）
  let buf = "";
  let bufStart = body[0]?.pageStart ?? 0;
  let bufEnd = body[0]?.pageEnd ?? 0;
  let carry = "";

  const flush = () => {
    const content = (carry + buf).trim();
    if (content.length < MIN_CHUNK) {
      buf = "";
      return;
    }
    for (const piece of splitLong(content)) {
      drafts.push({
        ...base(bufStart, bufEnd),
        id: newId(),
        chunkType: "section",
        content: piece,
        keywords: extractKeywords(piece),
      });
    }
    carry = content.slice(-OVERLAP); // 仅本 section 内 overlap，不跨章节
    buf = "";
  };

  for (const blk of body) {
    if (blk.type === "list_item") {
      // 列表项独立成 chunk
      const text = blk.normalizedText;
      if (text.length < 4) continue;
      const ct = listItemType(text, heading, profile);
      drafts.push({
        ...base(blk.pageStart, blk.pageEnd),
        id: newId(),
        chunkType: ct,
        content: text,
        keywords: extractKeywords(text),
      });
      continue;
    }
    // 段落
    if ((buf + blk.normalizedText).length > TARGET_MAX && buf) {
      bufEnd = blk.pageStart;
      flush();
      bufStart = blk.pageStart;
    }
    buf += blk.normalizedText;
    bufEnd = blk.pageEnd;
  }
  flush();
}

/** 列表项类型：规范性→requirement；流程→procedure；成果→deliverable；否则 list_item。 */
function listItemType(
  text: string,
  heading: string,
  profile: DocProfile
): ChunkType {
  if (NORMATIVE_RE.test(text)) return "requirement";
  if (profile.hasProcedureSteps && PROCEDURE_RE.test(heading)) return "procedure";
  if (profile.hasDeliverableList && DELIVERABLE_RE.test(heading))
    return "deliverable";
  return "list_item";
}

/** 术语段提取术语名（"X：定义" / "X是定义" / "X 指…"）。 */
function termOf(text: string): string {
  const m = text.match(/^([^：:，。\s]{2,20})\s*(?:[：:]|是指|指|是)/);
  return m ? m[1].trim() : text.slice(0, 12);
}

/** 定义块里的术语；用于 definition.rowKey。 */
function extractClauseMarker(text: string): string | undefined {
  const dot = text.match(/^\s*(\d+(?:\.\d+){1,})/);
  if (dot) return dot[1];
  const cn = text.match(/^\s*(第[零一二三四五六七八九十百千0-9]+条)/);
  if (cn) return cn[1];
  return undefined;
}

/** 文档顺序建立 prev/next 链。 */
function linkSequential(drafts: DraftChunk[]) {
  for (let i = 0; i < drafts.length; i++) {
    if (i > 0) drafts[i].prevChunkId = drafts[i - 1].id;
    if (i < drafts.length - 1) drafts[i].nextChunkId = drafts[i + 1].id;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 纯文本路径（DOCX / TXT / MD）
// ────────────────────────────────────────────────────────────────────────────

/** 把纯文本解析为简化 Block[]（无表格识别）。 */
export function blocksFromPlainText(text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];
  let page = 1;
  let paraBuf = "";

  const flushPara = () => {
    const t = paraBuf.trim();
    if (t) {
      blocks.push({
        type: "paragraph",
        pageStart: page,
        pageEnd: page,
        rawText: t,
        normalizedText: t,
      });
    }
    paraBuf = "";
  };

  for (const raw of lines) {
    const pm = raw.match(/\[\[page:(\d+)\]\]|【第(\d+)页】/);
    if (pm) {
      flushPara();
      page = Number(pm[1] ?? pm[2]);
      continue;
    }
    const line = raw.trim();
    if (!line) {
      flushPara();
      continue;
    }
    const heading = detectHeading(line);
    if (heading) {
      flushPara();
      blocks.push({
        type: "heading",
        pageStart: page,
        pageEnd: page,
        rawText: line,
        normalizedText: line,
        level: heading.level,
        headingPattern: heading.pattern,
      });
      continue;
    }
    const marker = listMarkerOf(line);
    if (marker) {
      flushPara();
      blocks.push({
        type: "list_item",
        pageStart: page,
        pageEnd: page,
        rawText: line,
        normalizedText: line,
        listMarker: marker,
      });
      continue;
    }
    paraBuf += line;
    if (/[。；！？]$/.test(line)) flushPara();
  }
  flushPara();
  return blocks;
}

/** 顶层：根据输入选择路径。blocks 优先；否则用纯文本。 */
export function buildChunks(
  doc: Document,
  input: { blocks?: Block[]; text?: string }
): DraftChunk[] {
  return buildChunksWithObjects(doc, input).drafts;
}

/** 顶层增强：优先 KnowledgeObject → retrieval chunks，失败时回退旧 chunkBlocks。 */
export function buildChunksWithObjects(
  doc: Document,
  input: { blocks?: Block[]; text?: string }
): BuildChunksResult {
  const blocks = resolveInputBlocks(input);
  if (!blocks.length) {
    return {
      drafts: [],
      blocks: [],
      cleanedBlocks: [],
      knowledgeObjects: [],
      fallbackUsed: false,
      warnings: ["no_parseable_blocks"],
    };
  }

  const warnings: string[] = [];
  const cleaned = cleanBlocks(blocks).blocks;
  const profile = buildDocProfile(cleaned, doc.fileName);
  const versionInfo = extractSourceVersionInfo(cleaned, profile.docTitle);
  let sectionTree: SectionTree | undefined;
  let knowledgeObjects: KnowledgeObject[] = [];

  try {
    sectionTree = buildSectionTree(cleaned);
    knowledgeObjects = extractKnowledgeObjects({
      docId: doc.id,
      blocks: cleaned,
      sectionTree,
      tables: [],
      profile,
    });
    const objectDrafts = buildRetrievalChunksFromObjects(
      doc,
      knowledgeObjects,
      profile,
      versionInfo
    );
    if (objectDrafts.length) {
      return {
        drafts: objectDrafts,
        blocks,
        cleanedBlocks: cleaned,
        profile,
        sectionTree,
        knowledgeObjects,
        versionInfo,
        fallbackUsed: false,
        warnings,
      };
    }
    warnings.push("knowledge_objects_produced_no_chunks");
  } catch (error) {
    warnings.push(`knowledge_object_pipeline_failed: ${String(error)}`);
  }

  return {
    drafts: chunkBlocks(doc, blocks, profile),
    blocks,
    cleanedBlocks: cleaned,
    profile,
    sectionTree,
    knowledgeObjects,
    versionInfo,
    fallbackUsed: true,
    warnings,
  };
}

export function buildRetrievalChunksFromObjects(
  doc: Document,
  objects: KnowledgeObject[],
  profile: DocProfile,
  versionInfo?: SourceVersionInfo
): DraftChunk[] {
  const drafts: DraftChunk[] = [];
  for (const obj of objects) {
    if (obj.objectType === "structured_table") {
      drafts.push(makeObjectDraft(doc, obj, profile, versionInfo, {
        chunkRole: "parent",
        displayText: tableParentText(obj),
      }));
      if (obj.rows.length) {
        drafts.push(makeObjectDraft(doc, obj, profile, versionInfo, {
          idSuffix: "summary",
          chunkRole: "summary",
          displayText: tableSummaryText(obj),
        }));
      }
      continue;
    }

    const pieces = shouldSplitObject(obj) ? splitLong(obj.content) : [obj.content];
    if (pieces.length <= 1) {
      drafts.push(makeObjectDraft(doc, obj, profile, versionInfo, {
        chunkRole: chunkRoleForObject(obj),
        displayText: pieces[0] ?? obj.content,
      }));
      continue;
    }

    const parent = makeObjectDraft(doc, obj, profile, versionInfo, {
      chunkRole: "parent",
      displayText: objectSummaryText(obj),
    });
    drafts.push(parent);
    for (let i = 0; i < pieces.length; i++) {
      drafts.push(makeObjectDraft(doc, obj, profile, versionInfo, {
        idSuffix: `part-${i + 1}`,
        chunkRole: obj.objectType === "plain_section" ? "fallback" : "atomic",
        displayText: pieces[i],
        parentChunkId: parent.id,
      }));
    }
  }
  return drafts.filter((draft) => draft.content.trim().length > 0);
}

/** 占位 chunk（无可解析正文时）。 */
export function placeholderChunk(doc: Document): DraftChunk {
  const displayText = `（演示占位）文档「${doc.fileName}」已登记为${doc.fileType}，但尚未提供可解析的正文内容。请在接入真实解析后重新处理。`;
  return {
    id: `chunk-${doc.id}-0`,
    documentId: doc.id,
    chunkType: "note",
    chunkRole: "fallback",
    content: displayText,
    displayText,
    embeddingText: displayText,
    bm25Text: displayText,
    keywords: [doc.fileType, doc.city],
  };
}

function resolveInputBlocks(input: { blocks?: Block[]; text?: string }): Block[] {
  if (input.blocks && input.blocks.length) return input.blocks;
  if (input.text && input.text.trim().length > 0) {
    return blocksFromPlainText(input.text);
  }
  return [];
}

function makeObjectDraft(
  doc: Document,
  obj: KnowledgeObject,
  profile: DocProfile,
  versionInfo: SourceVersionInfo | undefined,
  options: {
    idSuffix?: string;
    chunkRole: DraftChunk["chunkRole"];
    displayText: string;
    parentChunkId?: string;
  }
): DraftChunk {
  const chunkType = chunkTypeForObject(obj);
  const displayText = options.displayText || obj.content;
  const embeddingText = makeEmbeddingText(obj, displayText);
  const bm25Text = makeBm25Text(obj, displayText, embeddingText);
  return {
    id: `chunk-${obj.id}${options.idSuffix ? `-${options.idSuffix}` : ""}`,
    documentId: doc.id,
    docTitle: profile.docTitle,
    docType: profile.docTypeCandidates[0],
    chunkType,
    chunkRole: options.chunkRole,
    sectionPath: obj.sectionPathText || undefined,
    headingText: obj.sectionPath.at(-1),
    clauseNo: obj.objectType === "regulation_clause" ? obj.clauseNo : undefined,
    tableId: tableIdForObject(obj),
    tableTitle: tableTitleForObject(obj),
    tableHeaders: tableHeadersForObject(obj),
    rowKey: rowKeyForObject(obj),
    fields: fieldsForObject(obj),
    code: obj.objectType === "classification_code" ? obj.code : undefined,
    parentCode: obj.objectType === "classification_code" ? obj.parentCode : undefined,
    pageStart: obj.sourcePageStart,
    pageEnd: obj.sourcePageEnd,
    parentChunkId:
      options.parentChunkId ?? (obj.parentObjectId ? `chunk-${obj.parentObjectId}` : undefined),
    prevChunkId: obj.prevObjectId ? `chunk-${obj.prevObjectId}` : undefined,
    nextChunkId: obj.nextObjectId ? `chunk-${obj.nextObjectId}` : undefined,
    content: displayText,
    displayText,
    embeddingText,
    bm25Text,
    keywords: obj.keywords ?? extractKeywords(displayText),
    aliases: obj.aliases,
    objectId: obj.id,
    objectType: obj.objectType,
    sourceTableId: obj.sourceTableId,
    sourceRowIndex: obj.sourceRowIndex,
    itemName: obj.objectType === "indicator_item" ? obj.itemName : undefined,
    normativeLevel:
      "normativeLevel" in obj ? String(obj.normativeLevel ?? "") || undefined : undefined,
    mandatory: "mandatory" in obj ? obj.mandatory : undefined,
    versionInfo: versionInfo as unknown as Record<string, unknown> | undefined,
  };
}

function makeEmbeddingText(obj: KnowledgeObject, displayText = obj.content): string {
  return [
    obj.objectType,
    obj.sectionPathText,
    obj.title,
    displayText,
    objectSpecificFieldsText(obj),
  ]
    .filter(Boolean)
    .join("\n");
}

function makeBm25Text(
  obj: KnowledgeObject,
  displayText: string,
  embeddingText: string
): string {
  const fieldText =
    obj.objectType === "structured_table_row" ||
    obj.objectType === "classification_code" ||
    obj.objectType === "indicator_item"
      ? Object.entries(obj.fields)
          .map(([key, value]) => `${key} ${value}`)
          .join(" ")
      : "";
  return [
    embeddingText,
    displayText,
    obj.keywords?.join(" "),
    obj.aliases?.join(" "),
    fieldText,
  ]
    .filter(Boolean)
    .join("\n");
}

function chunkRoleForObject(obj: KnowledgeObject): DraftChunk["chunkRole"] {
  if (obj.objectType === "plain_section") return "fallback";
  if (obj.objectType === "structured_table") return "parent";
  return "atomic";
}

function shouldSplitObject(obj: KnowledgeObject): boolean {
  return (
    (obj.objectType === "regulation_clause" || obj.objectType === "plain_section") &&
    obj.content.length > HARD_MAX
  );
}

function objectSummaryText(obj: KnowledgeObject): string {
  const title = obj.title ?? obj.sectionPath.at(-1) ?? obj.objectType;
  return [title, obj.sectionPathText, obj.content.slice(0, 260)]
    .filter(Boolean)
    .join("\n");
}

function tableParentText(obj: Extract<KnowledgeObject, { objectType: "structured_table" }>): string {
  return [
    obj.tableTitle ?? obj.title,
    obj.tableNo ? `表号：${obj.tableNo}` : undefined,
    `表格类型：${obj.tableType}`,
    `表头：${obj.headers.map((header) => header.name).join(" | ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function tableSummaryText(obj: Extract<KnowledgeObject, { objectType: "structured_table" }>): string {
  const rowKeys = obj.rows
    .map((row) => row.rowKey)
    .filter(Boolean)
    .slice(0, 12)
    .join("；");
  return [
    obj.tableTitle ?? obj.title,
    `表格摘要：共${obj.rows.length}行`,
    `表头：${obj.headers.map((header) => header.name).join(" | ")}`,
    rowKeys ? `主要行：${rowKeys}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function objectSpecificFieldsText(obj: KnowledgeObject): string {
  switch (obj.objectType) {
    case "classification_code":
      return [
        obj.code,
        obj.name,
        obj.parentCode ? `父级：${obj.parentCode}` : undefined,
        obj.description,
        obj.tableObjectId,
      ]
        .filter(Boolean)
        .join("\n");
    case "indicator_item":
      return [
        obj.itemName,
        obj.indicatorName,
        obj.indicatorValues.map((value) => value.raw).join("；"),
        obj.unit,
        obj.serviceScale,
      ]
        .filter(Boolean)
        .join("\n");
    case "requirement":
      return [obj.subject, obj.normativeLevel, obj.condition, obj.requirementText]
        .filter(Boolean)
        .join("\n");
    case "deliverable_requirement":
      return [
        obj.stage,
        obj.deliverableType,
        obj.mandatory == null ? undefined : obj.mandatory ? "必选" : "选做",
        obj.requirementText,
      ]
        .filter(Boolean)
        .join("\n");
    case "drawing_requirement":
      return [obj.drawingName, obj.drawingType, obj.requirementText].filter(Boolean).join("\n");
    case "regulation_clause":
      return [obj.clauseNo, obj.clauseTitle, obj.normativeLevel].filter(Boolean).join("\n");
    case "definition":
      return [obj.term, obj.definition, ...(obj.aliases ?? [])].filter(Boolean).join("\n");
    case "structured_table_row":
      return Object.entries(obj.fields)
        .map(([key, value]) => `${key}：${value}`)
        .join("\n");
    case "structured_table":
      return [
        obj.tableNo,
        obj.tableTitle,
        obj.tableType,
        obj.headers.map((header) => header.name).join(" | "),
      ]
        .filter(Boolean)
        .join("\n");
    default:
      return "";
  }
}

function chunkTypeForObject(obj: KnowledgeObject): ChunkType {
  switch (obj.objectType) {
    case "regulation_clause":
      return "clause";
    case "clause_explanation":
      return "clause_explanation";
    case "definition":
      return "definition";
    case "structured_table":
      return "table_full";
    case "structured_table_row":
      return "table_row";
    case "classification_code":
      return "code";
    case "indicator_item":
      return "indicator";
    case "requirement":
      return "requirement";
    case "deliverable_requirement":
    case "drawing_requirement":
      return "deliverable";
    case "procedure_step":
      return "procedure";
    case "checklist_item":
      return "list_item";
    default:
      return "section";
  }
}

function tableIdForObject(obj: KnowledgeObject): string | undefined {
  if (obj.objectType === "structured_table") return obj.sourceTableId;
  if (obj.objectType === "structured_table_row") return obj.sourceTableId;
  if (obj.objectType === "classification_code" || obj.objectType === "indicator_item") {
    return obj.sourceTableId;
  }
  return undefined;
}

function tableTitleForObject(obj: KnowledgeObject): string | undefined {
  if (obj.objectType === "structured_table") return obj.tableTitle ?? obj.title;
  if (obj.objectType === "structured_table_row") return obj.tableTitle;
  return undefined;
}

function tableHeadersForObject(obj: KnowledgeObject): string[] | undefined {
  if (obj.objectType === "structured_table") return obj.headers.map((header) => header.name);
  if (obj.objectType === "structured_table_row") return Object.keys(obj.fields);
  if (obj.objectType === "classification_code" || obj.objectType === "indicator_item") {
    return Object.keys(obj.fields);
  }
  return undefined;
}

function rowKeyForObject(obj: KnowledgeObject): string | undefined {
  if (obj.objectType === "structured_table_row") return obj.rowKey;
  if (obj.objectType === "classification_code") return `${obj.code} ${obj.name}`;
  if (obj.objectType === "indicator_item") return obj.itemName;
  if (obj.objectType === "definition") return obj.term;
  if (obj.objectType === "checklist_item") return obj.itemTitle;
  return undefined;
}

function fieldsForObject(obj: KnowledgeObject): Record<string, string> | undefined {
  if (obj.objectType === "structured_table_row") return obj.fields;
  if (obj.objectType === "classification_code" || obj.objectType === "indicator_item") {
    return obj.fields;
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// 工具：长文本二次切分 + 关键词抽取（沿用原实现）
// ────────────────────────────────────────────────────────────────────────────

export function splitLong(content: string): string[] {
  if (content.length <= HARD_MAX) return [content];
  const sentences = content.split(/(?<=[。；;！!])/);
  const pieces: string[] = [];
  let cur = "";
  const flushCur = () => {
    if (cur.trim()) pieces.push(cur.trim());
    cur = "";
  };
  for (const s of sentences) {
    if (s.length > HARD_MAX) {
      flushCur();
      for (let i = 0; i < s.length; i += HARD_MAX) {
        const piece = s.slice(i, i + HARD_MAX).trim();
        if (piece) pieces.push(piece);
      }
      continue;
    }
    if ((cur + s).length > HARD_MAX && cur) flushCur();
    cur += s;
  }
  flushCur();
  return pieces;
}

const STOPWORDS = new Set([
  "的", "是", "在", "和", "与", "及", "或", "等", "为", "应", "不", "可",
  "其", "该", "以", "对", "中", "上", "下", "之", "了", "也", "而", "并",
]);

/** 抽取关键词：用地代码、数值指标、条款号、专业术语、2-gram 兜底。 */
export function extractKeywords(text: string): string[] {
  const keywords = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z]\d{1,2}/g))
    keywords.add(m[0].toUpperCase());
  for (const m of text.matchAll(/\d+(?:\.\d+)?\s*(?:%|％|平方米|米|个|户)/g))
    keywords.add(m[0].replace(/\s+/g, ""));
  for (const m of text.matchAll(/第[一二三四五六七八九十百零0-9]+条/g))
    keywords.add(m[0]);
  const TERMS = [
    "容积率", "建筑密度", "绿地率", "建筑高度", "限高", "停车", "配建",
    "居住用地", "商业用地", "商务金融用地", "公共服务设施", "用地分类",
    "二类居住用地", "一类居住用地", "日照", "间距",
  ];
  for (const term of TERMS) if (text.includes(term)) keywords.add(term);
  const han = text.match(/[一-龥]+/g) ?? [];
  for (const seg of han) {
    for (let i = 0; i < seg.length - 1; i++) {
      const bigram = seg.slice(i, i + 2);
      if (![...bigram].some((ch) => STOPWORDS.has(ch))) keywords.add(bigram);
    }
  }
  return [...keywords].slice(0, 40);
}
