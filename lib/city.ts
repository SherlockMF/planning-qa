// ============================================================================
// 城市归一化与匹配
// ----------------------------------------------------------------------------
// 问答页固定查询城市（MVP 单城市），上传时城市为自由文本输入。
// 检索过滤必须容忍"北京/北京市"等写法差异，且"未知/通用"城市的文档
// 对任何查询城市可见 —— 否则文档解析成功却永远搜不到，且无任何提示。
// ============================================================================

/** 问答页与评测使用的默认城市（MVP 单城市）。 */
export const DEFAULT_CITY = "北京";

/** 视为"不限定城市"的取值（归一化后比较）。 */
const CITY_WILDCARDS = new Set(["", "未知", "通用", "全国", "不限"]);

/** 归一化城市名：去空白、去末尾"市"。 */
export function normalizeCity(city?: string | null): string {
  return (city ?? "").trim().replace(/市$/, "");
}

/**
 * 文档城市对查询城市是否可见：
 *  - 查询未指定城市 → 全部可见；
 *  - 文档城市为空/未知/通用 → 对任何查询城市可见；
 *  - 否则归一化后相等才可见。
 */
export function cityMatches(
  chunkCity: string | undefined,
  queryCity: string | undefined
): boolean {
  const q = normalizeCity(queryCity);
  if (!q || CITY_WILDCARDS.has(q)) return true;
  const c = normalizeCity(chunkCity);
  if (CITY_WILDCARDS.has(c)) return true;
  return c === q;
}
