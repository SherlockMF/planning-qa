# 自动审核 Agent 真实试点记录

日期：2026-07-16
分支：`codex/auto-review-pilot`
起点：`129c7cd61dcd269899315b84f9fab9a02e228798`

## 1. 范围与不可变边界

- 本次只执行 Task 9，不修改 PDF 表格抽取、Chunk、embedding 或 RagTable 构造。
- `.data/chunks.json` 与 `.data/ragtables.json` 仍是检索主数据。
- 本轮只识别切分风险，不修复切分结果；表格仍应按表格结构优化切分。
- 表格切分本身仍未修复，需单独项目处理表格结构切分、合并单元格传播、跨页续表和行边界恢复。

## 2. 三张用户截图

三张源图均使用 `Copy-Item` 逐字节复制，源/目标 SHA-256 相同：

| Fixture | 字节 | SHA-256 | 金标问题 |
| --- | ---: | --- | --- |
| `figure-1.png` | 664121 | `4E23F221B4ED7A19D1F5FC84182219ED16A4DF080BB80A8CA00586C17D15DA0A` | `reading_order_noise`，第 31 页，`tbl-17`，row 8 |
| `figure-2.png` | 519511 | `F7C18CE9A9EB8315A3924223C743DD5C96CA8DCD0AFDDD6F367760FC7BA0441D` | `row_boundary_contamination`，第 42 页，`tbl-29`，row 9 |
| `figure-3.png` | 806404 | `9CBD25BB576D0346CC54F7FF44DA424C80B65DF94C7AE5087E0A8AD9B042FA60` | `semantic_assignment_error`，第 36 页，`tbl-22`，row 5 |

## 3. 真实金标语料

金标：`tests/fixtures/auto-review/gold-v1.json`
Dataset version：`gold-v1-2026-07-16`
SHA-256：`E10DD4C2DD86F21D0775BAB5238CAA74C5D1268707246D640D58016E0BC3D449`

- 总计 63 项：33 issue、30 clean；严重 issue 30 项。
- 五份真实 PDF 的基础样本均为 6 issue + 6 clean；三张已知截图另作为 3 个独立 issue。
- 文档项数：15、12、12、12、12。
- 14 个 document/table group；同一 table 不跨 calibration/blind partition。
- 每项都有 `reviewer`、`reviewedAt`、`partition`、真实页/表/行、`severity`、`issueTypes`、非空 `evidence`、源图路径和源图 SHA-256。
- clean 包含相邻或同类复杂行作为困难负例；仅在原页与 RagTable 差异可证明时标 issue。

真实文档：

1. 北京市居住公共服务设施配置指标京政发〔2025〕25号.pdf
2. 北京市控制性详细规划编制技术标准与成果规范-2022年9月版.pdf
3. 全-规划综合实施方案指南2022.12 最终最新.pdf
4. 中关村朝阳园北区市政交通方案.pdf
5. 北京市城乡规划用地分类标准.pdf

校验结果：

```text
SCHEMA_ERRORS=0
COUNT=63 ISSUE=33 CLEAN=30 MISSING_FIELDS=0 MISSING_IMAGES=0 PARTITION_LEAKS=0
```

为使 Task 9 可重复，`labels.schema.json` 与 CLI validator 同步强制上述人工元数据，并由 CLI 重新计算每张源图 SHA-256；聚焦 TDD 测试先证明旧 CLI 会错误接受缺元数据语料，再验证修复后 5/5 通过。

## 4. 检索数据冻结

审核前基线：

| 文件 | SHA-256 |
| --- | --- |
| `.data/chunks.json` | `F3D45851A001A6F131759561786EC672427E88FEADDADD132E81514A2078A2FF` |
| `.data/ragtables.json` | `2FA0618B9F47982976E1F682891BCE84B636673029C049BDA0324E2241E0B804` |

受控审核隔离复验后两个 hash 与上表逐字节相同。

## 5. rules_only Eval

命令：

```powershell
npm.cmd run eval:auto-review -- tests/fixtures/auto-review/gold-v1.json --mode rules_only
```

- Provider：`deterministic_rules`
- Model：n/a
- Rule version：`v1`
- Mode：`rules_only`
- Exit code：2
- Gate：FAIL；规则模式不能被称为 hybrid Agent 通过。
- 混淆矩阵：TP=8、FP=5、TN=25、FN=25、unavailable=0。
- 严重召回：6/30 = 20%；严重漏报：80%。
- 误报率：5/30 = 16.67%。
- 来源定位：11/13 = 84.62%。
- 不可用率：0%。

问题类型明细：

| 类型 | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| reading_order_noise | 3 | 3 | 5 | 50% | 37.5% |
| row_boundary_contamination | 1 | 5 | 4 | 16.67% | 20% |
| column_misalignment | 0 | 0 | 0 | 0% | 0% |
| merged_cell_scope_error | 0 | 0 | 6 | 0% | 0% |
| missing_content | 0 | 0 | 1 | 0% | 0% |
| source_mapping_error | 0 | 0 | 6 | 0% | 0% |
| semantic_assignment_error | 1 | 4 | 6 | 20% | 14.29% |
| other | 0 | 0 | 0 | 0% | 0% |

