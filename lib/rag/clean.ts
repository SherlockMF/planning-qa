// ============================================================================
// 清洗（需求 6、8.8）
// ----------------------------------------------------------------------------
// 在 Block[] 进入切分前过滤噪声：
//  - 目录页：整页以"标题…数字页码"或大量引导点（……）构成 → 丢弃；
//  - 页眉/页脚：相同短文本跨 ≥3 页重复 → 过滤；
//  - 页码：纯页码行（IR 已大多剥离，这里兜底）→ 丢弃；
//  - image_page：保留为占位 block（不进向量库由 chunk 决定）。
// 标题模式行不在此处删除（水印过滤已在 extractText 阶段豁免标题）。
// ============================================================================

import type { Block } from "@/lib/types";

/** 目录行特征：含 ≥3 个连续点/省略号引导，且以数字结尾。 */
const TOC_LINE_RE = /[.．·…]{3,}\s*\d{1,4}\s*$/;

/** 一页是否为目录页：该页正文/标题 block 中过半命中目录行特征。 */
function isTocPage(pageBlocks: Block[]): boolean {
  const textBlocks = pageBlocks.filter(
    (b) => b.type === "paragraph" || b.type === "list_item" || b.type === "heading"
  );
  if (textBlocks.length < 4) return false;
  const tocLike = textBlocks.filter((b) => TOC_LINE_RE.test(b.rawText)).length;
  return tocLike / textBlocks.length >= 0.5;
}

/** 纯页码行兜底判定。 */
function isPageNumberLike(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^[—\-－\s]*\d{1,4}[—\-－\s]*$/.test(t) || /^第?\s*\d{1,4}\s*页$/.test(t);
}

export interface CleanResult {
  blocks: Block[];
  droppedTocPages: number[];
  droppedHeaderFooter: number;
}

/** 清洗 Block[]。 */
export function cleanBlocks(blocks: Block[]): CleanResult {
  // 1. 按页分组
  const byPage = new Map<number, Block[]>();
  for (const b of blocks) {
    const arr = byPage.get(b.pageStart) ?? [];
    arr.push(b);
    byPage.set(b.pageStart, arr);
  }

  // 2. 找目录页
  const tocPages = new Set<number>();
  for (const [page, pb] of byPage) {
    if (isTocPage(pb)) tocPages.add(page);
  }

  // 3. 跨页重复页眉/页脚：统计短文本（≤30 字、非表格）出现的不同页数
  const textPages = new Map<string, Set<number>>();
  for (const b of blocks) {
    if (b.type !== "paragraph" && b.type !== "heading") continue;
    const t = b.normalizedText.trim();
    if (!t || t.length > 30) continue;
    const set = textPages.get(t) ?? new Set<number>();
    set.add(b.pageStart);
    textPages.set(t, set);
  }
  const totalPages = byPage.size;
  const repeatedHF = new Set<string>();
  for (const [t, pages] of textPages) {
    // 出现在 ≥3 页且占总页数 ≥30% → 视为页眉页脚
    if (pages.size >= 3 && pages.size / Math.max(totalPages, 1) >= 0.3) {
      repeatedHF.add(t);
    }
  }

  // 4. 过滤
  let droppedHeaderFooter = 0;
  const kept = blocks.filter((b) => {
    if (tocPages.has(b.pageStart) && b.type !== "image_page") return false;
    if (
      (b.type === "paragraph" || b.type === "heading") &&
      repeatedHF.has(b.normalizedText.trim())
    ) {
      // 标题模式行豁免：headingPattern 命中的不删（避免误删正文标题）
      if (b.type === "heading" && b.headingPattern) return true;
      droppedHeaderFooter++;
      return false;
    }
    if (
      (b.type === "paragraph" || b.type === "list_item") &&
      isPageNumberLike(b.normalizedText)
    ) {
      return false;
    }
    return true;
  });

  return {
    blocks: kept,
    droppedTocPages: Array.from(tocPages),
    droppedHeaderFooter,
  };
}
