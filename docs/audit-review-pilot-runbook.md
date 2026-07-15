# 可审计审核副本试点运行记录

## 试点边界与结论先行

- 执行日期：2026-07-15（记录时间戳为 UTC）。
- 执行环境：隔离 worktree `D:\OPC\enterprise-knowledge-qa-wenda\.worktrees\auditable-review-artifact-pilot`，分支 `codex/auditable-review-artifact-pilot`。
- 执行人：Codex 代理，使用 `user-admin` 权限驱动真实页面；不视为目标运营人员独立可用性验收。
- 主数据边界：`.data/chunks.json` 与 `.data/ragtables.json` 仍是检索主数据；`artifacts/` 仅是可审计副本，未将 Markdown 作为检索输入。
- 最终选择：**调整**。技术硬门全部通过，但本轮是代理自动化执行，审核耗时和界面可用性不能代表真实运营人员。下一轮需由目标运营人员独立完成 5 份文档。

## 预检与服务

试点前在上述 worktree 执行：

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

结果：`npm.cmd test` 201/201 通过，`tsc` 与 `build` 均退出 0。已知非阻断告警是 Node `MODULE_TYPELESS_PACKAGE_JSON` 与既有 ESLint plugin 冲突。

启动与端口确认：

```powershell
$p = Start-Process -FilePath "C:\Program Files\nodejs\npm.cmd" `
  -ArgumentList @("run", "dev:big") `
  -WorkingDirectory "D:\OPC\enterprise-knowledge-qa-wenda\.worktrees\auditable-review-artifact-pilot" `
  -RedirectStandardOutput ".dev-audit-pilot.out.log" `
  -RedirectStandardError ".dev-audit-pilot.err.log" `
  -WindowStyle Hidden -PassThru
Get-Content .dev-audit-pilot.out.log
Get-NetTCPConnection -State Listen -LocalPort 3200
Invoke-WebRequest -UseBasicParsing http://localhost:3200/documents
```

实际结果：Next.js `Ready in 2.4s`，`http://localhost:3200/documents` 返回 200；监听 PID 27740 的命令行指向隔离 worktree。

## 样本与修复后最新快照

在任何 review GET/PUT 前，通过受保护的 process 端点重新处理全部五份文档。五份响应均包含 `auditArtifact.status = "created"`。

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3200/api/documents/<docId>/process?userId=user-admin" `
  -TimeoutSec 900
