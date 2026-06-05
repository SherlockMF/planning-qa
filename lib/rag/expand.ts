// ============================================================================
// 命中扩展（需求 9）
// ----------------------------------------------------------------------------
// 检索命中后补全上下文，让 LLM 与引用卡片看到必要的结构信息：
//  - 命中 table_row/code：补「所属表名 + 表头」（从同表 table_full 查 tableId）；
//  - 命中 clause/clause_explanation：补「章节路径 + 父标题」。
// 实现方式：浅拷贝 chunk 并在 content 前置一行扩展上下文，下游 toContextChunk /
// toCitation 无需改动即可受益。
// ============================================================================

import type { Chunk, ContextRole, RetrievedChunk } from "@/lib/types";

/** 对单条命中做上下文扩展，返回（可能替换了 chunk 的）新 RetrievedChunk。 */
export function expandHit(
  r: RetrievedChunk,
  byId: Map<string, Chunk>
): RetrievedChunk {
  const c = r.chunk;

  // ── 表格行/代码：补表名 + 表头 ──
  if (c.chunkType === "table_row" || c.chunkType === "code") {
    const parent = c.parentChunkId ? byId.get(c.parentChunkId) : undefined;
    const title = c.tableTitle ?? parent?.tableTitle;
    const headers = c.tableHeaders ?? parent?.tableHeaders;
    const prefixParts: string[] = [];
    if (title) prefixParts.push(`所属表：${title}`);
    if (headers && headers.length)
      prefixParts.push(`表头：${headers.filter(Boolean).join(" | ")}`);
    if (prefixParts.length) {
      return withContent(r, `【${prefixParts.join("；")}】\n${c.content}`, ["expanded_parent"]);
    }
    return asDirectHit(r);
  }

  // ── 条款/条文说明：补章节路径 + 父标题 ──
  if (c.chunkType === "clause" || c.chunkType === "clause_explanation") {
    const parts: string[] = [];
    if (c.sectionPath) parts.push(c.sectionPath);
    if (c.headingText && c.headingText !== c.sectionPath)
      parts.push(c.headingText);
    // clause_explanation 额外补其父条款正文开头
    if (c.chunkType === "clause_explanation" && c.parentChunkId) {
      const parent = byId.get(c.parentChunkId);
      if (parent) parts.push(`对应条款：${parent.content.slice(0, 40)}`);
    }
    if (parts.length) {
      const roles: ContextRole[] =
        c.chunkType === "clause_explanation" ? ["expanded_explanation"] : ["expanded_parent"];
      return withContent(r, `【所属章节：${parts.join(" / ")}】\n${c.content}`, roles);
    }
    return asDirectHit(r);
  }

  return asDirectHit(r);
}

/** 浅拷贝 RetrievedChunk，仅替换 chunk.content（保留 id/embedding 等）。 */
function withContent(
  r: RetrievedChunk,
  content: string,
  expandedContextRoles: ContextRole[]
): RetrievedChunk {
  return {
    ...r,
    contextRole: "direct_hit",
    expandedContextRoles,
    chunk: { ...r.chunk, content },
  };
}

function asDirectHit(r: RetrievedChunk): RetrievedChunk {
  return { ...r, contextRole: r.contextRole ?? "direct_hit" };
}
