import type { Block } from "../../types";
import type {
  ClauseExplanationObject,
  ClauseNormativeLevel,
  RegulationClauseObject,
} from "../objects";
import { pageSpanOf, sectionPathText, stableObjectId } from "../objects.ts";
import { blockIdAt, getSectionPathForBlock, type SectionTree } from "../sectionTree.ts";
import { extractObligationKeywords } from "./requirement.ts";

const CLAUSE_PATTERNS = new Set(["article", "clause-dot3"]);
const CLAUSE_MARKER_RE =
  /^\s*(第[零一二三四五六七八九十百千0-9]+条|\d+(?:\.\d+){1,})\s*(.*)$/;
const EXPLANATION_RE = /^(条文说明|说明|注[:：]|备注|指标说明|修改说明|使用说明)/;

export function extractClauseObjects(
  docId: string,
  blocks: Block[],
  sectionTree: SectionTree
): Array<RegulationClauseObject | ClauseExplanationObject> {
  const out: Array<RegulationClauseObject | ClauseExplanationObject> = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const marker = clauseMarker(block);
    if (!marker) continue;

    const parts = [block.normalizedText];
    const sourceBlockIds = [blockIdAt(i)];
    const explanations: Array<{ text: string; index: number; pageStart: number; pageEnd: number }> = [];
    let pageEnd = block.pageEnd;
    let j = i + 1;
    while (j < blocks.length) {
      const next = blocks[j];
      if (next.type === "table" || next.type === "table_row") break;
      if (next.type === "heading" && next.headingPattern !== "table-caption") break;
      if (next.type === "paragraph" || next.type === "list_item") {
        if (EXPLANATION_RE.test(next.normalizedText)) {
          explanations.push({
            text: next.normalizedText,
            index: j,
            pageStart: next.pageStart,
            pageEnd: next.pageEnd,
          });
        } else {
          parts.push(next.normalizedText);
          sourceBlockIds.push(blockIdAt(j));
        }
        pageEnd = next.pageEnd;
      }
      j++;
    }

    const content = parts.join("");
    const sectionPath = getSectionPathForBlock(sectionTree, blockIdAt(i));
    const id = stableObjectId(docId, "regulation_clause", [marker.clauseNo, content.slice(0, 80)]);
    const obligationKeywords = extractObligationKeywords(content);
    out.push({
      id,
      docId,
      objectType: "regulation_clause",
      title: marker.clauseTitle || marker.clauseNo,
      content,
      sectionPath,
      sectionPathText: sectionPathText(sectionPath),
      sourcePageStart: block.pageStart,
      sourcePageEnd: pageEnd,
      sourcePages: pageSpanOf(block.pageStart, pageEnd),
      sourceBlockIds,
      clauseNo: marker.clauseNo,
      clauseTitle: marker.clauseTitle,
      normativeLevel: clauseNormativeLevel(content),
      obligationKeywords,
      keywords: [marker.clauseNo, marker.clauseTitle, ...obligationKeywords].filter(Boolean) as string[],
      aliases: [marker.clauseNo].filter(Boolean) as string[],
      confidence: block.type === "heading" ? 0.9 : 0.72,
      warnings: block.type === "heading" ? undefined : ["clause_from_paragraph_pattern"],
    });

    for (const ex of explanations) {
      out.push({
        id: stableObjectId(docId, "clause_explanation", [id, ex.text.slice(0, 80)]),
        docId,
        objectType: "clause_explanation",
        title: `${marker.clauseNo ?? ""}说明`.trim(),
        content: ex.text,
        sectionPath,
        sectionPathText: sectionPathText(sectionPath),
        sourcePageStart: ex.pageStart,
        sourcePageEnd: ex.pageEnd,
        sourcePages: pageSpanOf(ex.pageStart, ex.pageEnd),
        sourceBlockIds: [blockIdAt(ex.index)],
        parentObjectId: id,
        relatedObjectId: id,
        clauseNo: marker.clauseNo,
        keywords: [marker.clauseNo, "说明"].filter(Boolean) as string[],
        confidence: 0.82,
      });
    }
  }
  return out;
}

function clauseMarker(block: Block): { clauseNo?: string; clauseTitle?: string } | null {
  if (block.type === "heading" && block.headingPattern && CLAUSE_PATTERNS.has(block.headingPattern)) {
    const match = block.normalizedText.match(CLAUSE_MARKER_RE);
    return {
      clauseNo: match?.[1] ?? block.normalizedText,
      clauseTitle: match?.[2]?.trim(),
    };
  }
  if (block.type === "paragraph" || block.type === "list_item") {
    const match = block.normalizedText.match(CLAUSE_MARKER_RE);
    if (match) return { clauseNo: match[1], clauseTitle: match[2]?.trim() };
  }
  return null;
}

function clauseNormativeLevel(text: string): ClauseNormativeLevel {
  if (/必须|严禁|不得|不应/.test(text)) return "must";
  if (/应当|应/.test(text)) return "shall";
  if (/宜|原则上/.test(text)) return "should";
  if (/可|参照|结合实际/.test(text)) return "may";
  if (/说明|解释|备注/.test(text)) return "informative";
  return "unknown";
}