## 6. 真实 hybrid Provider Eval

主 checkout `.env.local` 仅确认 `ZHIPU_API_KEY` 存在；未输出或写入密钥。运行时显式设置 `AUTO_REVIEW_ENABLED=1`，未配置独立 endpoint/model 覆盖值。

```powershell
npm.cmd run eval:auto-review -- tests/fixtures/auto-review/gold-v1.json --mode hybrid
```

- Provider：`zhipu_auto_review`
- Model：`glm-4v-flash`
- Rule version：`v1`
- 请求项：63
- 最终 mode：`unavailable`
- Exit code：2
- Gate：FAIL
- 混淆矩阵：TP=0、FP=0、TN=0、FN=0、unavailable=63。
- 严重召回：0%；严重漏报：100%；误报率：0%；定位准确率无有效预测，报告默认 100%；不可用率：100%。
- 所有问题类型均无可计算的有效模型预测，不能声称类型准确率通过。

单项脱敏诊断：HTTP 200，但模型返回带 Markdown `json` 围栏的内容；clean 结果同时给出空 `summary` 和空 `sourceEvidence`。严格解析报 `invalid_auto_review_json`。未修改 Task 1-8 Provider 合约；该兼容问题应另行修复和重新校准。

### 6.1 Provider 兼容性复验（Task 10）

复验分支：`codex/auto-review-provider-compat`。保留上面的 63/63 unavailable 记录作为修复前历史证据。

focused TDD 只运行 `tests/auditAutoReviewProvider.test.ts`：

- RED：8 项中 2 项按预期失败；Markdown fenced JSON 报 `invalid_auto_review_json`，clean 空摘要报 `missing_auto_review_summary`。
- GREEN：8/8 通过，exit code 0。
- 兼容范围只接受纯 JSON 对象或整段由单一 Markdown JSON 围栏包裹的对象；不接受围栏外说明或多个对象。
- 只对 `clean` 的空白字符串规范化：摘要为“未发现需要标记的切分风险”，来源说明为“模型未提供具体来源说明”。后者不声称页码、表格或行定位。
- `suspected_issue` 的摘要/来源字段仍必须非空；非 JSON、缺字段和未知 `issueType` 仍拒绝。

使用主 checkout `.env.local` 中已确认存在的 `ZHIPU_API_KEY`，显式设置 `AUTO_REVIEW_ENABLED=1`，未配置独立 endpoint/key/model 覆盖，再次运行同一命令：

```powershell
npm.cmd run eval:auto-review -- tests/fixtures/auto-review/gold-v1.json --mode hybrid
```

- Provider：`zhipu_auto_review`
- Model：`glm-4v-flash`
- Rule version：`v1`
- 请求项：63
- 最终 mode：`partial`
- Exit code：2
- Gate：FAIL
- 混淆矩阵：TP=3、FP=0、TN=22、FN=22、unavailable=16。
- 严重召回：1/30 = 3.33%；严重漏报：29/30 = 96.67%。
- 误报率：0/30 = 0%。
- 来源定位：3/3 = 100%。
- 不可用率：16/63 = 25.40%。

问题类型明细：

| 类型 | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| reading_order_noise | 1 | 0 | 3 | 100% | 25% |
| row_boundary_contamination | 0 | 0 | 3 | 0% | 0% |
| column_misalignment | 0 | 0 | 0 | 0% | 0% |
| merged_cell_scope_error | 0 | 0 | 6 | 0% | 0% |
| missing_content | 0 | 0 | 1 | 0% | 0% |
| source_mapping_error | 0 | 0 | 5 | 0% | 0% |
| semantic_assignment_error | 1 | 2 | 5 | 33.33% | 16.67% |
| other | 0 | 0 | 0 | 0% | 0% |

单项脱敏诊断选择一个 unavailable 项复现：HTTP 200，响应为单一 JSON 围栏，围栏内是包含全部五个字段的合法对象；该 `suspected_issue` 返回了契约外 issue type，严格解析按预期报 `invalid_auto_review_issue_type`。未记录模型原文、文档内容或密钥，也未用默认值掩盖 issue 字段或把未知类型映射为 `other`。

复验结论：已知 fenced JSON / clean 空字段兼容问题不再造成 63/63 unavailable，47 项已有有效预测；但 severe recall 与 unavailable rate 仍远未达到 gate。决策保持 shadow/adjust，不启用自动风险排序，不声称 hybrid gate 通过。

### 6.2 Provider prompt 枚举最终复验（Task 10）

47/63 有效结果的脱敏诊断显示，`suspected_issue` 会返回契约外 issue type；原 prompt 只限制“最多 4 个”，却没有告诉模型允许值。这是请求 prompt 与严格 parser 的可控不一致。

focused TDD 再次只运行 `tests/auditAutoReviewProvider.test.ts`：RED 7/8、GREEN 8/8。测试从实际请求体读取 prompt，逐一确认八个允许值（含 `other`）均出现，并确认 prompt 要求 `issueTypes` 只能从该枚举选择。实现只改 Provider prompt；没有增加 `response_format`，没有映射或吞掉未知类型，严格 parser 保持不变。