```

| 类型 | 文档 ID | 文件名 | Artifact ID | Block/Object/Chunk/RagTable | 重点项 |
| --- | --- | --- | --- | --- | ---: |
| 普通文本 1 | `doc-1782556309121-xxxmiw` | 企业财务报销管理制度（演示版）.md | `20260715141555-4d83d67e` | 24 / 23 / 23 / 0 | 20 |
| 普通文本 2 | `doc-1782556312172-q86mbo` | 设计软件账号与IT服务申请指南（演示版）.md | `20260715141602-0a6bb581` | 21 / 7 / 7 / 0 | 7 |
| 复杂表格 1 | `doc-1782564681224-w8e22z` | 全-规划综合实施方案指南2022.12 最终最新.pdf | `20260715141618-7f86f873` | 642 / 799 / 901 / 4 | 20 |
| 复杂表格 2 | `doc-1782564705711-ht5y01` | 中关村朝阳园北区市政交通方案.pdf | `20260715141645-83e268f1` | 524 / 550 / 607 / 28 | 20 |
| 已知问题 | `doc-1782564480335-lkrbih` | 北京市居住公共服务设施配置指标京政发〔2025〕25号.pdf | `20260715141704-15588c92` | 712 / 938 / 1016 / 38 | 20 |

两份复杂文档的 `ragTableCount` 为 4 和 28，均大于 0；已知问题文档为 38。每个最新 artifact 目录都精确包含 `manifest.json`、`review.md`、`review.html`、`review-result.json` 四个文件。

## 快照完整性与来源哈希

命令：

```powershell
Get-FileHash -Algorithm SHA256 artifacts/<docId>/<artifactId>/manifest.json
Get-FileHash -Algorithm SHA256 artifacts/<docId>/<artifactId>/review.md
Get-FileHash -Algorithm SHA256 artifacts/<docId>/<artifactId>/review.html
Get-FileHash -Algorithm SHA256 .data/raw/<docId>
```

| 文档 ID | manifest.json SHA-256 | 原文 SHA-256 | review.md SHA-256 | review.html SHA-256 |
| --- | --- | --- | --- | --- |
| `doc-1782556309121-xxxmiw` | `b638595c0ea2301124ba037413d5d9e69ca9ee2c4a017082666a284c83bfe32b` | `e95c1a205d983f5ecef783cadae09ee5b2ded66ff3df3d27ba821fbc37471900` | `c44d10fe89a9c5957dd6308a794f79cd9596e0609051f678419f73b625577aa7` | `07e739d70669eb5393a8bdab7abde64f1718ef771c2112865fb66273725d12f0` |
| `doc-1782556312172-q86mbo` | `e2edd0540a004b43632437cd0ea69f3dbe5cf3cd2e61f23d00f2aaddef8685f5` | `afcb2217e32783de5c621d275417425c41d9b4999acd8b5d957ccae8f00974a2` | `eef9101b774d66569d7d8ef1ab2deff7625abdd13b49600bbec0c04863e75459` | `b832e7364afc073a8a2a83cd861f523661ca614b128b74dd976ab0f6d3e300f4` |
| `doc-1782564681224-w8e22z` | `ab4bcd51d09d3fb9760bf5e24fdf929f89c9fc14a227d080d90297b6b0cddebe` | `fe8c8d341e753bd45df7f71641e9c93f15d2be1653e771883891329f187c22a1` | `b6d361caebc54731723e08a2f7f21ac196f3ae5392a7496f4bcf00c10fe2780b` | `760cb9af39acee8e8b23fb4ab86ea6732b45c8a0eada6d43d02fa3b3deede4bf` |
| `doc-1782564705711-ht5y01` | `f1d2cca934214dff6cd62ff8ce75d359ac4236538f46da9059f2b7c6c57a5129` | `4ab4317c9bfcbc246be5fa401c88d6834cfa52123aceccf7817b9d97af071d84` | `eb1b44285e44622a85a319e2d126ef8b6a9f62648e4676f42ba26120b034c58b` | `98ab172895d6440a8308b700589c3bc84c38104b805f12588a7edef0193158cf` |
| `doc-1782564480335-lkrbih` | `6e8cf58ccf7742b8de835fe957af337111a5e608dab39f04a95affb29b66d63b` | `b0cb95f5d7d676d332f48184431d2f13da082d375cd7a480d4e11db342e2997c` | `2f4e0c1b3ed4ed7f35628226dadc917c943025a0791d173d7acfacfafd2cd828` | `79baa0626a44fd8a8f31a154e9da0889844418329a0742bd2dcf6ab14cf0070b` |

五份原文实际哈希均与 manifest 的 `sourceFileSha256` 一致，MD/HTML 实际哈希也均与 manifest 一致。

## 主数据隔离检查

五份文档全部重新处理成功后、打开第一份审核页面前冻结基线：

```powershell
Get-FileHash -Algorithm SHA256 .data/chunks.json,.data/ragtables.json
```

| 文件 | 审核前 SHA-256 | 五份全部定稿后 SHA-256 | 一致 |
| --- | --- | --- | --- |
| `.data/chunks.json` | `E4AA18C0BEF44CF428769D4A4B4E8A0066B87D48FF722621DAF02CE5E2DF1049` | `E4AA18C0BEF44CF428769D4A4B4E8A0066B87D48FF722621DAF02CE5E2DF1049` | 是 |
| `.data/ragtables.json` | `93A0F53EFDFF266C9BE2C25ACC691E4648E1FFD14FF9B82C23C2EE7B40AA643D` | `93A0F53EFDFF266C9BE2C25ACC691E4648E1FFD14FF9B82C23C2EE7B40AA643D` | 是 |

结论：审核读取、草稿保存和定稿没有改变检索主数据。

## 真实页面审核操作

使用 Playwright CLI 打开每个最新受保护 HTML，每次导航后 snapshot：

```powershell
npx.cmd --yes --package @playwright/cli playwright-cli -s=auditpilot open `
  "http://localhost:3200/api/documents/<docId>/review-artifacts/<artifactId>?userId=user-admin"
npx.cmd --yes --package @playwright/cli playwright-cli -s=auditpilot snapshot
```

每份文档的全部 `data-required=true` 项均在页面中设为通过；已知问题另外在非重点项中记录一条问题。然后通过页面先点击“保存草稿”，确认 PUT 200，再点击“最终提交”，确认 PUT 200。五份页面定稿后均禁用 select/textarea/button，显示只读。

