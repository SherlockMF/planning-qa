import type { Block } from "../types";

export interface SectionNode {
  id: string;
  title: string;
  level: number;
  numbering?: string;
  sectionPath: string[];
  blockIds: string[];
  children: SectionNode[];
  parentId?: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
}

export interface SectionTree {
  root: SectionNode;
  nodes: SectionNode[];
  blockSectionMap: Record<string, string[]>;
}

const CLAUSE_HEADING_PATTERNS = new Set(["article", "clause-dot3"]);

export function blockIdAt(index: number): string {
  return `block-${index}`;
}

export function buildSectionTree(blocks: Block[]): SectionTree {
  const root: SectionNode = {
    id: "section-root",
    title: "ROOT",
    level: 0,
    sectionPath: [],
    blockIds: [],
    children: [],
  };
  const nodes: SectionNode[] = [root];
  const blockSectionMap: Record<string, string[]> = {};
  const stack: SectionNode[] = [root];

  blocks.forEach((block, index) => {
    const blockId = blockIdAt(index);
    const headingPattern = block.headingPattern ?? "";

    if (
      block.type === "heading" &&
      headingPattern !== "table-caption" &&
      !CLAUSE_HEADING_PATTERNS.has(headingPattern)
    ) {
      const level = Math.max(1, block.level ?? 5);
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      const numbering = extractNumbering(block.normalizedText);
      const node: SectionNode = {
        id: `section-${nodes.length}`,
        title: block.normalizedText,
        level,
        numbering,
        sectionPath: [...parent.sectionPath, block.normalizedText],
        blockIds: [blockId],
        children: [],
        parentId: parent.id,
        sourcePageStart: block.pageStart,
        sourcePageEnd: block.pageEnd,
      };
      parent.children.push(node);
      nodes.push(node);
      stack.push(node);
      blockSectionMap[blockId] = node.sectionPath;
      updateNodePages(parent, block);
      return;
    }

    const current = stack[stack.length - 1];
    current.blockIds.push(blockId);
    blockSectionMap[blockId] = current.sectionPath;
    updateNodePages(current, block);
  });

  return { root, nodes, blockSectionMap };
}

export function getSectionPathForBlock(
  tree: SectionTree,
  blockId: string
): string[] {
  return tree.blockSectionMap[blockId] ?? [];
}

function updateNodePages(node: SectionNode, block: Block): void {
  node.sourcePageStart =
    node.sourcePageStart == null
      ? block.pageStart
      : Math.min(node.sourcePageStart, block.pageStart);
  node.sourcePageEnd =
    node.sourcePageEnd == null
      ? block.pageEnd
      : Math.max(node.sourcePageEnd, block.pageEnd);
}

function extractNumbering(text: string): string | undefined {
  return (
    text.match(/^\s*(第[零一二三四五六七八九十百千0-9]+[章节条部篇])/)
      ?.at(1) ??
    text.match(/^\s*([零一二三四五六七八九十百千]+[、．.]|\d+(?:\.\d+)*[、．.]?)/)
      ?.at(1)
  );
}
