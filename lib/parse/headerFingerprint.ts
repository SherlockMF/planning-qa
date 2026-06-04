// ============================================================================
// 表头指纹（P1 #7：续表识别）— 纯函数，无依赖
// ----------------------------------------------------------------------------
// 把列名归一化为指纹，用于判定「无标题续表」：若当前页表格的表头指纹与上一页
// 表格高度相似，即视为同一张表的延续（即使没有"续表"字样）。
// ============================================================================

/** 列名归一化：去单位括号、去标点/空白、小写。 */
export function normHeader(h: string): string {
  return (h ?? "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s\-—－/、，,。.:：|]+/g, "")
    .toLowerCase();
}

/** 表头指纹：归一化列名按 "|" 连接。 */
export function headerFingerprint(headers: string[]): string {
  return headers.map(normHeader).filter(Boolean).join("|");
}

/** 两个指纹是否高度相似（Jaccard ≥ 0.6），用于判定续表。 */
export function fingerprintSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const A = new Set(a.split("|"));
  const B = new Set(b.split("|"));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...A, ...B]).size;
  return union > 0 && inter / union >= 0.6;
}
