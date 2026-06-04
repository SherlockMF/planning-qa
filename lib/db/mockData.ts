// ============================================================================
// 内置 mock 数据
// ----------------------------------------------------------------------------
// 在没有真实知识库时，用于演示问答主链路。覆盖：
//  1. 二类居住用地定义
//  2. 商务金融用地定义
//  3. 商业用地与商务用地区别
//  4. 居住用地绿地率
//  5. 停车配建标准
//  6. 一个"没有明确容积率上限"的案例 —— 用于测试拒答
// 内容为演示性质的拟制条文，仅用于跑通系统，不代表任何城市真实法规。
// ============================================================================

import type { Chunk, Document } from "@/lib/types";

export const MOCK_DOCUMENTS: Document[] = [
  {
    id: "doc-zoning-code",
    fileName: "城市用地分类与规划建设用地标准（演示版）.pdf",
    city: "北京",
    fileType: "用地分类",
    enabled: true,
    status: "indexed",
    createdAt: "2026-05-01T09:00:00.000Z",
  },
  {
    id: "doc-tech-rule",
    fileName: "控制性详细规划技术规定（演示版）.docx",
    city: "北京",
    fileType: "技术规定",
    enabled: true,
    status: "indexed",
    createdAt: "2026-05-01T09:10:00.000Z",
  },
  {
    id: "doc-parking",
    fileName: "建设项目停车配建标准（演示版）.pdf",
    city: "北京",
    fileType: "停车标准",
    enabled: true,
    status: "indexed",
    createdAt: "2026-05-02T10:00:00.000Z",
  },
  {
    id: "doc-fac-indicator",
    fileName: "社区公共服务设施配置指标（演示版）.pdf",
    city: "北京",
    fileType: "公共服务设施标准",
    enabled: true,
    status: "indexed",
    createdAt: "2026-05-03T09:00:00.000Z",
  },
];

// 演示用配置指标表（表1—1）。table_full + 多行 table_row，
// 用于演示「命中行 → 回查 RagTable → TableSlice → 真实表格展示」闭环。
const FAC_TABLE_ID = "table-fac-1";
const FAC_TABLE_TITLE = "表1—1 综合服务类设施配置指标表";
const FAC_HEADERS = [
  "层级",
  "编号",
  "设施名称",
  "服务内容",
  "一般规模-建筑面积(平方米/处)",
  "千人指标-建筑面积(平方米)",
  "服务规模",
];
const FAC_BASE = {
  documentId: "doc-fac-indicator",
  fileName: "社区公共服务设施配置指标（演示版）.pdf",
  city: "北京",
  docTitle: "社区公共服务设施配置指标（演示版）",
  sectionPath: "第二章 综合服务类设施 / 第一节 配置指标",
  tableId: FAC_TABLE_ID,
  tableTitle: FAC_TABLE_TITLE,
  tableHeaders: FAC_HEADERS,
  pageStart: 15,
  pageEnd: 15,
  pageNumber: 15,
  createdAt: "2026-05-03T09:00:00.000Z",
};

const FAC_ROWS: { name: string; cells: string[] }[] = [
  {
    name: "物业服务用房",
    cells: ["项目级", "1", "物业服务用房", "物业管理办公、档案资料室、维修值班、业委会办公等", "150", "40-50", "每个项目1处"],
  },
  {
    name: "社区服务站",
    cells: ["居住街坊级", "2", "社区服务站", "社区管理、综合服务、文化活动", "600", "30-46", "每个街坊1处"],
  },
  {
    name: "社区卫生服务中心",
    cells: ["居住社区级", "3", "社区卫生服务中心", "预防、保健、全科医疗、康复", "1700", "85-100", "每3-5万人1处"],
  },
  {
    name: "养老服务驿站",
    cells: ["居住社区级", "4", "养老服务驿站", "日间照料、助餐、文体娱乐", "350", "20-30", "每个社区1处"],
  },
];

function facFields(cells: string[]): Record<string, string> {
  const f: Record<string, string> = {};
  FAC_HEADERS.forEach((h, i) => {
    if (cells[i]) f[h] = cells[i];
  });
  return f;
}

