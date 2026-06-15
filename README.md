# 企业知识库问答系统

面向城市规划与建筑设计院的企业级 RAG 知识库问答平台，支持企业制度/行业法规/项目资料的智能问答，具备结构化文档解析、混合检索、角色权限隔离和评测闭环能力。

## 核心能力

- **结构化解析**：PDF/Word 文档解析为 14 类知识对象（条款、指标、定义、成果要求、流程步骤、用地代码等），保留章节树结构
- **混合检索**：精确索引 + BM25 关键词 + 向量语义三路融合，多维信号重排序
- **表格 RAG**：表格作为一级对象（RagTable）独立存储，命中后精确截取相关行列渲染，LLM 不手写表格
- **权限隔离**：四角色（普通员工/项目负责人/管理员/开发）× 三级权限（L1 公开/L2 项目主管/L3 管理员），检索前过滤无权资料
- **拒答机制**：检索依据不足或无权访问时明确拒答，杜绝编造
- **评测闭环**：内置题库评测，支持多场景验收（项目权限/拒答/企业制度），结果可导入导出

## 技术栈

- **框架**：Next.js 14 · TypeScript 5.6 · Tailwind CSS · Radix UI
- **文档解析**：pdfjs-dist · pdfplumber（Python sidecar）· mammoth（Word）
- **检索**：BM25 · 余弦向量相似度 · 精确字符串索引
- **AI**：OpenAI 兼容接口（默认接智谱 GLM），不配置时使用内置 mock 可完整跑通

## 快速开始

```bash
npm install
npm run dev
```

默认地址：`http://localhost:3100`

不配置 AI API Key 时，系统使用内置 mock LLM 和 mock Embedding，所有功能均可正常演示。接入真实 AI 服务请参考 `.env.example`。

## 页面

| 路径 | 功能 |
| --- | --- |
| `/` | 问答工作台：切换模拟账号、提问、查看结构化回答与引用卡片 |
| `/documents` | 文档管理：上传、解析、分类、权限配置、批量操作 |
| `/chunks` | 切片查看器：查看文档知识单元与结构化解析结果 |
| `/debug` | 检索调试：关键词提取、三路检索得分、重排过程（开发角色可见） |
| `/evaluation` | 题库评测：导入题库、批量运行、查看通过率、导出报告 |

## 权限模型

内置账号定义在 [`lib/knowledge/permissions.ts`](lib/knowledge/permissions.ts)。

| 角色 | 可访问范围 |
| --- | --- |
| 普通员工 | L1 公开资料 + 被授权的项目资料 |
| 项目负责人 | L1 公开资料 + L2 非项目资料 + 自己负责的项目资料 |
| 管理员 | 全部资料 |
| 开发人员 | 全部资料 + 检索调试工具 |

项目资料通过 `projectId / projectOwnerId / accessibleUserIds` 绑定。检索前权限过滤，无权资料不进入 LLM 上下文；若问题只命中无权资料，返回权限提示而非原文。

## 内置 Mock 数据

`lib/db/mockData.ts` 内置公开技术标准和 4 类设计院项目资料：

- 滨江片区控规优化项目
- 产业园城市设计项目
- 轨道站点 TOD 综合开发项目
- 建筑方案报审资料清单

用于演示不同账号下项目资料可见性和权限拒答效果。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/chat` | 问答主链路，支持 `question / city / userId / userRole` |
| `POST` | `/api/feedback` | 保存反馈记录 |
| `GET` | `/api/documents` | 文档列表 |
| `POST` | `/api/documents/upload` | 上传文档 |
| `POST` | `/api/documents/:id/process` | 解析 → 切片 → embedding → 入库 |
| `PATCH/DELETE` | `/api/documents/:id` | 更新元数据、切换检索开关、删除 |
| `POST` | `/api/retrieve-debug` | 检索调试（返回三路得分） |
| `GET/POST` | `/api/evaluation` | 题库管理与评测运行 |

## RAG 链路

```
上传文档
  → 解析（pdfjs / pdfplumber sidecar / OCR 兜底）
  → IR 中间表示（Block[]：标题/段落/列表/表格）
  → DocProfile 文档画像
  → 14 类知识对象提取（KnowledgeObject）
  → 切片（Chunk[] + RagTable[]）+ embedding

问答请求
  → 权限过滤（accessible / denied 分组）
  → 检索前范围判断
  → 精确索引 + BM25 + 向量 三路检索
  → 多维重排序（IDF短语/意图/版本时效/来源标题…）
  → 命中扩展（table_row → 补表头，clause → 补章节路径）
  → 检索后依据判断 / 权限拒答判断
  → LLM 抽取式生成结论
  → 表格装配（命中行 → RagTable → TableSlice）
  → 结构化回答（AnswerBlock[]）+ 引用卡片
```

## 扫描件支持（可选）

默认关闭，按需在 `.env.local` 开启：

```bash
# Tesseract OCR（适合扫描文字）
OCR_SCANNED=1

# GLM-4V 视觉识别（适合复杂扫描表格，需 ZHIPU_API_KEY）
VISION_SCANNED=1
```

## 验证

```bash
npm test          # 单元测试（13 个测试文件）
npx tsc --noEmit  # 类型检查
npm run build     # 构建验证
```

Windows PowerShell 如遇执行策略限制，用 `npm.cmd test` 代替 `npm test`。
