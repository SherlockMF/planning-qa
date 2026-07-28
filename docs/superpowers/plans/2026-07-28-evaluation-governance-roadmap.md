# Evaluation Governance Roadmap (P0–P2)

日期：2026-07-28  
状态：P0 / P1 已完成；P2 待执行

## 背景

`/lab` 产品壳已拆出。现有评测（`/lab/evaluation`）会真实调用 `generateAnswer`，并有 Top5 / 引用 / 拒答 / 权限 / 表格数值等企业知识指标，但结果覆盖写入 `.data/evaluation.json`，缺少不可变批次、状态四分法、可比性门禁与审计联动。

参考：`D:\OPC\skill_lingshi` 的 EvalBatch / PASS·FAIL·REVIEW·ERROR / 快照比较。

## 原则

- 保留现有领域指标与权限场景题，不替换成通用关键词评分。
- 跑测必须真实调用问答链路；不引入 LLM-as-Judge 作为 P0/P1 依赖。
- 分阶段各自可交付、可测试；后一阶段依赖前一阶段产物。
- 不改问答主链路答案语义；评测治理变更不得污染生产问答结果。

## 阶段索引

| 阶段 | 计划文件 | 目标一句话 |
|------|----------|------------|
| P0 | [evaluation-governance-p0.md](./2026-07-28-evaluation-governance-p0.md) | runId→审计、状态四分法、人工复核可审计 |
| P1 | [evaluation-governance-p1.md](./2026-07-28-evaluation-governance-p1.md) | 不可变批次、异步跑批、可比回归 |
| P2 | [evaluation-governance-p2.md](./2026-07-28-evaluation-governance-p2.md) | 失败聚类、发布门槛、坏例入库、概览趋势 |

## 明确不做（全阶段）

- 不拆独立评测服务 / monorepo
- 不把文档解析审核台迁出文档管理
- 不以覆盖式 `evaluation.json` 历史结果冒充批次趋势
