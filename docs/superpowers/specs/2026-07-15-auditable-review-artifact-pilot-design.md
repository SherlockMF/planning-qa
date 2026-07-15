# 可审计文档审核副本小范围试点设计

日期：2026-07-15
状态：基础设计已书面复核；自动审核、人工抽查、风险 Eval 和独立复审由
`2026-07-16-auto-review-agent-human-sampling-design.md` 扩展并在冲突处取代本文。

## 1. 背景

当前文档处理链为：

```text
原文件 → Block/Table IR → KnowledgeObject → Chunk → embedding/RagTable
```

正式检索数据持久化在 `.data/*.json`。系统没有按知识块独立落盘 Markdown；现有
`debug/<docId>/11_retrieval_preview.md` 是调试预览，不是面向运营审核的正式副本。

本试点增加一层可人工阅读、可追溯、与检索主数据隔离的审核副本。Markdown 和
HTML 只作为审核 sidecar，不成为检索或重新入库的数据来源。

## 2. 试点目标

- 让知识库运营/内容管理员在不接触 `.data` 内部结构的情况下检查解析结果。
- 让审核项能够追溯到原文页码、Block/Table、KnowledgeObject、Chunk 和 RagTable。
- 记录“通过/有问题”、问题类型和备注，形成最小审核闭环。
- 验证 5 份代表性文档能否在低成本、低风险条件下完成审核。
- 证明审核过程不会修改检索主数据或触发重新入库。

## 3. 非目标

- 不把 Markdown 或 HTML 作为检索主数据。
- 不允许审核人员修改解析内容、Chunk 或 RagTable。
- 不实现内容修订、重新切块、重新 embedding 或重新入库。
- 不实现任务分派、多人会签、审批流、通知或正式发布。
- 不处理多实例部署、对象存储和跨环境集中归档。
- 不复制 embedding、API Key、环境变量或原始上传文件。

## 4. 试点范围

### 4.1 目标用户

主要用户是知识库运营/内容管理员。业务专家只在运营人员发现业务语义争议时提供线下复核，
不进入首轮系统流程。

### 4.2 样本文档

共 5 份：

- 2 份普通文本型文档；
- 2 份复杂表格型文档；
- 1 份已知存在解析问题的文档。

### 4.3 审核动作

审核人员只可：

- 查看文档摘要、解析结果和来源定位；
- 将审核项标记为“通过”或“有问题”；
- 为问题选择固定类型并填写备注；
- 保存草稿或最终提交审核结果。

## 5. 方案选择

采用“审核副本 + 极简审核记录”方案。

纯静态审核包虽然改动最少，但无法可靠保存审核结论；完整审核工作流又明显超出 5 份文档的
试点范围。选定方案只增加审核副本生成、受权限保护的查看入口和独立审核结果文件，不侵入检索逻辑。

## 6. 架构与边界

首轮假设系统运行在当前单机、本地文件持久化环境。

```text
原文件 → 现有处理链 → .data/chunks.json、.data/ragtables.json
                    │
                    └─ 成功后只读投影
                              ↓
                     AuditArtifactExporter
                              ↓
                 artifacts/<docId>/<artifactId>/
```

设计原则：

- `.data/chunks.json` 和 `.data/ragtables.json` 继续作为检索权威数据。
- 审核副本从同次处理产生的结构化对象投影生成，不反向驱动检索。
- 每次生成独立快照，不覆盖旧审核证据。
- `artifacts/` 不放入 `public/`，读取和提交均通过受权限保护的服务端入口。
- 审核只能写独立的 `review-result.json`。
- 副本生成失败不回滚已经成功的索引，但必须明确报告失败。

## 7. 文件结构

```text
artifacts/<docId>/<artifactId>/
├─ manifest.json
├─ review.md
├─ review.html
└─ review-result.json
```

- `manifest.json`：来源、映射、计数和完整性校验；生成后不可修改。
- `review.md`：便于归档、比较和人工阅读的静态报告。
- `review.html`：与 Markdown 使用同一审核数据，并提供审核表单。
- `review-result.json`：生成时写入 `pending` 初始状态，之后保存草稿和最终审核状态；最终提交后锁定。

`artifactId` 由服务端生成并保证在文档目录内唯一。重新处理同一文档会产生新快照，旧快照保留。

## 8. Manifest 数据设计

`manifest.json` 的最小结构为：

```text
schemaVersion
artifactId
generatedAt

document
  id
  fileName
  sourceFileSha256

pipeline
  dataSchemaVersion
  embeddingSignature

summary
  blockCount
  knowledgeObjectCount
  chunkCount
  ragTableCount
  warningCount

items[]
  auditItemId
  objectType
  title
  sourcePageStart
  sourcePageEnd
  sourceBlockIds
  sourceTableId
  sourceRowIndex
  knowledgeObjectId
  chunkIds
  ragTableId
  confidence
  warnings
  contentSha256
  selectedForReview
  selectionReason

files
  reviewMdSha256
  reviewHtmlSha256
```

审核副本只保存人工检查需要的正文、表格呈现、警告和来源映射，不保存 embedding，也不复制整份
`.data/*.json`。

## 9. 审核记录数据设计

`review-result.json` 的最小结构为：

```text
schemaVersion
artifactId
reviewerUserId
status                  # pending | draft | passed | issues_found
startedAt
updatedAt
finalizedAt

items[]
  auditItemId
  status                # passed | issue
  issueTypes[]
  comment
```

