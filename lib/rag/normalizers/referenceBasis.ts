import type { Block } from "../../types";
import type { ReferenceBasisObject } from "../objects";
import { pageSpanOf, sectionPathText, stableObjectId } from "../objects.ts";
import { blockIdAt, getSectionPathForBlock, type SectionTree } from "../sectionTree.ts";

const BASIS_RE = /编制依据|依据|引用标准|相关规范|上位规划|法律法规/;

export function extractReferenceBasisObjects(
  docId: string,
  blocks: Block[],
  sectionTree: SectionTree
): ReferenceBasisObject[] {
  const out: ReferenceBasisObject[] = [];
  blocks.forEach((block, index) => {
    if (block.type !== "paragraph" && block.type !== "list_item") return;
    const sectionPath = getSectionPathForBlock(sectionTree, blockIdAt(index));
    if (!BASIS_RE.test(sectionPath.join(" ")) && !BASIS_RE.test(block.normalizedText)) return;
    out.push({
      id: stableObjectId(docId, "reference_basis", [index, block.normalizedText.slice(0, 80)]),
      docId,
      objectType: "reference_basis",
      title: sectionPath.at(-1),
      content: block.normalizedText,
      sectionPath,
      sectionPathText: sectionPathText(sectionPath),
      sourcePageStart: block.pageStart,
      sourcePageEnd: block.pageEnd,
      sourcePages: pageSpanOf(block.pageStart, block.pageEnd),
      sourceBlockIds: [blockIdAt(index)],
      basisText: block.normalizedText,
      basisTitle: sectionPath.at(-1),
      confidence: 0.68,
    });
  });
  return out;
}