| 文档 ID | startedAt | finalizedAt | 秒 | 分钟 | 定稿状态 | 问题数 | 问题记录完整 |
| --- | --- | --- | ---: | ---: | --- | ---: | --- |
| `doc-1782556309121-xxxmiw` | `2026-07-15T14:21:24.971Z` | `2026-07-15T14:21:37.068Z` | 12.097 | 0.202 | `passed` | 0 | N/A |
| `doc-1782556312172-q86mbo` | `2026-07-15T14:21:57.867Z` | `2026-07-15T14:21:57.954Z` | 0.087 | 0.001 | `passed` | 0 | N/A |
| `doc-1782564681224-w8e22z` | `2026-07-15T14:22:22.159Z` | `2026-07-15T14:22:22.510Z` | 0.351 | 0.006 | `passed` | 0 | N/A |
| `doc-1782564705711-ht5y01` | `2026-07-15T14:22:43.925Z` | `2026-07-15T14:22:44.796Z` | 0.871 | 0.015 | `passed` | 0 | N/A |
| `doc-1782564480335-lkrbih` | `2026-07-15T14:23:59.761Z` | `2026-07-15T14:24:00.047Z` | 0.286 | 0.005 | `issues_found` | 1 | 是 |

代理自动化耗时中位数为 0.006 分钟（0.351 秒），低于 15 分钟技术阈值，但不可用作人工审核耗时结论。唯一问题通过 review 顶层字段继承 `reviewerUserId=user-admin` 和 `finalizedAt=2026-07-15T14:24:00.047Z`，加上项级 `auditItemId`、`issueTypes`、`comment`，完整率为 100%。

## 可追溯抽查

五份 manifest 共 87 个重点项。先按 `artifactId + auditItemId` 排序，再用 `round(i * 86 / 19)`（`i=0..19`）等距取样。Block 以 `02_cleaned_blocks.json` 的 `block-N` 索引验证，Object 以 `08_knowledge_objects.json` 验证，Chunk/RagTable 以 `.data/chunks.json` 和 `.data/ragtables.json` 验证。

| # | 文档 | auditItemId | 页码 | Block/Table 可定位 | Object/Chunk/RagTable 可定位 | 通过 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `xxxmiw` | `checklist_item:checklist_item-1unskbr` | 1-1 | 是 | 是 | 是 |
| 2 | `xxxmiw` | `procedure_step:procedure_step-1abo6ob` | 1-1 | 是 | 是 | 是 |
| 3 | `xxxmiw` | `procedure_step:procedure_step-1of1tc9` | 1-1 | 是 | 是 | 是 |
| 4 | `xxxmiw` | `procedure_step:procedure_step-6tvqe2` | 1-1 | 是 | 是 | 是 |
| 5 | `xxxmiw` | `procedure_step:procedure_step-i1mjke` | 1-1 | 是 | 是 | 是 |
| 6 | `q86mbo` | `plain_section:plain_section-xfosxx` | 1-1 | 是 | 是 | 是 |
| 7 | `w8e22z` | `plain_section:plain_section-105rit8` | 21-23 | 是 | 是 | 是 |
| 8 | `w8e22z` | `plain_section:plain_section-15h2o3v` | 64-64 | 是 | 是 | 是 |
| 9 | `w8e22z` | `plain_section:plain_section-17y26rc` | 64-64 | 是 | 是 | 是 |
| 10 | `w8e22z` | `plain_section:plain_section-1dtnt1i` | 12-15 | 是 | 是 | 是 |
| 11 | `w8e22z` | `plain_section:plain_section-1j179xh` | 65-65 | 是 | 是 | 是 |
| 12 | `ht5y01` | `structured_table_row:structured_table_row-10m3ask` | 49-49 | `block-384 / tbl-22` | 是 | 是 |
| 13 | `ht5y01` | `structured_table_row:structured_table_row-11ds7ti` | 51-51 | `block-474 / tbl-23` | 是 | 是 |
| 14 | `ht5y01` | `structured_table_row:structured_table_row-13zxvez` | 49-49 | `block-384 / tbl-22` | 是 | 是 |
| 15 | `ht5y01` | `structured_table_row:structured_table_row-16qoemk` | 49-49 | `block-384 / tbl-22` | 是 | 是 |
| 16 | `lkrbih` | `indicator_item:indicator_item-11691a3` | 29-29 | `block-330 / tbl-14` | 是 | 是 |
| 17 | `lkrbih` | `indicator_item:indicator_item-11mtexm` | 12-13 | `block-84 / tbl-2` | 是 | 是 |
| 18 | `lkrbih` | `indicator_item:indicator_item-17so7s3` | 7-8 | `block-36 / tbl-0` | 是 | 是 |
| 19 | `lkrbih` | `indicator_item:indicator_item-1cudmx3` | 51-51 | `block-656 / tbl-36` | 是 | 是 |
| 20 | `lkrbih` | `plain_section:plain_section-rqm00e` | 37-56 | 是 | 是 | 是 |

