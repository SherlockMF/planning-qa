import type { Block } from "../../types";
import type { ChecklistItemObject, StructuredTableObject } from "../objects";
import { pageSpanOf, sectionPathText, stableObjectId } from "../objects.ts";
import { blockIdAt, getSectionPathForBlock, type SectionTree } from "../sectionTree.ts";

const CHECKLIST_RE = /清单|任务|问题|需求|项目|政策|事项|材料/;

export function extractChecklistObjects(
  docId: string,
  blocks: Block[],
  sectionTree: SectionTree,
  tables: StructuredTableObject[]
): ChecklistItemObject[] {
  const out: ChecklistItemObject[] = [];
  blocks.forEach((block, index) => {
    if (block.type !== "list_item" || !CHECKLIST_RE.test(block.normalizedText)) return;
    const sectionPath = getSectionPathForBlock(sectionTree, blockIdAt(index));
    out.push({
      id: stableObjectId(docId, "checklist_item", [index, block.normalizedText.slice(0, 80)]),
      docId,
      objectType: "checklist_item",
      title: block.normalizedText.slice(0, 40),
      content: block.normalizedText,
      sectionPath,
      sectionPathText: sectionPathText(sectionPath),
      sourcePageStart: block.pageStart,
      sourcePageEnd: block.pageEnd,
      sourcePages: pageSpanOf(block.pageStart, block.pageEnd),
      sourceBlockIds: [blockIdAt(index)],
      listName: sectionPath.at(-1),
      itemNo: block.listMarker,
      itemTitle: block.normalizedText.slice(0, 40),
      itemText: block.normalizedText,
      mandatory: /必选|必须|应/.test(block.normalizedText) ? true : undefined,
      confidence: 0.68,
    });
  });
  blocks.forEach((block, index) => {
    if (block.type !== "list_item") return;
    const sectionPath = getSectionPathForBlock(sectionTree, blockIdAt(index));
    if (!CHECKLIST_RE.test(sectionPath.join(" "))) return;
    if (out.some((item) => item.sourceBlockIds?.includes(blockIdAt(index)))) return;
    out.push({
      id: stableObjectId(docId, "checklist_item", [index, sectionPath.join("/"), block.normalizedText.slice(0, 80)]),
      docId,
      objectType: "checklist_item",
      title: block.normalizedText.slice(0, 40),
      content: block.normalizedText,
      sectionPath,
      sectionPathText: sectionPathText(sectionPath),
      sourcePageStart: block.pageStart,
      sourcePageEnd: block.pageEnd,
      sourcePages: pageSpanOf(block.pageStart, block.pageEnd),
      sourceBlockIds: [blockIdAt(index)],
      listName: sectionPath.at(-1),
      itemNo: block.listMarker,
      itemTitle: block.normalizedText.replace(/^\s*\d+[、.．]\s*/, "").slice(0, 40),
      itemText: block.normalizedText,
      mandatory: /必选|必须|应/.test(block.normalizedText) ? true : undefined,
      confidence: 0.72,
    });
  });
  for (const table of tables) {
    if (table.tableType !== "checklist_table") continue;
    for (const row of table.rows) {
      out.push({
        id: stableObjectId(docId, "checklist_item", [row.id]),
        docId,
        objectType: "checklist_item",
        title: row.rowKey,
        content: row.content,
        sectionPath: row.sectionPath,
        sectionPathText: sectionPathText(row.sectionPath),
        sourcePageStart: row.sourcePageStart,
        sourcePageEnd: row.sourcePageEnd,
        sourcePages: row.sourcePages,
        sourceBlockIds: row.sourceBlockIds,
        sourceTableId: row.sourceTableId,
        sourceRowIndex: row.rowIndex,
        parentObjectId: row.id,
        listName: table.tableTitle,
        itemNo: row.fields["序号"] ?? row.fields["编号"],
        itemTitle: row.rowKey,
        itemText: row.content,
        mandatory: /必选|必须|应|▲/.test(row.content) ? true : undefined,
        confidence: 0.78,
      });
    }
  }
  return out;
}
