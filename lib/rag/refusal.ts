// ============================================================================
// 拒答机制
// ----------------------------------------------------------------------------
// 在两个阶段判断是否拒答：
//  1. 检索前（范围判断）：超出 MVP 范围的问题直接拒答；
//  2. 检索后（依据判断）：检索为空 / 相关度过低 / 缺少对应主体或数值时拒答。
// ============================================================================

import type { Chunk, RetrievedChunk } from "@/lib/types";
import { containsNumeric, LAND_USE_RE } from "./patterns";

/** 表格行的结构化 fields 是否含数值（单位常在列表头，故只看是否有数字）。 */
function hasNumericField(chunk: Chunk): boolean {
  if (!chunk.fields) return false;
  return Object.values(chunk.fields).some((v) => /\d/.test(v));
}

export interface RefusalResult {
  shouldRefuse: boolean;
  /** 简短原因标签，用于评测统计 */
  reasonCode?: string;
  /** 面向用户的原因说明 */
  reason?: string;
}

/** 超出 MVP 范围的问题模式（检索前判断）。 */
const OUT_OF_SCOPE_PATTERNS: { re: RegExp; code: string; reason: string }[] = [
  {
    re: /是否可行|能否(实现|满足)|组合.*(可行|合理)|可不可行/,
    code: "指标组合可行性判断",
    reason:
      "该问题需要判断容积率、限高、建筑密度等指标组合是否可行，属于规划方案可行性判断，超出本助手"
      + "「法规条文查询」的范围。",
  },
  {
    re: /审批|批不批|能不能(通过|批)|是否(合规|合法|通过)|能否通过/,
    code: "审批结论判断",
    reason:
      "该问题需要给出规划审批结论，属于审批判断，超出本助手「法规条文查询」的范围，应由具有审批职权的"
      + "部门依据具体材料认定。",
  },
  {
    re: /法律意见|是否违法|法律责任|起诉|诉讼/,
    code: "法律意见",
    reason: "该问题涉及法律意见，超出本助手「法规条文查询」的范围。",
  },
  {
    re: /投资|测算|造价|成本|收益|回报/,
    code: "投资测算",
    reason: "该问题涉及投资或经济测算，超出本助手「法规条文查询」的范围。",
  },
  {
    re: /cad|dwg|gis|shp|图纸解析|读取图|解析图/i,
    code: "CAD/GIS解析",
    reason: "该问题涉及 CAD / GIS 图形解析，超出本助手「法规条文查询」的范围。",
  },
];

/** 检索前：范围判断。 */
export function checkScope(question: string): RefusalResult {
  for (const p of OUT_OF_SCOPE_PATTERNS) {
    if (p.re.test(question)) {
      return { shouldRefuse: true, reasonCode: p.code, reason: p.reason };
    }
  }
  return { shouldRefuse: false };
}

/** 问题中表达"想要具体数值/标准"的意图。 */
const WANT_NUMBER_RE = /多少|上限|最高|最低|不低于|不高于|不少于|标准|指标|比例|几个|配建/;

const MIN_EVIDENCE_SCORE = 0.10;
/** 依据判断时考察的候选数量：只要答案落在检索 Top-N 内即可作答。 */
const EVIDENCE_WINDOW = 5;

/**
 * 检索后：依据判断。
 * 关键原则：判断依据要与「调试页能搜出的内容」一致 —— 只要正确条文进入
 * 检索 Top-N，就应当作答，而不是仅看排名第一的 chunk。否则会出现
 * “调试能搜到、问答却拒答”的割裂。
 */
export function checkEvidence(
  question: string,
  results: RetrievedChunk[]
): RefusalResult {
  // 检索结果为空
  if (results.length === 0) {
    return {
      shouldRefuse: true,
      reasonCode: "检索结果为空",
      reason: "当前知识库未检索到与该问题相关的条文。",
    };
  }

  const top = results[0];
  const window = results.slice(0, EVIDENCE_WINDOW);

  // 整体相关度过低（最相关的 chunk 都达不到阈值）
  if (top.rerankScore < MIN_EVIDENCE_SCORE) {
    return {
      shouldRefuse: true,
      reasonCode: "相关度过低",
      reason: "检索到的条文与问题相关度过低，无法作为确定依据。",
    };
  }

  // 问题指向某一具体用地类型，但 Top-N 依据均未覆盖该用地类型
  const questionLandUse = (question.match(LAND_USE_RE) ?? []).map((s) =>
    s.toUpperCase()
  );
  if (questionLandUse.length > 0) {
    const covered = window.some((r) => {
      const text = r.chunk.content.toUpperCase();
      return questionLandUse.some((lu) => text.includes(lu));
    });
    if (!covered) {
      return {
        shouldRefuse: true,
        reasonCode: "缺少对应用地类型条文",
        reason:
          "知识库中检索到的条文未针对问题所指的用地类型作出明确规定，无法据此给出确定结论。",
      };
    }
  }

  // 问题要数值/标准，但 Top-N 依据均不含任何数值。
  // 表格行的数值常落在单元格里，而单位在列表头（如「建筑面积(平方米)」列 = 150），
  // 此时 content 里「150」不与单位相邻，containsNumeric 会漏判 —— 因此对表格行
  // 额外检查其结构化 fields 是否含数值，避免误拒答。
  if (WANT_NUMBER_RE.test(question)) {
    const hasNumber = window.some(
      (r) => containsNumeric(r.chunk.content) || hasNumericField(r.chunk)
    );
    if (!hasNumber) {
      return {
        shouldRefuse: true,
        reasonCode: "缺少明确数值",
        reason:
          "知识库中检索到的相关条文未给出明确数值或量化标准，无法据此给出确定结论。",
      };
    }
  }

  return { shouldRefuse: false };
}
