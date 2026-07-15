# AI 工作流审计台易读性改版实施计划

日期：2026-07-15
依据：`docs/superpowers/specs/2026-07-15-workflow-audit-clarity-design.md`

## 成功标准

- 四张业务阶段卡片覆盖 18 个既有步骤，默认展开，失败或拦截阶段保持展开。
- 每一步始终显示固定中文解释、中文状态和本次业务结果，不在主界面显示英文 outcome。
- 多文档问答通过选择器一次查看一份文档处理链，问题链保持不变。
- “历史重建”统一改为“历史回溯（非当时日志）”，历史耗时显示“历史数据无法确认”。
- 详情区先说明“做什么、为什么、结果怎么看”，原始指标与 JSON 默认折叠。
- 不修改审计采集、检索、权限、回答生成和持久化逻辑。

## 实施步骤

1. 扩展 `tests/workflowPresentation.test.ts`，覆盖阶段映射、18 步解释、业务结果、历史回溯和单文档时间线选择；先运行并确认新测试因缺少展示 API 失败。
2. 在 `lib/workflow/presentation.ts` 中实现最小展示词典和纯函数，使展示测试通过。
3. 改造 `components/WorkflowAuditPanel.tsx`：文档选择器、四阶段卡片、固定说明、业务结果、历史提示、业务详情和折叠技术明细。
4. 运行工作流展示测试与完整测试，修复本次改造造成的回归。
5. 运行 `npx.cmd tsc --noEmit` 与 `npm.cmd run build`。
6. 启动本地服务，在桌面和窄屏验收正常记录、历史回溯、多文档切换及阻断状态。

## 变更边界

- 允许修改：`lib/workflow/presentation.ts`、`components/WorkflowAuditPanel.tsx`、`tests/workflowPresentation.test.ts`、必要的测试入口。
- 不修改：API 协议、`WorkflowTrace` 数据结构、RAG 与权限逻辑、数据库格式。
