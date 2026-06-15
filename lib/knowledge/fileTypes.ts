import type { FileType } from "@/lib/types";

export const PLANNING_FILE_TYPES: FileType[] = [
  "项目资料",
  "规划法规",
  "技术标准",
  "设计指引",
  "成果要求",
  "审查报批",
  "图纸图则",
  "企业制度",
  "流程指引",
  "FAQ",
  "IT与行政",
  "财务与报销",
  "其他",
];

export const LEGACY_FILE_TYPES: FileType[] = [
  "技术规定",
  "用地分类",
  "控规导则",
  "停车标准",
  "公共服务设施标准",
];

export const ALL_FILE_TYPES: FileType[] = [
  ...PLANNING_FILE_TYPES,
  ...LEGACY_FILE_TYPES,
];
