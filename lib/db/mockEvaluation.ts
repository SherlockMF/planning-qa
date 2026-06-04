// ============================================================================
// 评测题库（演示用）
// ----------------------------------------------------------------------------
// 仅录入题目与标准答案；系统回答、得分、是否正确拒答等结果字段，
// 由 /api/evaluation 触发"运行评测"时调用真实问答链路后回填，
// 不预设任何漂亮指标。
// ============================================================================

import type { EvaluationItem } from "@/lib/types";

export const MOCK_EVALUATION: EvaluationItem[] = [
  {
    id: "eval-1",
    question: "二类居住用地是什么？",
    standardAnswer:
      "二类居住用地（R2）指市政公用设施齐全、布局完整、环境良好，以多、中、高层住宅为主的用地。",
    correctFile: "城市用地分类与规划建设用地标准（演示版）.pdf",
    correctArticle: "第三点二条",
    correctPage: "18",
    shouldRefuse: false,
  },
  {
    id: "eval-2",
    question: "商务金融用地的定义是什么？",
    standardAnswer:
      "商务金融用地（B2）指金融、保险、证券等综合性办公及商务活动用地，不包括经营性销售为主的商业用地。",
    correctFile: "城市用地分类与规划建设用地标准（演示版）.pdf",
    correctArticle: "第三点五条",
    correctPage: "24",
    shouldRefuse: false,
  },
  {
    id: "eval-3",
    question: "商业用地和商务金融用地有什么区别？",
    standardAnswer:
      "B1 商业用地以面向公众的经营性销售、餐饮、住宿等活动为主；B2 商务金融用地以办公及商务活动为主，不含经营性销售。",
    correctFile: "城市用地分类与规划建设用地标准（演示版）.pdf",
    correctArticle: "第三点四条",
    correctPage: "23",
    shouldRefuse: false,
  },
  {
    id: "eval-4",
    question: "居住用地的绿地率不应低于多少？",
    standardAnswer: "居住用地绿地率不应低于30%；旧区改建不应低于25%。",
    correctFile: "控制性详细规划技术规定（演示版）.docx",
    correctArticle: "第二十六条",
    correctPage: "42",
    shouldRefuse: false,
  },
  {
    id: "eval-5",
    question: "大于90平方米的住宅每户停车位最低配建标准是多少？",
    standardAnswer: "建筑面积大于90平方米的住宅，每户不应少于1.0个停车位。",
    correctFile: "建设项目停车配建标准（演示版）.pdf",
    correctArticle: "第八条",
    correctPage: "12",
    shouldRefuse: false,
  },
  {
    id: "eval-6",
    question: "商业建筑每100平方米建筑面积停车位配建标准是多少？",
    standardAnswer: "商业建筑每100平方米建筑面积不应少于0.8个停车位。",
    correctFile: "建设项目停车配建标准（演示版）.pdf",
    correctArticle: "第十二条",
    correctPage: "16",
    shouldRefuse: false,
  },
  {
    id: "eval-7",
    question: "二类居住用地的容积率上限是多少？",
    standardAnswer:
      "应拒答：技术规定未统一规定容积率上限，需以经批准的控规图则逐地块确定。",
    correctFile: "控制性详细规划技术规定（演示版）.docx",
    correctArticle: "第十八条",
    correctPage: "30",
    shouldRefuse: true,
  },
  {
    id: "eval-8",
    question: "某地块容积率3.0、限高80米、建筑密度40%的组合是否可行？",
    standardAnswer:
      "应拒答：属于指标组合可行性判断，超出本 MVP 法规条文查询范围。",
    correctFile: "—",
    correctArticle: "—",
    correctPage: "—",
    shouldRefuse: true,
  },
  {
    id: "eval-9",
    question: "工业用地的绿地率要求是多少？",
    standardAnswer:
      "应拒答：当前知识库未收录工业用地绿地率的明确条文。",
    correctFile: "—",
    correctArticle: "—",
    correctPage: "—",
    shouldRefuse: true,
  },
  {
    id: "eval-10",
    question: "请帮我判断这个项目能不能通过规划审批。",
    standardAnswer: "应拒答：属于审批结论判断，超出 MVP 范围。",
    correctFile: "—",
    correctArticle: "—",
    correctPage: "—",
    shouldRefuse: true,
  },
  {
    id: "eval-11",
    question: "办公建筑每100平方米停车位配建标准是多少？",
    standardAnswer: "办公建筑每100平方米建筑面积不应少于0.6个停车位。",
    correctFile: "建设项目停车配建标准（演示版）.pdf",
    correctArticle: "第十二条",
    correctPage: "16",
    shouldRefuse: false,
  },
  {
    id: "eval-12",
    question: "旧区改建居住用地绿地率最低是多少？",
    standardAnswer: "旧区改建居住用地绿地率不应低于25%。",
    correctFile: "控制性详细规划技术规定（演示版）.docx",
    correctArticle: "第二十六条",
    correctPage: "42",
    shouldRefuse: false,
  },
];
