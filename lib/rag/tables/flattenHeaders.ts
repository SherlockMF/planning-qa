import type { TableHeader } from "../objects";

const HEADER_KEYWORDS: Array<[RegExp, string]> = [
  [/代码|编号/, "code"],
  [/名称|设施|项目|事项|图纸/, "name"],
  [/类别|分类/, "category"],
  [/层级|等级/, "level"],
  [/内容|说明|范围|含义|定义/, "description"],
  [/建筑面积/, "building_area"],
  [/用地面积/, "land_area"],
  [/服务半径/, "service_radius"],
  [/服务规模/, "service_scale"],
  [/数量|规模/, "scale"],
  [/单位/, "unit"],
  [/要求/, "requirement"],
  [/阶段/, "stage"],
];

export function flattenHeaders(
  headers: string[],
  headerPaths?: string[][]
): TableHeader[] {
  const seen = new Map<string, number>();
  return headers.map((raw, index) => {
    const cleaned = (raw || `列${index + 1}`).replace(/\s+/g, " ").trim();
    const explicitPath = headerPaths?.[index]
      ?.map((part) => part.trim())
      .filter(Boolean);
    const path = explicitPath?.length
      ? explicitPath
      : cleaned
          .split(/[—–-]+/)
          .map((part) => part.trim())
          .filter(Boolean);
    const pathDisplay = path.join("-");
    const name = explicitPath?.length && cleaned && cleaned !== pathDisplay
      ? cleaned
      : (path.length ? path : [cleaned]).join(".");
    const unit = extractHeaderUnit(cleaned);
    const baseKey = machineKey(name, index);
    const n = seen.get(baseKey) ?? 0;
    seen.set(baseKey, n + 1);
    const key = n === 0 ? baseKey : `${baseKey}_${n + 1}`;
    return {
      raw,
      name,
      key,
      path: path.length ? path : [cleaned],
      unit,
      originalIndex: index,
    };
  });
}

export function machineKey(header: string, index = 0): string {
  for (const [re, key] of HEADER_KEYWORDS) {
    if (re.test(header)) return key;
  }
  const ascii = header
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || `col_${index + 1}`;
}

function extractHeaderUnit(header: string): string | undefined {
  const match = header.match(/[（(]([^）)]+)[）)]\s*$/);
  return match?.[1]?.trim();
}
