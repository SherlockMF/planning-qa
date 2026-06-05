import type { NormalizedCellValue } from "../objects";

const DASH_ONLY_RE = /^[-—–~～/\\]*$/;
const NUMBER_RE = /-?\d+(?:\.\d+)?/g;
const UNIT_RE =
  /(平方米\/处|平方米|平方千米|公顷|千米|公里|米|m2|㎡|%|％|万人|人|户|处|个|项|辆|层)/i;

export function normalizeCellValue(
  raw: string,
  headerContext = ""
): NormalizedCellValue {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { raw, kind: "empty", comparator: "unknown" };
  if (DASH_ONLY_RE.test(text)) {
    return { raw, kind: "not_applicable", comparator: "unknown" };
  }

  const qualifiers = extractQualifiers(text);
  const unit = extractUnit(text) ?? extractUnit(headerContext);
  const numbers = [...text.matchAll(NUMBER_RE)].map((m) => Number(m[0]));
  const comparator = detectComparator(text);

  if (numbers.length >= 2 && /[-—–~～至到]/.test(text)) {
    return {
      raw,
      kind: unit?.includes("%") || unit?.includes("％") ? "percentage" : "range",
      min: numbers[0],
      max: numbers[1],
      unit,
      comparator: "range",
      qualifiers,
    };
  }

  if (numbers.length >= 1) {
    const value = numbers[0];
    const valueKind = unit?.includes("%") || unit?.includes("％") ? "percentage" : "number";
    if (comparator === ">=") {
      return { raw, kind: valueKind, min: value, unit, comparator, qualifiers };
    }
    if (comparator === "<=") {
      return { raw, kind: valueKind, max: value, unit, comparator, qualifiers };
    }
    if (comparator === ">" || comparator === "<") {
      return { raw, kind: valueKind, value, unit, comparator, qualifiers };
    }
    return { raw, kind: valueKind, value, unit, comparator: "=", qualifiers };
  }

  return {
    raw,
    kind: "text",
    unit,
    comparator: "unknown",
    qualifiers,
  };
}

export function normalizeFields(
  fields: Record<string, string>
): Record<string, NormalizedCellValue> {
  const out: Record<string, NormalizedCellValue> = {};
  for (const [header, value] of Object.entries(fields)) {
    out[header] = normalizeCellValue(value, header);
  }
  return out;
}

function detectComparator(text: string): NormalizedCellValue["comparator"] {
  if (/不小于|不少于|不低于|大于等于|≥|>=/.test(text)) return ">=";
  if (/不大于|不超过|不高于|小于等于|≤|<=/.test(text)) return "<=";
  if (/大于|超过|>/.test(text)) return ">";
  if (/小于|低于|</.test(text)) return "<";
  return "unknown";
}

function extractUnit(text: string): string | undefined {
  return text.match(UNIT_RE)?.[1];
}

function extractQualifiers(text: string): string[] {
  const qualifiers: string[] = [];
  const patterns = [
    "原则上",
    "宜",
    "可",
    "应",
    "应当",
    "必须",
    "不得",
    "不应",
    "不少于",
    "不低于",
    "不小于",
    "不大于",
    "不超过",
    "每千人",
    "每处",
    "每个项目",
    "每个社区",
    "每个街道",
  ];
  for (const p of patterns) {
    if (text.includes(p)) qualifiers.push(p);
  }
  return qualifiers;
}
