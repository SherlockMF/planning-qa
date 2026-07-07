// 表格置信度评分 golden tests（P1，spec 第19章子集）
// 运行：node --experimental-strip-types --test tests/tableConfidence.test.ts
// 仅 import type 自 @/lib/types（运行时被类型擦除），故用相对路径导入被测函数。

import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreTableRegion,
  shouldKeepAsTable,
} from "../lib/rag/tableConfidence.ts";

function rows(...rs: string[][]): string[][] {
  return rs;
}

test("指标表：多列 + 数值指标 → 保留，候选 indicator", () => {
  const c = scoreTableRegion(
    rows(
      ["层级", "设施名称", "建筑面积", "千人指标", "服务规模"],
      ["项目级", "物业服务用房", "150", "40-50", "每个项目1处"],
      ["居住社区级", "社区卫生服务中心", "1700", "85-100", "每3-5万人1处"],
      ["居住社区级", "养老服务驿站", "350", "20-30", "每个社区1处"]
    )
  );
  assert.ok(shouldKeepAsTable(c), "应保留为表格");
  assert.ok(c.tableTypeCandidates.includes("indicator_table"));
  assert.ok(c.score >= 0.6, `score=${c.score}`);
});

test("配置要求表：长文本 + 数字少 → 仍保留（旧规则会误杀）", () => {
  const c = scoreTableRegion(
    rows(
      ["设施名称", "配置要求类型", "详细配置要求"],
      [
        "物业服务用房",
        "布局引导要求",
        "宜选址在交通便利区域，邻近主要步行出入口布置；可利用采光窗位于地上的半地下室或具有下沉广场的地下室，在满足消防、自然通风及采光等安全、健康条件下设置。",
      ],
      [
        "社区服务站",
        "指标使用说明",
        "建筑面积指综合服务设施的总建筑面积，包含办公、活动、辅助用房等，不含地下停车部分。",
      ],
      [
        "社区卫生服务中心",
        "管控要求",
        "应独立占地或独立设置，不应与污染源、危险源毗邻，并满足无障碍通行要求。",
      ]
    )
  );
  assert.ok(shouldKeepAsTable(c), "配置要求表不应被误判为段落");
  assert.ok(c.tableTypeCandidates.includes("requirement_table"));
});

test("代码分类表：2 列 + 代码定义跨行 → 保留，候选 code", () => {
  const c = scoreTableRegion(
    rows(
      ["类别代码", "类别名称", "内容"],
      ["A2", "文化设施用地", "图书、展览、文化活动等设施用地"],
      ["A21", "图书展览用地", "公共图书馆、博物馆、档案馆、科技馆等设施用地"],
      ["A22", "文化活动用地", "综合文化活动中心、文化馆、青少年宫等设施用地"]
    )
  );
  assert.ok(shouldKeepAsTable(c));
  assert.ok(c.tableTypeCandidates.includes("code_table"));
});

test("假表格：普通段落被误标 [[T]]（单列长句）→ 回退为段落", () => {
  const c = scoreTableRegion(
    rows(
      ["本条规定了居住用地的绿地率控制要求。"],
      ["居住用地的绿地率不应低于百分之三十。"],
      ["旧区改建确有困难的，不应低于百分之二十五。"]
    )
  );
  assert.ok(!shouldKeepAsTable(c), "单列长句不应被当作表格");
  assert.ok(c.negativeReasons.includes("single_column"));
});

test("两列纯散文碎片（无类型信号、列数不稳）→ 回退", () => {
  const c = scoreTableRegion(
    rows(
      ["前款所称建设项目", "是指依法需要办理规划许可的各类工程"],
      ["本办法自发布之日起施行"],
      ["原有规定与本办法不一致的"]
    )
  );
  assert.ok(!shouldKeepAsTable(c), `应回退, score=${c.score}, cand=${c.tableTypeCandidates}`);
});

test("空表头 + 长散文单元格 + 高标点密度 → 回退为段落", () => {
  const c = scoreTableRegion(
    rows(
      ["", ""],
      [
        "综合考虑出生人口变化趋势、各年龄组占居住人口比例、公共服务设施承载能力等因素，延续既有核算标准。",
        "核算说明仅用于解释指标测算口径，不构成可按行列检索的配置指标表。",
      ],
      [
        "实际使用中，应结合所在地区人口结构、服务半径、建设条件等进行校核。",
        "如相关专项规划另有规定，应以经批准的专项规划和原文页面为准。",
      ]
    )
  );
  assert.ok(!shouldKeepAsTable(c), `应回退, score=${c.score}, reasons=${c.reasons}`);
  assert.ok(c.negativeReasons.includes("empty_header_ratio"));
  assert.ok(c.negativeReasons.includes("prose_density"));
});

test("成果/图纸清单表：长文本要求 → 保留，候选 deliverable", () => {
  const c = scoreTableRegion(
    rows(
      ["图纸名称", "主要内容", "比例尺", "格式要求"],
      ["用地规划图", "标明各地块用地性质、边界、代码", "1:2000", "CAD + PDF"],
      ["道路系统规划图", "标明道路红线、断面、交叉口形式", "1:2000", "CAD + PDF"]
    )
  );
  assert.ok(shouldKeepAsTable(c));
  assert.ok(c.tableTypeCandidates.includes("deliverable_table"));
});
