// ============================================================================
// 核心数据类型定义
// 控规/国土空间规划法规智能问答助手
// ============================================================================

/** 文件业务类型 */
export type FileType =
  | "技术规定"
  | "用地分类"
  | "控规导则"
  | "停车标准"
  | "公共服务设施标准"
  | "其他";

/** 文档处理状态 */
export type DocumentStatus = "pending" | "processing" | "indexed" | "failed";

// ============================================================================
// Document IR（中间表示）—— extractBlocks 的输出，chunk 的输入
// ============================================================================

/** IR block 类型 */
export type BlockType =
  | "heading"
  | "paragraph"
  | "list_item"
  | "table"
  | "table_row"
  | "page_break"
  | "image_page";

/** 结构化表格模型 */
export interface TableModel {
  /** 表唯一 id（跨页/续表共享） */
  tableId: string;
  /** 表名（如 "表1—1 综合服务类设施配置指标表"） */
  title?: string;
  /** 表头（多行表头已合并为单层列名） */
  headers: string[];
  /** 数据行（不含表头） */
  rows: string[][];
  /** GFM markdown 表示 */
  markdown: string;
}

// ============================================================================
// RagTable —— 表格作为一级数据对象（P0）
// ----------------------------------------------------------------------------
// 区分三件事（核心原则 1）：
//   RagTable          → 最终展示与结构化回查的唯一数据源（cells）
//   table_row chunk   → 仅用于 embedding / BM25 / rerank 检索（content/searchText）
//   TableSlice        → 命中后从 RagTable 截取的相关行 + 相关列
// ============================================================================

/** 表格语义类型（决定 rowKey / 列选择 / 行自然语言化策略） */
export type TableType =
  | "indicator_table"
  | "requirement_table"
  | "code_table"
  | "deliverable_table"
  | "legend_table"
  | "generic_table";

/** 表格列（多级表头已 flatten 为唯一字段名） */
export interface TableColumn {
  columnId: string;
  /** 展示用列名（flatten 后唯一，如 "一般规模-建筑面积(平方米/处)"） */
  header: string;
  /** 字段匹配/列选择用的规范名（去单位/标点） */
  canonicalName: string;
  /** 原始多级表头路径（如 ["一般规模", "建筑面积"]） */
  headerPath: string[];
  /** 单位（如 "平方米/处"），从表头括号提取 */
  unit?: string;
  /** 在原表中的列序 */
  originalIndex: number;
}

/** 表格数据行 */
export interface TableRow {
  rowId: string;
  tableId: string;
  rowIndex: number;
  rowType: "data" | "summary" | "note" | "header_continuation";
  /** 行主键（设施名称/代码/类别名称/成果名称…） */
  rowKey?: string;
  aliases?: string[];
  /** 列 header → 单元格值；最终表格展示的唯一数据源 */
  cells: Record<string, string>;
  pageStart: number;
  pageEnd: number;
  bbox?: number[];
  /** 仅用于 embedding / BM25，不用于展示 */
  searchText: string;
}

/** 表格一级对象（独立存储，跨页续表共享 tableId） */
export interface RagTable {
  tableId: string;
  docId: string;
  docTitle: string;
  tableTitle: string;
  tableType: TableType;
  sectionPath: string[];
  pageStart: number;
  pageEnd: number;
  columns: TableColumn[];
  rows: TableRow[];
  /** 全表 GFM markdown（调试 / 「查看原表」用） */
  markdownFull: string;
  confidence: number;
  warnings: string[];
}

/** 检索命中后从 RagTable 截取的切片（前端 table_slice 渲染源） */
export interface TableSlice {
  type: "table_slice";
  tableId: string;
  tableTitle: string;
  sourceDocTitle: string;
  pageStart: number;
  pageEnd: number;
  columns: TableColumn[];
  rows: TableRow[];
  selectedRowIds: string[];
  citationText: string;
}

/** 结构化答案块（核心原则 3：表格由程序渲染，LLM 只产解释文字） */
export type AnswerBlock =
  | { type: "text"; content: string }
  | {
      type: "table_slice";
      tableId: string;
      tableTitle: string;
      columns: TableColumn[];
      rows: TableRow[];
      selectedRowIds: string[];
      source: { docTitle: string; pageStart: number; pageEnd: number };
    }
  | { type: "citation"; content: string };