随后用同一 `gold-v1` 完成最终 63 项复验：

- Provider：`zhipu_auto_review`
- Model：`glm-4v-flash`
- Rule version：`v1`
- 请求项：63
- 最终 mode：`partial`
- Exit code：2
- Gate：FAIL
- 混淆矩阵：TP=2、FP=0、TN=17、FN=16、unavailable=28。
- 严重召回：0/30 = 0%；严重漏报：30/30 = 100%。
- 误报率：0/30 = 0%。
- 来源定位：2/2 = 100%。
- 不可用率：28/63 = 44.44%。

问题类型明细：

| 类型 | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| reading_order_noise | 0 | 0 | 3 | 0% | 0% |
| row_boundary_contamination | 0 | 0 | 1 | 0% | 0% |
| column_misalignment | 0 | 0 | 0 | 0% | 0% |
| merged_cell_scope_error | 0 | 0 | 6 | 0% | 0% |
| missing_content | 0 | 0 | 1 | 0% | 0% |
| source_mapping_error | 0 | 0 | 1 | 0% | 0% |
| semantic_assignment_error | 1 | 1 | 5 | 50% | 16.67% |
| other | 0 | 0 | 0 | 0% | 0% |

最终脱敏抽样确认请求 prompt 已完整枚举并限制 issueTypes，抽样响应的 issueTypes 也都在枚举内；但同一输入重试不稳定，其中一个已知 issue 样本仍把 `clean.sourceEvidence` 返回为 `null`，严格解析按预期报 `missing_auto_review_source_evidence`。因此未知类型的请求侧不一致已修复，但模型仍存在其他外部契约不服从，不能放宽 parser 掩盖。

最终兼容性结论：自动审核 Provider 从历史的 0/63 提升为 35/63 有效，但本轮不可用率仍为 44.44%，且严重召回未达 gate。保持 shadow/adjust，不启用自动放行或自动风险排序。

## 7. 真实 UI 审核与复审

运行应用：最终分支 Next.js dev server，独立端口 3300。真实 runtime artifact：

- Document：`doc-1782564480335-lkrbih`
- Artifact：`artifact-task9-pilot-20260716`
- 自动模式：`rules_only`
- 审核项：三张已知真实问题

Playwright headed 流程：

1. 首轮 `review-task9-round-1`：三项均人工确认 issue，最终 `issues_found`，finalized，页面显示“已提交 · 只读”。
2. 点击“发起复审”：页面明确显示“基于同一审核快照发起独立复审，未重新解析文档”。
3. 第二轮 `review-32e75f3f-b13a-49e7-a583-58ccd1abaadf`：三项复核后 finalized 为 `issues_found`。
4. 轮次下拉可分别选择并读取“第 1 轮 · 已提交”和“第 2 轮 · 已提交”；第二轮显示 `parentReviewId=review-task9-round-1`。
5. 动态网络记录：首轮 PATCH 200、发起复审 POST 201、第二轮 PATCH 200；`/process` 调用数为 0。

首次 UI 服务未继承 `ZHIPU_API_KEY`，启动时检测 embedding 签名由 `zhipu-embedding:embedding-3` 变为 `mock-local-embedding:256`，既有 `ensureSeeded()` 自动重建 `.data` 并把上传文档置 pending；因此原页 API 返回 403。这是启动环境副作用，不是审核 endpoint 或 `/process` 调用。该次 hash 变化未被隐藏。

随后停止服务，从冻结主 checkout 恢复 `.data`，以正确 embedding 配置启动端口 3301，并执行一次隔离复验轮次：

- `review-526eeba6-05c3-4300-ac2a-77ab3cb90d81`
- Parent：`review-32e75f3f-b13a-49e7-a583-58ccd1abaadf`
- POST 201、finalize PATCH 200、状态 `issues_found`
- 原页 API 恢复 200
- 复验前后两份检索数据 hash 均与冻结基线相同

运行时 `artifacts/`、`.data/`、`debug/auto-review-eval/`、Playwright trace、日志均不提交。

## 8. 试点结论

- rules_only 严重召回仅 20%，且误报率、定位准确率均未达 gate。
- 真实 Provider 最终 35/63 有效，不可用率 44.44%；已修复 prompt 与 issueTypes 枚举不一致，但模型仍会违反其他严格字段契约。
- hybrid 严重召回 0%、误报率 0%、定位准确率 100%（仅 2 个定位预测），仍无法证明混合 Agent 可用于自动放行或自动排序。
- 人工不可变轮次、复审链和无 `/process` 路径成立；正确配置下审核动作不改变检索主数据。
- 当前保持自动审核 shadow + 人工抽查；继续收集误报/漏报样本并校准模型或规则，在同一 `gold-v1` 通过 gate 前不启用自动风险排序。
- 表格切分本身仍未修复，需单独项目；本轮不得描述为切分质量已修复或 hybrid Agent 已验收。

最终决策：自动审核仅用于 shadow/人工抽查，不启用自动排序