约束：

- 初始 `pending` 状态下，审核人和审核时间字段可以为空；首次保存草稿时写入审核人与 `startedAt`。
- 审核记录只能引用当前 manifest 中存在的 `auditItemId`。
- 标记“有问题”时，必须同时选择问题类型并填写备注。
- 未完成全部重点审核项时只能保存草稿。
- 最终状态由条目自动汇总：全部通过为 `passed`，存在问题为 `issues_found`。
- `finalizedAt` 写入后，文件只读，不能无痕覆盖。

## 10. 重点审核项选择

为满足每份文档审核中位耗时不超过 15 分钟，采用“全量可查看、重点项必审”，每份文档最多
生成 20 个重点审核项。

选择顺序：

1. 优先纳入有 warning 或 `confidence < 0.80` 的对象。
2. 在 20 项名额内，每张 RagTable 至少纳入一个表头和一个代表行。
3. 尽量覆盖不同 `objectType` 和不同页段。
4. 剩余名额使用以 `docId + artifactId` 为种子的稳定抽样；同一快照重复打开时结果不变。

如果表格最低覆盖需求已经超过 20 项，优先保留有 warning 或低置信度的表格，并在 manifest 中
记录覆盖不足警告。选择结果和原因写入 manifest。全量对象仍可浏览和搜索；审核人员发现非重点项
问题时，也可主动为该项添加审核记录。

## 11. 审核流程

```text
文档索引成功
  → 生成审核快照
  → 文档管理页显示“待审核”
  → 运营人员打开受权限保护的 review.html
  → 检查摘要、计数和 warnings
  → 完成重点项审核
  → 最终提交
  → review-result.json 锁定
```

问题类型固定为：

- 内容缺失；
- 文本识别错误；
- 章节或条款结构错误；
- 表格错列、漏行或合并错误；
- 原文页码或来源定位错误；
- 对象类型识别错误；
- 其他。

首轮页面不提供“修正”“重新解析”“重新入库”等按钮。

## 12. 失败处理与完整性

### 12.1 审核副本生成

- 检索数据成功落盘后再生成审核副本。
- 先写临时目录，完成内容、哈希和 manifest 后，再原子重命名为正式目录。
- 生成失败时删除临时目录，不暴露半成品。
- 生成失败不改变文档的 `indexed` 状态。
- 处理响应明确区分“索引成功、审核副本成功”和“索引成功、审核副本失败”。

### 12.2 审核记录保存

- `review-result.json` 使用临时文件加原子替换。
- 打开审核页面时校验 `review.md` 和 `review.html` 的哈希。
- 文件哈希不一致时显示损坏警告并禁止提交。
- 当前原文件哈希与 manifest 不一致时，提示原文件已变化并禁止提交旧快照。
- 已 finalized 的结果只能读取。

## 13. 权限与安全

- 复用现有文档管理权限，不新增公开静态访问路径。
- 服务端校验 `docId` 和 `artifactId`，禁止路径穿越。
- 原文和解析内容写入 HTML 前统一转义，禁止原始脚本执行。
- 状态与问题类型使用固定枚举，备注限制长度。
- 无管理权限的用户不能列出、读取或提交审核副本。
- 审核产物不保存 embedding、密钥、环境变量或原始文件副本。

## 14. 测试策略

### 14.1 单元测试

- 重点项选择稳定且不超过 20 项。
- warning、低置信度对象及 RagTable 代表项按规则入选。
- manifest 映射和文件哈希正确。
- HTML 内容正确转义。
- 无效审核项和不完整问题记录被拒绝。
- finalized 结果不能覆盖。

### 14.2 集成测试

- 正常处理生成四个完整审核文件。
- 人为制造副本生成失败时，文档仍保持 `indexed`，且接口返回明确状态。
- 无管理权限用户读取和提交均返回拒绝。
- 篡改审核文件后禁止提交。
- 打开、保存草稿和最终提交期间，`.data/chunks.json` 与 `.data/ragtables.json` 哈希不变。
- 现有自动化测试、类型检查和生产构建继续通过。

## 15. 试点验收指标

1. 5/5 文档成功生成完整审核快照，manifest 校验全部通过。
2. 跨 5 份文档抽查 20 个审核项，至少 19 个能通过页码、Block/Table、
   KnowledgeObject、Chunk 或 RagTable 标识定位到对应来源，可追溯率不低于 95%。
3. 每份文档从 `startedAt` 到 `finalizedAt` 的审核时间中位数不超过 15 分钟。
4. 所有问题记录均有审核项、问题类型、备注、审核人和时间，完整率 100%。
5. 已知问题文档至少形成一条完整、可追溯的问题记录。
6. 审核前后 `.data/chunks.json` 和 `.data/ragtables.json` 哈希不变。

## 16. 试点结论规则

试点完成后只做以下三种判断，不自动扩大范围：

- **继续**：全部硬性指标达到，且运营人员认为报告可理解、操作可接受。
- **调整**：副本生成和数据隔离达标，但耗时、抽样或呈现方式未达标；先修订试点设计。
- **停止**：副本无法稳定追溯来源、影响检索主数据，或审核人员无法独立使用。

正式审批、内容修正和回写检索链路必须作为后续独立设计重新评审。