/** 文档 IR 基本单元 */
export interface Block {
  type: BlockType;
  /** 起始页（1-based） */
  pageStart: number;
  /** 结束页（跨页块 > pageStart） */
  pageEnd: number;
  /** 版面包围盒 [x0,y0,x1,y1]（PDF 坐标，可选） */
  bbox?: [number, number, number, number];
  /** 原始文本（含 \t 列分隔/标记） */
  rawText: string;
  /** 归一化文本（去标记/压空白，用于检索与展示） */
  normalizedText: string;
  /** heading 层级（1 最高） */
  level?: number;
  /** 命中的标题模式名 */
  headingPattern?: string;
  /** list_item 的编号标记（如 "一、" "（1）" "1."） */
  listMarker?: string;
  /** table 块的结构化表格 */
  table?: TableModel;
  /** table_row 块的单元格 */
  rowCells?: string[];
}

// ============================================================================
// 文档画像（DocProfile）—— 切分前的结构识别，决定叠加策略
// ============================================================================

/** 文档结构类型候选（可多选，可叠加） */
export type DocTypeCandidate =
  | "regulation"
  | "technical_standard"
  | "guideline"
  | "indicator_standard"
  | "classification_standard"
  | "deliverable_spec"
  | "procedure_doc"
  | "mixed";

export interface DocProfile {
  docTitle: string;
  docTypeCandidates: DocTypeCandidate[];
  hasClauseNumbers: boolean;
  hasChapterStructure: boolean;
  hasTables: boolean;
  hasLargeTables: boolean;
  hasCodeTable: boolean;
  hasDefinitions: boolean;
  hasDeliverableList: boolean;
  hasProcedureSteps: boolean;
  hasScannedPages: boolean;
  headingPatternsDetected: string[];
  tableCount: number;
  estimatedPageCount: number;
}

// ============================================================================
// Chunk 类型
// ============================================================================

/** 知识单元类型（决定检索优先级与展示形态） */
export type ChunkType =
  | "section"
  | "clause"
  | "clause_explanation"
  | "definition"
  | "explanation"
  | "list_item"
  | "requirement"
  | "deliverable"
  | "procedure"
  | "table_full"
  | "table_row"
  | "indicator"
  | "note"
  | "code"
  | "figure"
  | "image_page";

export type ChunkRole = "atomic" | "parent" | "summary" | "fallback";

export type ContextRole =
  | "direct_hit"
  | "expanded_parent"
  | "expanded_sibling"
  | "expanded_explanation"
  | "expanded_requirement";

/** 知识库文档元数据 */
export interface Document {
  id: string;
  fileName: string;
  city: string;
  fileType: FileType;
  /** 是否参与检索 */
  enabled: boolean;
  status: DocumentStatus;
  createdAt: string;
}

/** 文档切片（知识单元 chunk） */
export interface Chunk {
  id: string;
  documentId: string;
  fileName: string;
  city: string;

  // ── 知识单元类型与来源 ──
  /** 知识单元类型 */
  chunkType: ChunkType;
  /** 由 KnowledgeObject 派生后的 chunk 角色：原子、父级、摘要或兜底 */
  chunkRole?: ChunkRole;
  /** 文档标题（docProfile.docTitle） */
  docTitle?: string;
  /** 文档结构类型（主候选） */
  docType?: DocTypeCandidate;

  // ── 结构定位 ──
  /** 章节路径，如 "第三章 / 第二节 用地分类" */
  sectionPath?: string;
  /** 当前所属标题文本 */
  headingText?: string;
  /** 标准条文号，如 "3.0.3" / "第十二条" */
  clauseNo?: string;

  // ── 表格相关 ──
  tableId?: string;
  tableTitle?: string;
  /** table_full 的列名（供命中扩展） */
  tableHeaders?: string[];
  /** 行主键（设施名称/指标名称/类别/代码） */
  rowKey?: string;
  /** table_row 字段 JSON（列名→单元格值） */
  fields?: Record<string, string>;
  /** 绑定到 RagTable.rows 的稳定行 id（`${docId}_${tableId}_row_${rowIndex}`） */
  rowId?: string;
  /** 表格语义类型（由 buildRagTables 回填，供检索/装配判别） */
  tableType?: TableType;
  /** 行类型（data/summary/note/header_continuation），summary/note 不优先召回 */
  rowType?: TableRow["rowType"];

  // ── KnowledgeObject 派生元数据（新结构化对象层，可选，旧 chunk 兼容） ──
  objectId?: string;
  objectType?: string;
  sourceTableId?: string;
  sourceRowIndex?: number;
  itemName?: string;
  normativeLevel?: string;
  mandatory?: boolean;
  versionInfo?: Record<string, unknown>;

