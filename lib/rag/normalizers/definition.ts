import type { Block } from "../../types";
import type { DefinitionObject } from "../objects";
import { pageSpanOf, sectionPathText, stableObjectId } from "../objects.ts";
import { blockIdAt, getSectionPathForBlock, type SectionTree } from "../sectionTree.ts";

const DEFINITION_HEADING_RE = /(术语|名词解释|定义|用词说明|统计口径)/;
const DEFINITION_RE =
  /^(?:本(?:标准|办法|规定|指南|导则)所称)?\s*([^，。：:\s]{2,30})\s*(?:是指|指|是|包括|：|:)(.+)$/;
const ALIAS_RE = /以下简称[“"]?([^”"]+)[”"]?/;

export function extractDefinitionObjects(
  docId: string,
  blocks: Block[],
  sectionTree: SectionTree
): DefinitionObject[] {
  const out: DefinitionObject[] = [];
  let inDefinitionSection = false;

  blocks.forEach((block, index) => {
    if (block.type === "heading") {
      inDefinitionSection = DEFINITION_HEADING_RE.test(block.normalizedText);
      return;
    }
    if (block.type !== "paragraph" && block.type !== "list_item") return;

    const match = block.normalizedText.match(DEFINITION_RE);
    if (!match && !inDefinitionSection) return;
    const term = match?.[1]?.trim() ?? fallbackTerm(block.normalizedText);
    const definition = match?.[2]?.trim() ?? block.normalizedText;
    if (!term || !definition || term.length > 40) return;
    const alias = block.normalizedText.match(ALIAS_RE)?.[1]?.trim();
    const sectionPath = getSectionPathForBlock(sectionTree, blockIdAt(index));

    out.push({
      id: stableObjectId(docId, "definition", [term, definition.slice(0, 80)]),
      docId,
      objectType: "definition",
      title: term,
      content: block.normalizedText,
      sectionPath,
      sectionPathText: sectionPathText(sectionPath),
      sourcePageStart: block.pageStart,
      sourcePageEnd: block.pageEnd,
      sourcePages: pageSpanOf(block.pageStart, block.pageEnd),
      sourceBlockIds: [blockIdAt(index)],
      term,
      definition,
      aliases: alias ? [alias] : undefined,
      keywords: [term, alias].filter(Boolean) as string[],
      confidence: match ? 0.88 : 0.62,
      warnings: match ? undefined : ["definition_from_section_context"],
    });
  });

  return out;
}

function fallbackTerm(text: string): string {
  return text.split(/[：:，,。]/)[0]?.trim().slice(0, 20) ?? "";
}
