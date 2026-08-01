# DesignBase AI · 企业知识库问答

面向城市规划与建筑设计院的企业级 RAG 知识库问答平台。支持企业制度 / 行业法规 / 项目资料的智能问答，具备结构化文档解析、混合检索、角色权限隔离、工作流审计与评测治理闭环。

## 核心能力

- **结构化解析**：PDF/Word 解析为多类知识对象（条款、指标、定义、成果要求、流程步骤、用地代码等），保留章节树；跨页表格合并与结构修复；坏表降级隔离，避免整篇入库失败
- **表格 RAG**：表格作为一级对象（`RagTable`）独立存储；复杂「一般规模」分档单元格可解析床位↔建筑面积档位；脏数字拒答，不编造区间
- **混合检索**：精确索引 + BM25 + 向量三路融合，意图感知重排；规模类问题优先配置指标表证据
- **权限隔离**：四角色 × 三级权限（L1/L2/L3），检索前过滤无权资料；依据不足或无权时明确拒答
- **工作流审计**：端到端记录权限 / 检索 / 生成链路；文档审核工件（review artifact）支持人工复核与自动审核 Agent
- **评测治理**：不可变评测批次、异步跑批与对比、失败聚类、发布门槛（gate）、坏例入库；`/lab` 测试台概览趋势

## 技术栈

- **框架**：Next.js 14 · TypeScript 5.6 · Tailwind CSS · Radix UI
- **文档解析**：pdfjs-dist · pdfplumber（Python sidecar）· mammoth（Word）
- **检索**：BM25 · 余弦向量相似度 · 精确字符串索引
- **AI**：OpenAI 兼容接口（默认接智谱 GLM）；不配置时使用内置 mock 可完整跑通
- **自动审核**（可选）：独立 Vision/Chat Provider，与问答 LLM 解耦（见 `.env.example`）

## 快速开始

```bash
npm install
npm run dev
```

默认地址：`http://localhost:3100`

不配置 AI API Key 时，系统使用内置 mock LLM 与 mock Embedding，主链路可完整演示。接入真实服务请复制 `.env.example` 为 `.env.local`。

常用脚本：

```bash
npm test                 # 单元测试
npm run eval:auto-review # 自动审核评测（需配置与 fixture）
npm run build            # 生产构建
```

## 页面

| 路径 | 功能 |
| --- | --- |
| `/` | 问答工作台：切换模拟账号、提问、查看结构化回答与引用 |
| `/documents` | 文档管理：上传、解析、分类、权限、检索开关 |
| `/documents/:id/review/:artifactId` | 审核工作台：解析复核、人工轮次、自动审核结果 |
| `/chunks` | 切片查看器：知识单元与结构化解析结果（开发角色） |
| `/debug` | 工作流审计：端到端问答链路逐步排查（开发角色） |
| `/evaluation` | 质量控制：题库、批次跑测、对比与门禁（开发角色） |
| `/lab` | 测试台首页：质量概览与诊断入口（开发角色） |
| `/lab/audit` | Lab 侧工作流审计入口 |

## 权限模型

内置账号定义在 [`lib/knowledge/permissions.ts`](lib/knowledge/permissions.ts)。

| 角色 | 可访问范围 |
| --- | --- |
| 普通员工 | L1 公开资料 + 被授权的项目资料 |
| 项目负责人 | L1 公开资料 + L2 非项目资料 + 自己负责的项目资料 |
| 管理员 | 全部资料 |
| 开发人员 | 全部资料 + 审计 / 评测 / 切片等开发工具 |

项目资料通过 `projectId / projectOwnerId / accessibleUserIds` 绑定。检索前权限过滤；若问题只命中无权资料，返回权限提示而非原文。

## 内置 Mock 数据

`lib/db/mockData.ts` 内置公开技术标准和 4 类设计院项目资料：

- 滨江片区控规优化项目
- 产业园城市设计项目
- 轨道站点 TOD 综合开发项目
- 建筑方案报审资料清单

