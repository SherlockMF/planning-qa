export type GoldenQuestion = {
  query: string;
  expectedObjectTypes: string[];
  expectedKeywords: string[];
};

export type NumericGoldenQuestion = GoldenQuestion & {
  expectedAnswerValues: string[];
  forbiddenAnswerValues?: string[];
  sourceHint: string;
};

export const GOLDEN_QUESTIONS: GoldenQuestion[] = [
  { query: "A11 代码是什么意思？", expectedObjectTypes: ["classification_code"], expectedKeywords: ["A11"] },
  { query: "社区服务站的定义是什么？", expectedObjectTypes: ["definition"], expectedKeywords: ["社区服务站"] },
  { query: "社区服务站的配置指标是多少？", expectedObjectTypes: ["indicator_item"], expectedKeywords: ["社区服务站", "指标"] },
  { query: "居住社区级需要哪些事项？", expectedObjectTypes: ["indicator_item", "checklist_item"], expectedKeywords: ["居住社区级"] },
  { query: "表1 中 A1 和 A11 两行是什么？", expectedObjectTypes: ["structured_table_row"], expectedKeywords: ["表1", "A1", "A11"] },
  { query: "哪些设施必须配置，哪些不得减少？", expectedObjectTypes: ["requirement"], expectedKeywords: ["必须", "不得"] },
  { query: "成果包含哪些内容？", expectedObjectTypes: ["deliverable_requirement"], expectedKeywords: ["成果"] },
  { query: "图纸要求是什么？", expectedObjectTypes: ["drawing_requirement"], expectedKeywords: ["图纸"] },
  { query: "附表和清单要求是什么？", expectedObjectTypes: ["checklist_item", "deliverable_requirement"], expectedKeywords: ["附表", "清单"] },
  { query: "办理流程步骤有哪些？", expectedObjectTypes: ["procedure_step"], expectedKeywords: ["流程"] },
  { query: "第1条规定了什么？", expectedObjectTypes: ["regulation_clause"], expectedKeywords: ["第1条"] },
  { query: "存在新旧版本冲突时如何处理？", expectedObjectTypes: ["plain_section"], expectedKeywords: ["版本", "冲突"] },
];

export const NUMERIC_GOLDEN_QUESTIONS: NumericGoldenQuestion[] = [
  {
    query: "托幼服务规模是多少？",
    expectedObjectTypes: ["indicator_item", "structured_table_row"],
    expectedKeywords: ["托幼", "服务规模"],
    expectedAnswerValues: ["0.96万人", "1.44万人"],
    forbiddenAnswerValues: ["0万.9人6", "1万.4人4"],
    sourceHint: "北京市居住公共服务设施配置指标京政发〔2025〕25号，基础教育类设施配置指标表",
  },
  {
    query: "托幼服务范围是多少？",
    expectedObjectTypes: ["indicator_item", "structured_table_row"],
    expectedKeywords: ["托幼", "服务范围"],
    expectedAnswerValues: ["6岁以下"],
    forbiddenAnswerValues: ["岁6以下"],
    sourceHint: "北京市居住公共服务设施配置指标京政发〔2025〕25号，基础教育类设施配置指标表",
  },
  {
    query: "社区卫生服务站一般多少面积？",
    expectedObjectTypes: ["indicator_item", "structured_table_row"],
    expectedKeywords: ["社区卫生服务站", "一般规模"],
    expectedAnswerValues: ["规模性指标.一般规模：350"],
    sourceHint: "北京市居住公共服务设施配置指标京政发〔2025〕25号，医疗卫生类设施配置指标表",
  },
  {
    query: "社区卫生服务站千人指标是多少？",
    expectedObjectTypes: ["indicator_item", "structured_table_row"],
    expectedKeywords: ["社区卫生服务站", "千人指标"],
    expectedAnswerValues: ["千人指标：25"],
    sourceHint: "北京市居住公共服务设施配置指标京政发〔2025〕25号，医疗卫生类设施配置指标表",
  },
  {
    query: "社区卫生服务站服务规模是多少？",
    expectedObjectTypes: ["indicator_item", "structured_table_row"],
    expectedKeywords: ["社区卫生服务站", "服务规模"],
    expectedAnswerValues: ["服务规模：每两个社区1处"],
    sourceHint: "北京市居住公共服务设施配置指标京政发〔2025〕25号，医疗卫生类设施配置指标表",
  },
  {
    query: "社区卫生服务站业务用房比例不低于多少？",
    expectedObjectTypes: ["indicator_item", "structured_table_row"],
    expectedKeywords: ["社区卫生服务站", "业务用房", "85%"],
    expectedAnswerValues: ["不应低于85%"],
    sourceHint: "北京市居住公共服务设施配置指标京政发〔2025〕25号，医疗卫生类设施配置要求表",
  },
  {
    query: "社区卫生服务中心A级急救工作站至少增加多少建筑面积？",
    expectedObjectTypes: ["indicator_item", "structured_table_row"],
    expectedKeywords: ["社区卫生服务中心", "A级急救工作站"],
    expectedAnswerValues: ["A级急救工作站至少增加200平方米"],
    sourceHint: "北京市居住公共服务设施配置指标京政发〔2025〕25号，医疗卫生类设施配置要求表",
  },
  {
    query: "社区卫生服务中心B级急救工作站至少增加多少建筑面积？",
    expectedObjectTypes: ["indicator_item", "structured_table_row"],
    expectedKeywords: ["社区卫生服务中心", "B级急救工作站"],
    expectedAnswerValues: ["B级急救工作站至少增加80平方米"],
    sourceHint: "北京市居住公共服务设施配置指标京政发〔2025〕25号，医疗卫生类设施配置要求表",
  },
  {
    query: "社区卫生服务中心每张病床不少于多少建筑面积？",
    expectedObjectTypes: ["indicator_item", "structured_table_row"],
    expectedKeywords: ["社区卫生服务中心", "每张病床"],
    expectedAnswerValues: ["每张病床不少于30平方米"],
    sourceHint: "北京市居住公共服务设施配置指标京政发〔2025〕25号，医疗卫生类设施配置要求表",
  },
];
