# AI 工作流审计可视化设计

日期：2026-07-14
状态：已完成交互设计确认，待书面复核

## 1. 背景

项目已有两条真实业务链：

1. 文档处理链：上传、文本或 PDF Block IR 解析、知识对象生成、切块、embedding 与持久化。
2. 查询回答链：问题判断、权限过滤、精确/BM25/向量检索、融合重排、上下文扩展、证据判断、结论生成、答案反思、兜底与最终输出。

当前 `/debug` 仅展示关键词、三路检索得分、合并候选和权限摘要，无法把问题结果关联到命中文档的处理历史，也无法解释注入检测、拒答、答案反思和最终兜底。目标是将两条链统一成一条可实时观察、可事后回放、可追责的审计记录。

## 2. 目标

- 管理员和开发人员能够查看一次问答从文档来源到最终输出的完整工作流。
- 新文档处理保存真实步骤快照；历史文档用当前可验证数据生成明确标注的回溯视图。
- 新查询运行时实时点亮步骤，完成后可从历史记录回放。
- 每一步展示状态、输入/输出摘要、指标、采用规则、决策、警告、耗时和关联实体。
- 可解释正常回答、提示注入阻断、范围外拒答、权限拒答、证据不足、LLM 自拒答、答案反思替换和低质量兜底。
- 审计能力不得改变原有问答和文档处理结果。

## 3. 非目标

- 不重新处理历史文档来补造旧日志。
- 不实现自由拖拽或可编辑的节点画布。
- 不向普通员工或项目负责人开放审计入口。
- 不保存原始 embedding 向量、完整系统提示词或无权正文。
- 不把审计记录作为检索索引或业务数据的权威来源。
- 不在首版实现跨环境集中式日志平台、分布式追踪或外部监控系统接入。

## 4. 用户与权限

沿用 `canUseDeveloperTools(user)`：

- `admin`：可查看入口、发起审计查询、查看历史运行。
- `developer`：同上。
- `employee`、`project_manager`：导航中不显示入口，页面内容也由权限组件拦截。

审计运行可以模拟某个业务用户执行查询，但查看者仍必须是管理员或开发人员。被模拟用户无权访问的资料只记录文档标识、权限级别、隔离数量和判定规则，不写入正文。

当前项目使用 Mock 用户而非真实登录会话。首版请求携带当前查看者 `actorUserId`，服务端通过现有用户与角色表校验；这只符合本项目当前演示认证边界。未来接入企业统一身份认证后，`actorUserId` 必须改为从服务端会话读取，不能继续信任客户端字段。

## 5. 页面边界

直接升级现有 `/debug` 页面为“AI 工作流审计”，不增加重复导航入口。

页面由三部分组成：

1. 运行工具栏：选择历史运行、输入新问题、选择模拟用户、查看运行状态。
2. 左侧时间线：统一展示关联文档处理链与本次查询链。
3. 右侧步骤详情：按“概览、明细、判定规则、原始事件”展示所选步骤。

现有 `RetrievalDebugPanel` 中有价值的关键词、权限摘要和候选得分能力迁移为工作流步骤详情，不保留两套并行实现。

## 6. 工作流阶段

### 6.1 文档处理链

| 顺序 | 步骤 | 真实记录内容 |
| --- | --- | --- |
| 1 | 上传与登记 | 文件名、类型、大小、文档 ID、上传者、权限配置 |
| 2 | 内容解析 | 解析方式、字符数、Block 数、表格数、解析警告 |
| 3 | 知识对象生成 | 对象总数、类型分布、章节信息 |
| 4 | 切块 | Chunk 数、角色与类型分布、内容长度统计 |
| 5 | Embedding | provider 签名、成功数、失败数、维度；不保存向量值 |
| 6 | 持久化 | 写入的 Chunk/RagTable 数量、文档最终状态 |

### 6.2 查询回答链

| 顺序 | 步骤 | 真实记录内容 |
| --- | --- | --- |
| 1 | 问题输入与安全检测 | 规范化问题、长度、提示注入规则结果 |
| 2 | 范围判断 | 是否属于知识库范围、拒答原因码 |
| 3 | 权限过滤 | 候选总数、可访问数、隔离数、模拟用户 |
| 4 | 查询信号提取 | 关键词、代码、数值、检索 Top K |
| 5 | 三路召回 | 精确、BM25、向量各自候选及得分 |
| 6 | 融合去重与重排 | 合并前后数量、重排得分、淘汰原因 |
| 7 | 上下文扩展 | 父级、相邻表格和结构化上下文来源 |
| 8 | 证据闸门 | 是否有足够依据、权限拒答与证据拒答结果 |
| 9 | 结论生成 | LLM provider、上下文数量、生成耗时、草稿摘要 |
| 10 | 表格与引用装配 | TableSlice 数量、引用筛选与支撑度 |
| 11 | 答案反思 | 清洗结果、fallback reasons、是否替换草稿 |
| 12 | 兜底与最终输出 | 最终置信度、拒答/阻断/成功状态、输出摘要 |

