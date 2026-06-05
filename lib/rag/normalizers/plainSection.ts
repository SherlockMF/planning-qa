import type { Block } from "../../types";
import type { PlainSectionObject } from "../objects";
import { pageSpanOf, sectionPathText, stableObjectId } from "../objects.ts";
import { blockIdAt, type SectionTree } from "../sectionTree.ts";

export function extractPlainSectionObjects(
  docId: string,
  blocks: Block[],
  sectionTree: SectionTree
): PlainSectionObject[] {
  const byPath = new Map<string, { path: string[]; texts: string[]; blockIds: string[]; pageStart: number; pageEnd: number }>();
  blocks.forEach((block, index) => {
    if (block.type !== "paragraph" && block.type !== "list_item") return;
    const blockId = blockIdAt(index);
    const path = sectionTree.blockSectionMap[blockId] ?? [];
    const key = path.join(" / ") || "ROOT";
    const item = byPath.get(key) ?? {
      path,
      texts: [],
      blockIds: [],
      pageStart: block.pageStart,
      pageEnd: block.pageEnd,
    };
    item.texts.push(block.normalizedText);
    item.blockIds.push(blockId);
    item.pageStart = Math.min(item.pageStart, block.pageStart);
    item.pageEnd = Math.max(item.pageEnd, block.pageEnd);
    byPath.set(key, item);
  });

  return [...byPath.values()]
    .filter((item) => item.texts.join("").trim().length >= 8)
    .map((item) => ({
      id: stableObjectId(docId, "plain_section", [item.path.join("/"), item.texts.join("").slice(0, 80)]),
      docId,
      objectType: "plain_section",
      title: item.path.at(-1),
      content: item.texts.join("\n"),
      sectionPath: item.path,
      sectionPathText: sectionPathText(item.path),
      sourcePageStart: item.pageStart,
      sourcePageEnd: item.pageEnd,
      sourcePages: pageSpanOf(item.pageStart, item.pageEnd),
      sourceBlockIds: item.blockIds,
      keywords: item.path,
      confidence: 0.55,
      warnings: ["fallback_plain_section"],
    }));
}