用于演示不同账号下的项目资料可见性与权限拒答。

## API（常用）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/chat` | 问答主链路 |
| `POST` | `/api/feedback` | 保存反馈 |
| `GET` | `/api/documents` | 文档列表 |
| `POST` | `/api/documents/upload` | 上传文档 |
| `POST` | `/api/documents/:id/process` | 解析 → 切片 → embedding → 入库 |
| `POST` | `/api/documents/:id/reprocess/prepare` | 表格结构修复预览（staging） |
| `POST` | `/api/documents/:id/reprocess/:stagingId/publish` | 发布修复结果 |
| `GET/POST` | `/api/documents/:id/review-artifacts` | 审核工件 |
| `GET/POST` | `/api/workflow-traces` | 工作流审计轨迹 |
| `GET/POST` | `/api/evaluation` | 题库管理与单次评测 |
| `POST` | `/api/evaluation/batch/run` | 创建并异步执行评测批次 |
| `GET` | `/api/evaluation/batch/:id` | 批次状态 / 结果 |
| `POST` | `/api/evaluation/batch/compare` | 批次对比（指纹门禁） |
| `GET` | `/api/evaluation/gate` | 发布门槛 |
| `POST` | `/api/retrieve-debug` | 检索调试（三路得分） |

## RAG 链路

```
上传文档
  → 解析（pdfjs / pdfplumber sidecar / OCR·视觉可选）
  → IR（Block[]：标题/段落/列表/表格）
  → 表格结构校验 / 跨页合并 / 坏表降级
  → DocProfile + 知识对象提取
  → 规模分档单元格展开（可解析时）
  → 切片（Chunk[] + RagTable[]）+ embedding

问答请求
  → 权限过滤（accessible / denied）
  → 精确索引 + BM25 + 向量 三路检索
  → 意图感知重排（指标表优先、结论支撑排序等）
  → 证据质量门控（脏数字 / 粘连数值拒绝）
  → 命中扩展（table_row → 表头，clause → 章节路径）
  → 依据不足 / 权限拒答判断
  → LLM 抽取式生成（分档结论不扁平化）
  → 表格装配 + 结构化回答 + 引用卡片
  →（可选）写入 workflow trace
```

## 扫描件与自动审核（可选）

默认关闭，按需在 `.env.local` 开启：

```bash
# Tesseract OCR（扫描文字）
OCR_SCANNED=1

# GLM-4V 视觉识别（复杂扫描表格，需 ZHIPU_API_KEY）
VISION_SCANNED=1

# 独立自动审核 Agent（与问答 LLM 解耦）
AUTO_REVIEW_ENABLED=1
# AUTO_REVIEW_API_KEY=...
# AUTO_REVIEW_MODEL=glm-4v-flash
```

完整变量说明见 [`.env.example`](.env.example)；自动审核试跑见 [`docs/auto-review-pilot-runbook.md`](docs/auto-review-pilot-runbook.md)。

## 验证

```bash
npm test          # 单元测试（tests/ 下若干测试文件）
npx tsc --noEmit  # 类型检查
npm run build     # 构建验证
```

Windows PowerShell 如遇执行策略限制，用 `npm.cmd test` 代替 `npm test`。

## 文档

- [`docs/tech-design.md`](docs/tech-design.md) — 技术设计
- [`docs/PRD.md`](docs/PRD.md) — 产品需求
- [`docs/superpowers/plans/2026-07-28-evaluation-governance-roadmap.md`](docs/superpowers/plans/2026-07-28-evaluation-governance-roadmap.md) — 评测治理路线图
- [`docs/superpowers/specs/2026-07-30-complex-scale-cell-tiers-design.md`](docs/superpowers/specs/2026-07-30-complex-scale-cell-tiers-design.md) — 复杂规模分档单元格设计
- [`docs/superpowers/specs/2026-07-23-table-splitting-structural-repair-design.md`](docs/superpowers/specs/2026-07-23-table-splitting-structural-repair-design.md) — 表格结构修复设计
