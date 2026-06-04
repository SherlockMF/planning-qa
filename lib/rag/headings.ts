// ============================================================================
// 扩展标题识别（需求 2）
// ----------------------------------------------------------------------------
// 规划法规/技术标准/编制指南的标题层级很多：部分/篇/章/节/一、/1、/1.1/1.0.3/
// （1）/表X。本模块给出有序模式表与统一识别入口，供 profile 与 chunk 共用。
// 识别遵循"先高层级后低层级"，同一行只归一种标题类型。
// ============================================================================

const CN_NUM = "零一二三四五六七八九十百千";

export interface HeadingMatch {
  /** 层级，1 最高 */
  level: number;
  /** 命中的模式名 */
  pattern: string;
  /** 标题正文（去掉编号前缀后的剩余文本，可能为空） */
  text: string;
  /** 标题编号原文（如 "第三章" "1.0.3" "（2）"） */
  marker: string;
}

interface HeadingRule {
  name: string;
  level: number;
  re: RegExp;
}

/**
 * 有序标题规则表。匹配时从上到下，命中即返回（高层级优先）。
 * 所有正则都以 ^ 锚定行首（允许前导空白）。
 */
const HEADING_RULES: HeadingRule[] = [
  // 第X部分
  { name: "part", level: 1, re: new RegExp(`^\\s*第[${CN_NUM}]+部\\s*分`) },
  // 第X篇 / 第X篇章
  { name: "volume", level: 1, re: new RegExp(`^\\s*第[${CN_NUM}]+篇(章)?`) },
  // 第X章
  { name: "chapter", level: 2, re: new RegExp(`^\\s*第[${CN_NUM}]+章`) },
  // 第X节
  { name: "section", level: 3, re: new RegExp(`^\\s*第[${CN_NUM}]+节`) },
  // 第X条（法规条文）
  { name: "article", level: 4, re: new RegExp(`^\\s*第[${CN_NUM}0-9]+条`) },
  // 标准条文号 1.0.3 / 3.0.3 / 4.2.1（三段及以上点分数字）
  { name: "clause-dot3", level: 4, re: /^\s*\d+(?:\.\d+){2,}(?![.\d])/ },
  // 一、二、三、
  { name: "cn-dun", level: 5, re: new RegExp(`^\\s*[${CN_NUM}]+[、．.]`) },
  // 1.1 / 2.4（两段点分数字）
  { name: "num-dot2", level: 5, re: /^\s*\d+\.\d+(?![.\d])/ },
  // 1、2、3、 或 1. 2.
  { name: "num-dun", level: 6, re: /^\s*\d+[、．.](?!\d)/ },
  // （1）（2） / (1)
  { name: "paren-num", level: 7, re: /^\s*[（(]\s*\d+\s*[)）]/ },
  // ① ② ③
  { name: "circle-num", level: 7, re: /^\s*[①-⑳]/ },
];

/** 表格标题：表1—1 / 表3.0.3 / 表 1-1 / 续表3.0.3 / 附表A.1 */
const TABLE_CAPTION_RE =
  /^\s*(续表|附表|表)\s*[A-Za-z]?[\d０-９]+(?:[—\-－.．][A-Za-z\d０-９]+)*/;

/**
 * 识别一行是否为标题。命中返回 HeadingMatch，否则 null。
 * 注意：表格标题不在此处返回（用 detectTableCaption），避免污染 heading tree。
 */
export function detectHeading(line: string): HeadingMatch | null {
  const raw = line.replace(/^\[\[T\]\]/, ""); // 去表格行标记后再判断
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 标题行通常不含 \t（表格行才有多列）；含多列的优先视为表格
  if (trimmed.includes("\t")) return null;

  for (const rule of HEADING_RULES) {
    const m = rule.re.exec(raw);
    if (m) {
      const marker = m[0].trim();
      const text = raw.slice(m[0].length).trim();
      // 防误判：编号项后面若是大段长文本（>40字）且无标题特征，视为正文编号项而非标题。
      // 仅对低层级（list 风格）做此约束；高层级（章/节/部分/篇）保持标题。
      if (rule.level >= 5 && text.length > 40) return null;
      return { level: rule.level, pattern: rule.name, text, marker };
    }
  }
  return null;
}

/** 识别表格标题行（表X / 续表X / 附表X）。命中返回标题文本。 */
export function detectTableCaption(line: string): string | null {
  const raw = line.replace(/^\[\[T\]\]/, "");
  const m = TABLE_CAPTION_RE.exec(raw);
  if (!m) return null;
  return raw.trim();
}

/** 是否为"续表"标题（用于跨页表头继承）。 */
export function isContinuedTable(line: string): boolean {
  return /^\s*(\[\[T\]\])?\s*续表/.test(line);
}

/** 提取标准条文号（如 "3.0.3" / "第十二条"），用于 clauseNo 元数据。 */
export function extractClauseNo(line: string): string | null {
  const raw = line.replace(/^\[\[T\]\]/, "").trim();
  const dot = /^(\d+(?:\.\d+){1,})/.exec(raw);
  if (dot) return dot[1];
  const cn = new RegExp(`^(第[${CN_NUM}0-9]+条)`).exec(raw);
  if (cn) return cn[1];
  return null;
}
