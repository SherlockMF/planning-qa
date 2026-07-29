export type ScaleTier = {
  bedRangeRaw: string;
  buildingAreaRaw: string;
};

export type ScaleTierParse =
  | { ok: true; tiers: ScaleTier[] }
  | {
      ok: false;
      reason:
        | "glued_numeric_ranges"
        | "unpaired_lines"
        | "empty"
        | "unsupported_pattern";
    };

const RANGE_RE = /(\d+(?:\.\d+)?)\s*[-—～~]\s*(\d+(?:\.\d+)?)/;
const GLUED_RE =
  /床\s*\d+\s*[-—～~]\s*\d{2,4}\d{3,}|^\d{2,4}\s*[-—～~]\s*\d{2,4}\d{3,5}\s*[-—～~]\s*\d{3,5}/;

/**
 * 解析「一般规模.建筑面积」格内的床位档 ↔ 建筑面积配对。
 * 成功时返回 ≥1 档；粘连或无法配对时 ok=false。
 */
export function parseScaleCellTiers(raw: string): ScaleTierParse {
  const text = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, reason: "empty" };

  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  if (lines.some((line) => GLUED_RE.test(line.replace(/\s+/g, "")))) {
    return { ok: false, reason: "glued_numeric_ranges" };
  }
  if (lines.length <= 1 && GLUED_RE.test(text.replace(/\s+/g, ""))) {
    return { ok: false, reason: "glued_numeric_ranges" };
  }

  const tokens = lines.length >= 2 ? lines : tokenizeSingleLineTiers(text);
  if (tokens.length < 2) return { ok: false, reason: "unsupported_pattern" };

  const tiers: ScaleTier[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const bed = normalizeBedToken(tokens[i]);
    const area = normalizeAreaToken(tokens[i + 1]);
    if (!bed || !area) return { ok: false, reason: "unpaired_lines" };
    tiers.push({ bedRangeRaw: bed, buildingAreaRaw: area });
  }

  if (tokens.length % 2 !== 0) return { ok: false, reason: "unpaired_lines" };
  if (tiers.length === 0) return { ok: false, reason: "unsupported_pattern" };
  if (tiers.length === 1 && !/\n/.test(text) && !/床/.test(text)) {
    return { ok: false, reason: "unsupported_pattern" };
  }
  return { ok: true, tiers };
}

function tokenizeSingleLineTiers(text: string): string[] {
  // 允许无换行但可切分的「50-100床 2000-4000 100-500床 4000-15000」
  const parts =
    text.match(
      /\d+(?:\.\d+)?\s*[-—～~]\s*\d+(?:\.\d+)?\s*床?|\d+(?:\.\d+)?\s*[-—～~]\s*\d+(?:\.\d+)?/g
    ) ?? [];
  return parts.map((part) => part.trim()).filter(Boolean);
}

function normalizeBedToken(token: string): string | null {
  const range = token.match(RANGE_RE);
  if (!range) return null;
  const low = Number(range[1]);
  const high = Number(range[2]);
  if (!(low < 1000 && high < 1000)) return null;
  if (!/床/.test(token) && low >= 1000) return null;
  return `${range[1]}-${range[2]}床`;
}

function normalizeAreaToken(token: string): string | null {
  const range = token.match(RANGE_RE);
  if (!range) return null;
  const low = Number(range[1]);
  const high = Number(range[2]);
  if (!(low >= 1000 || high >= 1000 || /平方米|平米|㎡/.test(token))) return null;
  if (/床/.test(token)) return null;
  return `${range[1]}-${range[2]}`;
}

/** 是否像「一般规模.建筑面积（平方米/处）」类表头。 */
export function isGeneralScaleBuildingAreaHeader(header: string): boolean {
  if (/千人|用地/.test(header)) return false;
  if (/一般规模/.test(header) && /建筑面积/.test(header)) return true;
  // 扁平化后常变成「建筑面积 (平方米/处)」，与千人指标「建筑面积 (平方米)」区分。
  return /建筑面积/.test(header) && /平方米\s*\/\s*处|平米\s*\/\s*处|㎡\s*\/\s*处/.test(header);
}

/**
 * 将含床位档↔建筑面积配对的物理行展开/归一为逻辑行。
 * - 多档：拆成多行
 * - 单档（已按床位拆成物理行）：写入分档字段并清洗面积
 * - 粘连失败：保留原行并打 low-fidelity 警告
 */
export function expandScaleTierInRowFields(fields: Record<string, string>): {
  rows: Array<Record<string, string>>;
  warnings: string[];
} {
  const header = Object.keys(fields).find(isGeneralScaleBuildingAreaHeader);
  if (!header) return { rows: [fields], warnings: [] };

  const parsed = parseScaleCellTiers(fields[header] ?? "");
  if (!parsed.ok) {
    if (parsed.reason === "glued_numeric_ranges") {
      return {
        rows: [fields],
        warnings: ["scrambled_numeric_unit", "scale_tier_parse_failed"],
      };
    }
    return { rows: [fields], warnings: [] };
  }

  return {
    rows: parsed.tiers.map((tier) => ({
      ...fields,
      "规模性指标.一般规模.分档": tier.bedRangeRaw,
      [header]: tier.buildingAreaRaw,
    })),
    warnings: [],
  };
}
