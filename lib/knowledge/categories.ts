import type { FileType, KnowledgeCategory } from "@/lib/types";

export const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  "企业制度",
  "流程指引",
  "FAQ",
  "IT与行政",
  "财务与报销",
  "规划法规",
  "技术标准",
  "设计指引",
  "项目资料",
  "成果要求",
  "其他",
];

export function categoryFromFileType(fileType: FileType): KnowledgeCategory {
  if (fileType === "技术规定") return "技术标准";
  if (fileType === "用地分类" || fileType === "控规导则") return "规划法规";
  if (fileType === "停车标准" || fileType === "公共服务设施标准") {
    return "技术标准";
  }
  return "其他";
}