  // ── 代码相关（用地/分类代码） ──
  code?: string;
  parentCode?: string;

  // ── 页码 ──
  /** 起始页 */
  pageStart?: number;
  /** 结束页 */
  pageEnd?: number;

  // ── 关系 ──
  /** 父 chunk（table_row→table_full / clause_explanation→clause / list_item→heading） */
  parentChunkId?: string;
  prevChunkId?: string;
  nextChunkId?: string;

  // ── 检索内容 ──
  /** embedding 专用文本：短而语义化，避免直接塞入大字段 JSON */
  embeddingText?: string;
  /** BM25 专用文本：可包含 key/alias/字段值，服务精确词面召回 */
  bm25Text?: string;
  /** 展示/LLM 原文文本：尽量保持人可读原文 */
  displayText?: string;
  content: string;
  keywords: string[];
  /** 别名/同义表达（代码、简称、英文名等），用于精确召回 */
  aliases?: string[];
  /** 向量表示（mock 阶段为伪向量） */
  embedding?: number[];
  createdAt: string;

  // ── 向后兼容派生字段（= clauseNo / pageStart） ──
  /** @deprecated 用 clauseNo；保留供旧 UI/检索读取 */
  articleNo?: string;
  /** @deprecated 用 pageStart；保留供旧 UI/检索读取 */
  pageNumber?: number;
}

/** 检索命中结果（携带评分信息，用于调试与重排序） */
export interface RetrievedChunk {
  chunk: Chunk;
  /** 关键词检索得分 */
  keywordScore: number;
  /** 向量相似度得分 */
  vectorScore: number;
  /** 重排序后的综合得分 */
  rerankScore: number;
  /** 命中来源 */
  source: "exact" | "keyword" | "vector" | "hybrid";
  /** 命中的关键词列表 */
  matchedKeywords: string[];
  /** 当前结果在答案上下文中的角色 */
  contextRole?: ContextRole;
  /** 本 direct hit 附带展开了哪些上下文角色 */
  expandedContextRoles?: ContextRole[];
}

/** 相关度等级 */
export type RelevanceLevel = "高" | "中" | "低";

/** 引用依据 */
export interface Citation {
  id: string;
  fileName: string;
  sectionPath?: string;
  articleNo?: string;
  pageNumber?: number;
  excerpt: string;
  relevance: RelevanceLevel;
}

/** /api/chat 请求 */
export interface ChatRequest {
  question: string;
  city?: string;
}

/** /api/chat 响应 */
export interface ChatResponse {
  answer: string;
  /** 是否找到明确依据 */
  foundEvidence: boolean;
  citations: Citation[];
  /** 拒答原因（foundEvidence=false 时给出） */
  refusalReason?: string;
  /**
   * 结构化答案块（P0）。仅当命中表格、需要以真实表格展示时给出；
   * 为空/缺省时前端回退到 answer 字符串渲染（向后兼容）。
   */
  answerBlocks?: AnswerBlock[];
}

/** /api/retrieve-debug 响应 */
export interface RetrieveDebugResponse {
  question: string;
  extractedKeywords: string[];
  keywordResults: RetrievedChunk[];
  vectorResults: RetrievedChunk[];
  /** 合并 + 重排序后的 Top5 */
  mergedTop: RetrievedChunk[];
}

/** 评测题目与结果 */
export interface EvaluationItem {
  id: string;
  /** 测试问题 */
  question: string;
  /** 标准答案 */
  standardAnswer: string;
  /** 正确文件 */
  correctFile: string;
  /** 正确条款 */
  correctArticle: string;
  /** 正确页码 */
  correctPage: string;
  /** 该题是否应当拒答 */
  shouldRefuse: boolean;

  // ---- 系统运行后回填的结果字段 ----
  /** 系统回答 */
  systemAnswer?: string;
  /** 引用是否正确 */
  citationCorrect?: boolean;
  /** 答案得分 0 / 1 / 2 */
  answerScore?: 0 | 1 | 2;
  /** 是否正确拒答 */
  refusedCorrectly?: boolean;
  /** 正确条文是否进入 Top5 */
  inTop5?: boolean;
  /** 主要错误原因 */
  errorReason?: string;
}

/** 评测统计汇总 */
export interface EvaluationStats {
  total: number;
  inTop5Count: number;
  citationCorrectCount: number;
  averageScore: number;
  refusedCorrectlyCount: number;
  errorReasonSummary: Record<string, number>;
}
