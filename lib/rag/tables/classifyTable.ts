import type { StructuredTableType } from "../objects";

export interface TableClassification {
  tableType: StructuredTableType;
  confidence: number;
  matchedSignals: string[];
}

interface ClassifyInput {
  title?: string;
  headers: string[];
  rows: string[][];
  sectionPath?: string[];
}

const SIGNALS: Array<{
  type: StructuredTableType;
  weight: number;
  re: RegExp;
  label: string;
}> = [
  { type: "classification_code_table", weight: 3, re: /代码|类别代码|分类代码|编号/, label: "code_header" },
  { type: "classification_code_table", weight: 2, re: /名称|类别名称|项目名称/, label: "name_header" },
  { type: "classification_code_table", weight: 2, re: /内容|含义|说明|范围|定义/, label: "description_header" },
  { type: "indicator_table", weight: 3, re: /指标|规模|配置|标准|控制要求/, label: "indicator_title" },
  { type: "indicator_table", weight: 2, re: /面积|数量|比例|服务半径|服务规模|人口|户数|容积率|绿地率|高度|密度|单位/, label: "indicator_header" },
  { type: "requirement_table", weight: 3, re: /要求|详细配置要求|布局引导|使用说明|管控/, label: "requirement_signal" },
  { type: "deliverable_table", weight: 4, re: /成果名称|图纸名称|成果类型|图纸目录|成果要求|图纸要求/, label: "deliverable_header" },
  { type: "deliverable_table", weight: 3, re: /成果|图纸|附件|数据库|附表|图则|导则|编制内容/, label: "deliverable_signal" },
  { type: "checklist_table", weight: 3, re: /清单|任务|问题|项目|政策|事项/, label: "checklist_signal" },
  { type: "comparison_table", weight: 2, re: /现状|规划|对比|变化|调整/, label: "comparison_signal" },
  { type: "statistics_table", weight: 2, re: /统计|合计|小计|比例|汇总/, label: "statistics_signal" },
];

export function classifyTable(input: ClassifyInput): TableClassification {
  const surface = [
    input.title,
    ...(input.sectionPath ?? []),
    ...input.headers,
    ...input.rows.slice(0, 5).flat(),
  ]
    .filter(Boolean)
    .join(" ");

  const scores = new Map<StructuredTableType, number>();
  const matchedSignals: string[] = [];
  for (const signal of SIGNALS) {
    if (signal.re.test(surface)) {
      scores.set(signal.type, (scores.get(signal.type) ?? 0) + signal.weight);
      matchedSignals.push(signal.label);
    }
  }

  const codeHeader =
    input.headers.some((h) => /代码|编号/.test(h)) &&
    input.headers.some((h) => /名称/.test(h));
  if (codeHeader) {
    scores.set("classification_code_table", (scores.get("classification_code_table") ?? 0) + 3);
    matchedSignals.push("code_name_header_pair");
  }
  const hasCodeShapedRows = input.rows.some((row) =>
    row.some((cell) => /^[A-Za-z]\d{1,4}$|^\d{2,8}$|^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/.test(cell.trim()))
  );
  if (!codeHeader || !hasCodeShapedRows) {
    scores.delete("classification_code_table");
  }

  const numericCells = input.rows
    .flat()
    .filter((cell) => /\d/.test(cell) && /(平方米|米|户|人|%|％|处|个|—|-|~|～)/.test(cell));
  if (numericCells.length >= 2) {
    scores.set("indicator_table", (scores.get("indicator_table") ?? 0) + 2);
    matchedSignals.push("numeric_unit_cells");
  }

  let best: StructuredTableType = "unknown_table";
  let bestScore = 0;
  for (const [type, score] of scores.entries()) {
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }

  return {
    tableType: best,
    confidence: bestScore === 0 ? 0.35 : Math.min(0.95, 0.45 + bestScore * 0.08),
    matchedSignals,
  };
}
