export type GoldenQuestion = {
  query: string;
  expectedObjectTypes: string[];
  expectedKeywords: string[];
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