提前结束时，触发步骤标记 `blocked` 或 `failed`，未执行步骤标记 `skipped`，时间线仍保持完整，便于识别在哪一层结束。

## 7. 数据模型

```ts
type WorkflowTraceKind = "ingestion" | "query";
type WorkflowTraceStatus =
  | "running"
  | "completed"
  | "blocked"
  | "failed";
type WorkflowStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";
type WorkflowStepSource = "recorded" | "reconstructed";

interface WorkflowTrace {
  id: string;
  kind: WorkflowTraceKind;
  status: WorkflowTraceStatus;
  startedAt: string;
  completedAt?: string;
  actorUserId: string;
  simulatedUserId?: string;
  question?: string;
  documentId?: string;
  relatedDocumentIds: string[];
  ingestionTraceIds: string[];
  steps: WorkflowStep[];
  resultSummary?: WorkflowResultSummary;
  warnings: string[];
}

interface WorkflowStep {
  key: string;
  title: string;
  sequence: number;
  status: WorkflowStepStatus;
  source: WorkflowStepSource;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
  metrics?: Record<string, number | string | boolean>;
  decision?: {
    outcome: string;
    reasonCode?: string;
    explanation?: string;
  };
  warnings: string[];
  detailRefs?: string[];
}
```

所有结构必须可 JSON 序列化。步骤摘要先经过统一脱敏和截断函数，不允许调用方直接把任意大对象写入 trace。

## 8. 记录器设计

新增服务端 `WorkflowTraceRecorder`，负责：

- 创建 trace 和预定义步骤骨架。
- 将步骤从 `pending` 推进到终态。
- 计算持续时间。
- 统一清理、脱敏和截断摘要字段。
- 逐步持久化事件与最终 trace。
- 在实时查询中向订阅者发布步骤事件。

记录器通过可选回调或窄接口注入现有编排函数。未提供记录器时，现有 API 行为保持不变，避免让审计功能侵入普通问答与测试调用。

记录失败不得改变业务函数返回值；记录器把失败追加到 trace 警告，并向服务端日志报告。如果最终 trace 无法持久化，客户端显示“审计记录不完整”，业务回答仍正常返回。

## 9. 实时协议与 API

保留现有 `/api/chat` 兼容行为，审计页使用专用流式接口。

### 9.1 查询运行

`POST /api/workflow-traces/query`

请求：

```json
{
  "actorUserId": "user-admin",
  "question": "社区卫生服务中心的服务规模是多少？",
  "city": "北京",
  "simulatedUserId": "user-employee-riverfront"
}
```

响应使用 `text/event-stream`，事件类型：

- `trace.created`：返回 trace ID 和完整步骤骨架。
- `step.started`：某步骤进入运行态。
- `step.completed`：某步骤成功及其摘要。
- `step.blocked`：业务规则阻断。
- `step.failed`：执行异常。
- `trace.completed`：返回最终 trace 摘要与 `ChatResponse`。

页面收到事件后按 trace ID 合并状态。连接断开时，不显示虚构进度；重新进入页面后通过历史接口读取已持久化事件和最终状态。

### 9.2 历史查询

- `GET /api/workflow-traces?kind=query&limit=50&actorUserId=user-admin`
- `GET /api/workflow-traces/:id?actorUserId=user-admin`

接口在服务端再次校验管理员/开发权限，不只依赖前端隐藏。

### 9.3 文档处理记录

现有文档处理路由在执行过程中写入 ingestion trace，并在响应中附带 `traceId`。处理失败也保存已完成步骤和失败步骤。

## 10. 持久化

沿用现有 `.data` JSON 持久化方式，新增工作流 trace 数据文件。它是审计视图的数据源，不替代 `documents`、`chunks` 或 `ragtables`。

持久化原则：

- 每次文档重新处理生成新的 ingestion trace，旧 trace 保留用于回放。
- 查询 trace 保存命中文档 ID，并在完成时解析这些文档最近的 ingestion trace ID。
- 单个摘要文本限制长度；数组限制条目数，并记录截断前总数。
- 原始向量、完整 prompt、无权正文不写入。
- 写入采用现有持久化队列/锁策略，避免并发覆盖 JSON 文件。

## 11. 历史回溯

当命中文档不存在 ingestion trace 时，后端依据当前 `Document`、`Chunk` 和 `RagTable` 构造只读回溯视图：