function facRowContent(cells: string[]): string {
  const parts = [`${FAC_BASE.sectionPath} ${FAC_TABLE_TITLE}`];
  FAC_HEADERS.forEach((h, i) => {
    if (cells[i]) parts.push(`${h}：${cells[i]}`);
  });
  return parts.join("。") + "。";
}

const FAC_MARKDOWN = [
  FAC_TABLE_TITLE,
  `| ${FAC_HEADERS.join(" | ")} |`,
  `| ${FAC_HEADERS.map(() => "---").join(" | ")} |`,
  ...FAC_ROWS.map((r) => `| ${r.cells.join(" | ")} |`),
].join("\n");

const FAC_TABLE_CHUNKS: Omit<Chunk, "embedding">[] = [
  {
    ...FAC_BASE,
    id: "chunk-fac-table-full",
    chunkType: "table_full",
    content: FAC_MARKDOWN,
    keywords: ["配置指标", "设施", "建筑面积", "千人指标", "服务规模"],
    aliases: [FAC_TABLE_TITLE],
  },
  ...FAC_ROWS.map((r, i) => ({
    ...FAC_BASE,
    id: `chunk-fac-row-${i}`,
    chunkType: "table_row" as Chunk["chunkType"],
    parentChunkId: "chunk-fac-table-full",
    rowKey: r.name,
    fields: facFields(r.cells),
    content: facRowContent(r.cells),
    keywords: [r.name, "建筑面积", "千人指标", "服务规模", "配置指标"],
    aliases: [r.name],
  })),
];

