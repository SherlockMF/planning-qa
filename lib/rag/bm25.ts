// ============================================================================
// BM25 检索（需求 9）
// ----------------------------------------------------------------------------
// 取代原 IDF 关键词重叠：对每个 chunk 的检索文本（content + keywords + aliases +
// code + clauseNo + tableTitle + rowKey）建词频索引，按 BM25 打分。
// 中文用 2-gram + 单字；代码/表号/条款号/英文数字作为整词索引，支持精确召回。
// ============================================================================

import type { Chunk } from "@/lib/types";

const K1 = 1.5;
const B = 0.75;

/** 分词：英文/数字整词 + 代码(A11) + 表号(表3.0.3) + 条款号 + 中文单字与 2-gram。 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  const lower = text.toLowerCase();

  // 英文 / 数字串（含小数、连字符区间，如 1.0 / 40-50 / a11）
  for (const m of lower.matchAll(/[a-z]+\d+|\d+(?:[.\-~]\d+)*|[a-z]{2,}/g)) {
    tokens.push(m[0]);
  }
  // 用地/分类代码整词（A11 / R2 / B1）
  for (const m of text.matchAll(/[A-Za-z]\d{1,3}/g)) tokens.push(m[0].toUpperCase());
  // 表号 / 条款号整词
  for (const m of text.matchAll(/[一二三四五六七八九十百0-9]+(?:\.\d+)+/g))
    tokens.push(m[0]);
  for (const m of text.matchAll(/第[一二三四五六七八九十百零0-9]+条/g))
    tokens.push(m[0]);

  // 中文：单字 + 2-gram
  const han = text.match(/[一-龥]/g);
  if (han) {
    for (let i = 0; i < han.length; i++) {
      tokens.push(han[i]);
      if (i < han.length - 1) tokens.push(han[i] + han[i + 1]);
    }
  }
  return tokens;
}

/** 单个 chunk 的可检索文本融合。 */
function chunkText(c: Chunk): string {
  return [
    c.content,
    (c.keywords ?? []).join(" "),
    (c.aliases ?? []).join(" "),
    c.code ?? "",
    c.clauseNo ?? "",
    c.tableTitle ?? "",
    c.rowKey ?? "",
    c.headingText ?? "",
  ].join(" ");
}

interface Doc {
  chunk: Chunk;
  tf: Map<string, number>;
  len: number;
}

export class BM25Index {
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;
  private N = 0;

  constructor(chunks: Chunk[]) {
    for (const chunk of chunks) {
      const tokens = tokenize(chunkText(chunk));
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ chunk, tf, len: tokens.length });
    }
    this.N = this.docs.length;
    this.avgLen =
      this.docs.reduce((s, d) => s + d.len, 0) / Math.max(this.N, 1);
  }

  private idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    // BM25 idf（加 1 平滑，恒为正）
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
  }

  /** 返回每个 chunk 的 BM25 得分（>0）及命中词，按分降序。 */
  search(
    queryTokens: string[]
  ): { chunk: Chunk; score: number; matched: string[] }[] {
    const qset = Array.from(new Set(queryTokens.filter(Boolean)));
    const out: { chunk: Chunk; score: number; matched: string[] }[] = [];
    for (const d of this.docs) {
      let score = 0;
      const matched: string[] = [];
      for (const term of qset) {
        const f = d.tf.get(term);
        if (!f) continue;
        const denom = f + K1 * (1 - B + (B * d.len) / (this.avgLen || 1));
        score += this.idf(term) * ((f * (K1 + 1)) / denom);
        matched.push(term);
      }
      if (score > 0) out.push({ chunk: d.chunk, score, matched });
    }
    return out.sort((a, b) => b.score - a.score);
  }
}
