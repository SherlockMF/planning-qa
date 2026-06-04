// ============================================================================
// 文档画像 DocProfile（需求 8.9）
// ----------------------------------------------------------------------------
// 切分前先对 Block[] 做结构识别，输出 DocProfile。策略可叠加：一个文档可同时命中
// 多个 docTypeCandidates（如 guideline + indicator_standard）。chunk 编排器据此
// 决定运行哪些 strategies。不针对固定文件名做特例。
// ============================================================================

import type { Block, DocProfile, DocTypeCandidate } from "@/lib/types";

/** 用地/分类代码：A1 / A11 / R2 / B1 / G1 / S1 / U12 / M1 / W3 */
const CODE_RE = /\b[A-Z]\d{1,3}\b/;

/** 规范性表达 */
const NORMATIVE_RE = /(应当|应|不得|不应|宜|可|必须|严禁|原则上)/;

/** 术语/定义信号 */
const DEFINITION_HEADING_RE = /(术语|名词解释|定义|用词说明|统计口径)/;

/** 成果/清单信号 */
const DELIVERABLE_RE = /(成果构成|成果要求|图纸目录|附表|附件|清单|数据库要求|提交材料|申报材料)/;

/** 流程/程序信号 */
const PROCEDURE_RE = /(流程|程序|阶段|步骤|路径|时序|机制|审批|报审|审查指引|工作程序)/;

/** 指南/导则信号 */
const GUIDELINE_RE = /(编制指南|工作指引|技术导则|城市设计导则|申报指南|编制内容|技术要点|成果要求|图纸要求)/;

export function buildDocProfile(blocks: Block[], fileName?: string): DocProfile {
  const headings = blocks.filter((b) => b.type === "heading");
  const tables = blocks.filter((b) => b.type === "table");
  const paragraphs = blocks.filter(
    (b) => b.type === "paragraph" || b.type === "list_item"
  );
  const allText = blocks.map((b) => b.normalizedText).join("\n");

  const headingPatternsDetected = Array.from(
    new Set(headings.map((h) => h.headingPattern).filter(Boolean) as string[])
  );

  const hasChapterStructure = headingPatternsDetected.some((p) =>
    ["part", "volume", "chapter", "section"].includes(p)
  );
  const hasClauseNumbers = headingPatternsDetected.some((p) =>
    ["article", "clause-dot3"].includes(p)
  );

  const hasTables = tables.length > 0;
  const largeTables = tables.filter(
    (t) => (t.table?.rows.length ?? 0) >= 5
  ).length;
  const hasLargeTables = largeTables > 0;

  // 代码表：表格里出现成列的代码，或正文大量代码 + "类别代码/类别名称"
  const codeInTables = tables.some((t) =>
    (t.table?.rows ?? []).some((r) => r.some((c) => CODE_RE.test(c)))
  );
  const hasCodeTable =
    codeInTables &&
    /(类别代码|用地代码|代码|主类|中类|小类|类别名称)/.test(allText);

  const hasDefinitions = headings.some((h) =>
    DEFINITION_HEADING_RE.test(h.normalizedText)
  );
  const hasDeliverableList = DELIVERABLE_RE.test(allText);
  const hasProcedureSteps = PROCEDURE_RE.test(allText);
  const hasScannedPages = blocks.some((b) => b.type === "image_page");

  const normativeCount = (allText.match(new RegExp(NORMATIVE_RE, "g")) ?? [])
    .length;
  const isGuideline = GUIDELINE_RE.test(allText);

  // ── 组合 docTypeCandidates（可多选） ──
  const candidates = new Set<DocTypeCandidate>();
  if (hasClauseNumbers || (hasChapterStructure && normativeCount >= 5)) {
    candidates.add(hasClauseNumbers ? "technical_standard" : "regulation");
  }
  if (hasCodeTable) candidates.add("classification_standard");
  if (hasLargeTables) candidates.add("indicator_standard");
  if (isGuideline) candidates.add("guideline");
  if (hasDeliverableList) candidates.add("deliverable_spec");
  if (hasProcedureSteps && PROCEDURE_RE.test(headings.map((h) => h.normalizedText).join(" ")))
    candidates.add("procedure_doc");
  if (candidates.size === 0) candidates.add("mixed");
  if (candidates.size > 2) candidates.add("mixed");

  const estimatedPageCount = blocks.reduce(
    (max, b) => Math.max(max, b.pageEnd),
    0
  );

  const docTitle = inferTitle(blocks, fileName);

  return {
    docTitle,
    docTypeCandidates: Array.from(candidates),
    hasClauseNumbers,
    hasChapterStructure,
    hasTables,
    hasLargeTables,
    hasCodeTable,
    hasDefinitions,
    hasDeliverableList,
    hasProcedureSteps,
    hasScannedPages,
    headingPatternsDetected,
    tableCount: tables.length,
    estimatedPageCount,
  };
}

/** 推断文档标题：首页最高层级标题，回退到文件名（去扩展名）。 */
function inferTitle(blocks: Block[], fileName?: string): string {
  const firstPageHeadings = blocks
    .filter((b) => b.type === "heading" && b.pageStart <= 2 && b.headingPattern !== "table-caption")
    .sort((a, b) => (a.level ?? 9) - (b.level ?? 9));
  if (firstPageHeadings.length && firstPageHeadings[0].normalizedText) {
    return firstPageHeadings[0].normalizedText.slice(0, 80);
  }
  // 回退：首个较长段落或文件名
  const firstPara = blocks.find(
    (b) => b.type === "paragraph" && b.normalizedText.length >= 6
  );
  if (firstPara && firstPara.pageStart <= 1) {
    return firstPara.normalizedText.slice(0, 40);
  }
  return (fileName ?? "未命名文档").replace(/\.(pdf|docx|txt|md)$/i, "");
}