抽查结果：20/20（100%）通过，高于 19/20 硬门。

## 已知问题闭环

- 已知问题：同一表中编号 22、名称“综合环卫站”的 `rowIndex=4` 是“街道级”，`rowIndex=5` 是“小计”，但两行都被抽取为 `classification_code`。两行现已有唯一 ID，但“小计”行作为分类编码对象仍有语义风险。
- 对应 auditItemId：`classification_code:classification_code-98918i`。
- 问题类型：`object_type_error`。
- 备注：“汇总行被抽取为分类编码对象，需确认是否应排除/降级：page 43，block-533，tbl-31，rowIndex 5 为‘小计’，但生成 classification_code-98918i。”
- 来源定位：page 43，`block-533`，`tbl-31`，`structured_table-17q2g1c`，父行 `structured_table_row-1e4z5hv`，Object `classification_code-98918i`，Chunk `chunk-classification_code-98918i`。
- 对照行：`rowIndex=4` / `classification_code-1kcchpf` / “街道级”；问题行：`rowIndex=5` / `classification_code-98918i` / “小计”。
- 定稿结果：`issues_found`，审核人 `user-admin`，定稿时间 `2026-07-15T14:24:00.047Z`。

## 权限、防篡改和负面测试

### 现场受保护端点检查

- 以 `user-employee-riverfront` 请求 list、artifact、review 三个端点：均返回 403，`{"error":"当前账号无权审核该文档"}`，且 `Cache-Control: no-store, private`。
- 对已定稿 artifact 再次 PUT `action=finalize`：返回 409，`{"error":"审核结果已提交"}`。
- 五份 review GET 均显示 `canSubmit=false`；前四份为 `passed`，已知问题文档为 `issues_found`。

### 不破坏最终样本的定向回归

篡改和原文变更测试使用测试自带临时 fixture，没有修改五份最终样本：

```powershell
node --experimental-strip-types --test `
  --test-name-pattern="artifact responses enforce integrity|list and review JSON responses|isolates review artifact writer failures" `
  tests/index.ts
```

结果 3/3 通过：

- 篡改 `review.html` 后，HTML/Markdown/manifest 访问均返回 409，且提交门禁关闭。
- 原文缺失或哈希变更后，草稿提交返回 409，错误为“原文件已变化，旧快照不能提交”。
- artifact writer 抛出 `disk unavailable` 时，创建结果被隔离为 `{status:"failed"}`。路由在创建 artifact 前已将文档设为 `indexed`；本轮未在真实五文档上人为破坏文件系统来复演 HTTP 200 失败分支。

## 副本数据最小化检查

对五个最终 artifact 扫描：

```powershell
rg -n -i 'api[_-]?key|process\.env|begin (rsa |ec |openssh )?private key|authorization:|bearer [a-z0-9._-]{12,}|"embedding"\s*:' artifacts/<docId>/<artifactId>
rg -n -i embedding artifacts/<docId>/<artifactId>
```

结果：

- 五份敏感模式命中均为 0。
- 每份仅有 1 处 embedding 相关字段：manifest 中允许的 `"embeddingSignature": "mock-local-embedding:256"`；无 `embedding` 向量字段。
- 每个目录仅有四个规定文本文件，没有原文副本；任一 artifact 文件的 SHA-256 都不等于对应 `.data/raw/<docId>` 原文哈希。

## 硬门汇总与下一步

| 硬门 | 结果 |
| --- | --- |
| 5/5 目录精确四文件，来源与 MD/HTML 哈希一致 | 通过 |
| 复杂样本有 RagTable | 通过（4、28；已知问题样本 38） |
| 重点项完成，每份先草稿后定稿 | 通过 |
| 定稿后只读，二次定稿 409 | 通过 |
| 可追溯抽查不少于 19/20 | 通过（20/20） |
| 问题记录完整率 | 通过（100%） |
| 已知问题至少一条完整可追溯 issue | 通过（1 条） |
| 审核前后 chunks/ragtables 哈希不变 | 通过 |
| 中位审核时间不超过 15 分钟 | 代理技术值通过；人工值未验收 |
| 目标运营人员可独立使用 | 未验收 |

因最后两项尚需人工证据，本轮不选“继续”。下一轮保持同样的 5 文档与 20 项抽查方法，由 1–2 名目标运营人员在无开发协助下完成，记录真实中位耗时、误操作次数、问题分类理解偏差和主观可读性；达标后再决定是否扩大试点。
