# AI 工作流审计实施计划

依据：`docs/superpowers/specs/2026-07-14-workflow-audit-design.md`

## 交付边界

- 升级 `/debug` 为管理员/开发专用工作流审计页。
- 新查询通过 SSE 展示真实步骤事件并保存历史。
- 文档处理保存 ingestion trace；旧文档按当前数据生成回溯链。
- 不保存原始向量、完整系统提示词或无权正文。
- 保持 `/api/chat` 与现有问答调用兼容。

## Task 1：Trace 领域模型与状态机

1. 在 `tests/workflowTrace.test.ts` 写失败测试：步骤骨架、状态推进、阻断后跳过、摘要截断和敏感字段移除。
2. 运行单测确认因缺少模块失败。
3. 最小实现 `lib/workflow/types.ts`、`lib/workflow/trace.ts`。
4. 运行单测与完整测试。

## Task 2：持久化、查询与历史回溯

1. 写失败测试：保存/列出/读取 trace，按文档关联最近 ingestion trace，旧文档生成 `reconstructed` 步骤且不虚构耗时。
2. 最小实现 `lib/db/workflowTraces.ts`，使用独立 `.data/workflow-traces.json` 原子写入。
3. 增加服务端角色校验辅助函数。
4. 运行相关测试与完整测试。

## Task 3：查询链埋点与 SSE API

1. 写失败测试：正常、注入阻断、范围外、权限拒答、证据不足和答案反思路径产生正确步骤终态。
2. 给 `generateAnswer` 与 `retrieve` 增加可选 recorder，不传时行为不变。
3. 新增 `POST /api/workflow-traces/query` SSE 接口以及历史列表/详情接口。
4. 运行相关测试、类型检查与完整测试。

## Task 4：文档处理链埋点

1. 写失败测试：处理成功记录解析、对象/切块、embedding、持久化指标；失败保留已完成步骤。
2. 给文档处理路由与 `processDocument` 增加可选 recorder。
3. 处理接口返回 `traceId`，并把 ingestion trace 与文档 ID 关联。
4. 运行相关测试与完整测试。

## Task 5：工作流审计界面

1. 写组件数据转换失败测试：运行列表摘要、时间线分组、状态颜色和详情数据。
2. 新增 `WorkflowAuditPanel` 及小型展示组件，复用现有 UI primitives。
3. 将 `/debug` 标题与内容升级为工作流审计，保留管理员/开发权限门。
4. 实现新审计 SSE、实时点亮、历史回放、步骤选择和回溯/截断警告。
5. 运行 UI 辅助测试、类型检查与构建。

## Task 6：验收与审查

1. `npm.cmd test`
2. `npx.cmd tsc --noEmit`
3. `npm.cmd run build`
4. 本地启动后验证 `/debug`、历史 API、正常查询与提示注入阻断。
5. 对照设计文档逐项审查 diff；修复重要问题后复跑全部校验。