- 所有步骤 `source = "reconstructed"`。
- 可确认文档登记、当前 Chunk 数、类型分布、RagTable 数和当前索引状态。
- 不填写 `startedAt`、`durationMs`、当时 provider 或当时告警。
- 页面统一显示“历史回溯：数据由当前持久化状态重建”。

回溯结果按文档动态生成，不伪装成真实保存的 trace，也不反向写入历史时间戳。

## 12. 界面交互

### 12.1 运行工具栏

- “历史运行”选择器按时间倒序列出问题、模拟用户、状态和耗时。
- “发起新审计”打开问题输入与模拟用户选择。
- 运行中按钮禁用重复提交，显示 trace ID 和实时状态。

### 12.2 时间线

- 文档处理链和查询链分组显示，但在同一纵向时间线上保持因果关系。
- `completed` 使用绿色，`running` 使用蓝色脉冲，`blocked` 使用琥珀色，`failed` 使用红色，`skipped` 使用灰色。
- 每行显示步骤名和一个最重要的指标，例如 `396 → 392`、`Top 5` 或“替换草稿 1 次”。
- 点击步骤切换右侧详情，不打开层层弹窗。

### 12.3 步骤详情

- 概览：输入/输出数量、耗时、决策和警告。
- 明细：候选、得分、来源与淘汰原因；默认分页或限制条数。
- 判定规则：实际命中的规则、阈值和原因码。
- 原始事件：经过脱敏和截断的 JSON，供开发排障。

敏感文本和较长原文默认折叠。历史回溯、审计不完整和截断状态始终有可见标签。

## 13. 错误处理

- 业务阻断使用 `blocked`，包括提示注入、范围外、权限拒答和证据不足。
- 技术异常使用 `failed`，包括解析、embedding、LLM 或持久化异常。
- 某步骤终止后，未执行步骤标记 `skipped` 并引用终止步骤。
- 页面断线时保留已接收状态；恢复后读取持久化 trace，不补假事件。
- 审计持久化失败不改变业务结果，但必须暴露“记录不完整”警告。
- 无法确定的信息留空，不使用 `0 ms`、默认 provider 等看似真实的占位值。

## 14. 测试策略

### 14.1 单元测试

- trace 与 step 状态转换合法性。
- 步骤完成、阻断、失败和跳过的持续时间与原因。
- 摘要截断、敏感字段移除、无权正文隔离。
- 历史文档回溯只生成可验证字段。
- 查询结果与 ingestion trace 的关联规则。

### 14.2 集成测试

- 正常回答产生完整查询 trace。
- 提示注入在安全检测步骤阻断。
- 范围外问题在范围判断步骤阻断。
- 仅命中无权资料时记录隔离数量且不泄漏正文。
- 证据不足、LLM 自拒答、答案反思替换和低质量兜底产生正确决策。
- PDF 与文本处理生成 ingestion trace。
- 解析失败、embedding 失败和重新处理生成正确版本记录。
- 未传 recorder 时，原有 `generateAnswer` 和 `processDocument` 行为保持兼容。

### 14.3 UI 验收

- SSE 事件逐步更新状态，运行结束后可回放。
- 阻断、失败、跳过和历史回溯视觉语义不同。
- 步骤选择正确切换详情。
- 管理员和开发可见，普通员工和项目负责人不可见。
- 长明细不会撑破布局，默认摘要可快速扫描。

### 14.4 完成验证

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

通过自动校验后，启动本地服务完成一次真实上传处理、一次正常问答和一次提示注入阻断验收。

## 15. 验收标准

1. 管理员或开发人员提交新问题后，页面实时显示所有已开始步骤的真实状态。
2. 正常回答完成后，能从最终引用反查命中文档及其处理记录。
3. 历史文档没有处理日志时显示回溯数据和明确标识，不展示虚构耗时。
4. 精确、BM25、向量召回及融合重排均能解释候选来源、得分和淘汰原因。
5. 权限过滤展示通过与隔离数量，不泄漏隔离正文。
6. 提示注入、范围外、权限拒答和证据不足能定位到对应阻断步骤。
7. 答案反思能展示是否替换草稿及 fallback reason，最终输出能展示置信度和兜底结果。
8. 历史运行在页面刷新后仍可回放。
9. 普通员工和项目负责人无法从导航或 API 获取审计数据。
10. 现有测试、类型检查和生产构建全部通过。

## 16. 实施顺序建议

1. 定义 trace 类型、状态机、脱敏与持久化，并用单元测试锁定。
2. 接入查询编排，先完成非流式完整 trace，再增加 SSE 实时事件。
3. 接入文档处理链并实现历史回溯。
4. 升级 `/debug` 页面，迁移现有检索解释能力。
5. 补齐权限、失败场景和真实运行验收。