/** chunk 原始内容（不含 embedding，embedding 由 store 在播种时计算）。 */
export const MOCK_CHUNKS: Omit<Chunk, "embedding">[] = [
  {
    id: "chunk-r2-definition",
    chunkType: "definition",
    documentId: "doc-zoning-code",
    fileName: "城市用地分类与规划建设用地标准（演示版）.pdf",
    city: "北京",
    sectionPath: "第三章 城乡用地分类 / 第二节 居住用地",
    articleNo: "第三点二条",
    pageNumber: 18,
    content:
      "二类居住用地（R2）：指市政公用设施齐全、布局完整、环境良好，以多、中、高层住宅为主的用地。该类用地内允许配建居住小区级及以下的公共服务设施、附属绿地与道路。其住宅建筑应满足日照、间距等基本居住环境要求。",
    keywords: ["二类居住用地", "R2", "居住用地", "定义", "多层", "高层住宅"],
    createdAt: "2026-05-01T09:00:00.000Z",
  },
  {
    id: "chunk-b2-definition",
    chunkType: "definition",
    documentId: "doc-zoning-code",
    fileName: "城市用地分类与规划建设用地标准（演示版）.pdf",
    city: "北京",
    sectionPath: "第三章 城乡用地分类 / 第三节 商业服务业设施用地",
    articleNo: "第三点五条",
    pageNumber: 24,
    content:
      "商务金融用地（B2）：指金融、保险、证券、新闻出版、文艺团体等综合性办公及商务活动用地，以及企业、事业、团体等的独立办公用地。该类用地不包括以零售、批发等经营性销售活动为主的商业用地。",
    keywords: ["商务金融用地", "B2", "办公", "金融", "商务", "定义"],
    createdAt: "2026-05-01T09:01:00.000Z",
  },
  {
    id: "chunk-b1-definition",
    chunkType: "definition",
    documentId: "doc-zoning-code",
    fileName: "城市用地分类与规划建设用地标准（演示版）.pdf",
    city: "北京",
    sectionPath: "第三章 城乡用地分类 / 第三节 商业服务业设施用地",
    articleNo: "第三点四条",
    pageNumber: 23,
    content:
      "商业用地（B1）：指以零售、批发、餐饮、旅馆、商业综合体等经营性销售与服务活动为主的用地。商业用地（B1）与商务金融用地（B2）的主要区别在于：B1 以面向公众的经营性销售、餐饮、住宿等活动为主，B2 以办公及商务活动为主、不含经营性销售。",
    keywords: ["商业用地", "B1", "零售", "餐饮", "区别", "商务金融用地", "B2"],
    createdAt: "2026-05-01T09:02:00.000Z",
  },
  {
    id: "chunk-residential-green-ratio",
    chunkType: "clause",
    documentId: "doc-tech-rule",
    fileName: "控制性详细规划技术规定（演示版）.docx",
    city: "北京",
    sectionPath: "第五章 绿地与公共空间控制 / 第一节 绿地率",
    articleNo: "第二十六条",
    pageNumber: 42,
    content:
      "居住用地的绿地率不应低于百分之三十（30%）。其中，新建居住区的集中绿地人均指标不应低于一平方米。旧区改建的居住用地绿地率可适当降低，但不应低于百分之二十五（25%）。",
    keywords: ["居住用地", "绿地率", "30%", "25%", "旧区改建", "集中绿地"],
    createdAt: "2026-05-01T09:20:00.000Z",
  },
  {
    id: "chunk-parking-residential",
    chunkType: "clause",
    documentId: "doc-parking",
    fileName: "建设项目停车配建标准（演示版）.pdf",
    city: "北京",
    sectionPath: "第二章 居住类停车配建 / 第一节 配建指标",
    articleNo: "第八条",
    pageNumber: 12,
    content:
      "居住建筑机动车停车配建标准：建筑面积大于九十平方米的住宅，每户不应少于一点零个停车位；建筑面积九十平方米及以下的住宅，每户不应少于零点八个停车位。非机动车停车位每户不应少于一个。",
    keywords: ["停车", "配建", "住宅", "停车位", "机动车", "每户", "标准"],
    createdAt: "2026-05-02T10:01:00.000Z",
  },
  {
    id: "chunk-parking-commercial",
    chunkType: "clause",
    documentId: "doc-parking",
    fileName: "建设项目停车配建标准（演示版）.pdf",
    city: "北京",
    sectionPath: "第三章 公共建筑停车配建 / 第一节 配建指标",
    articleNo: "第十二条",
    pageNumber: 16,
    content:
      "商业建筑机动车停车配建标准：每一百平方米建筑面积不应少于零点八个停车位。办公建筑每一百平方米建筑面积不应少于零点六个停车位。",
    keywords: ["停车", "配建", "商业建筑", "办公建筑", "停车位", "100平方米"],
    createdAt: "2026-05-02T10:02:00.000Z",
  },
  {
    id: "chunk-far-general",
    chunkType: "clause",
    documentId: "doc-tech-rule",
    fileName: "控制性详细规划技术规定（演示版）.docx",
    city: "北京",
    sectionPath: "第四章 开发强度控制 / 第一节 容积率",
    articleNo: "第十八条",
    pageNumber: 30,
    content:
      "各地块的容积率应根据所在区位、用地性质、交通承载与城市设计要求，在控制性详细规划图则中逐地块确定。本技术规定不统一规定各类用地的容积率上限，具体数值以经批准的控规图则为准。",
    keywords: ["容积率", "开发强度", "控规图则", "逐地块确定"],
    createdAt: "2026-05-01T09:18:00.000Z",
  },
  {
    id: "chunk-building-height-note",
    chunkType: "clause",
    documentId: "doc-tech-rule",
    fileName: "控制性详细规划技术规定（演示版）.docx",
    city: "北京",
    sectionPath: "第四章 开发强度控制 / 第二节 建筑高度",
    articleNo: "第二十一条",
    pageNumber: 34,
    content:
      "建筑高度应符合城市空间形态、历史文化保护、航空限高及城市设计的相关要求。涉及机场净空、微波通道、文物保护范围的地块，其建筑限高以相关专项规定为准。",
    keywords: ["建筑高度", "限高", "航空限高", "历史文化保护", "城市设计"],
    createdAt: "2026-05-01T09:19:00.000Z",
  },
  ...FAC_TABLE_CHUNKS,
];
