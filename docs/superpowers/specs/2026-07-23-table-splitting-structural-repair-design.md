# 表格切分结构化修复设计

日期：2026-07-23
状态：已完成交互确认，待书面审阅

## 1. 背景

现有自动审核能够识别并呈现表格切分风险，但没有修复产生风险的底层算法。当前解析链路已经具备 Python/pdfplumber 表格抽取、TypeScript 坐标抽取、表头展开、续表识别和 RagTable 构造能力，但上游输出过早压平成字符串矩阵，后续只能根据空值、文本形态和相邻行猜测结构。

已确认的代表性问题包括：

- 正文或说明文字被误判成表格，阅读顺序被打乱；
- 换行内容跨越真实行边界，污染相邻记录；
- 合并单元格的父级值传播到错误行列范围；
- 跨页续表误合并、漏合并或丢失来源页映射。

本项目作为审核项目之后的独立项目，修复表格切分质量本身。审核侧继续作为风险呈现与人工复核工具，不参与解析修复决策。

## 2. 目标与非目标

### 2.1 首版目标

首版采用“代表性闭环”范围：

1. 修复阅读顺序与伪表格、行边界污染、合并单元格传播、跨页续表四类问题。
2. 为真实 PDF 页面建立精确到表、行、列、单元格、span 和来源位置的解析金标。
3. 保留 Python/pdfplumber 作为主抽取器，保留 TypeScript 坐标抽取器作为诊断与降级路径。
4. 新文档直接使用新算法；旧文档通过管理员显式重处理更新。
5. 重处理先预演并展示差异，质量门槛通过且管理员确认后才发布。
6. 保证现有正文解析、结构化对象、检索、数值问答和引用能力不回归。

### 2.2 非目标

- 不宣称所有 PDF 表格均已解决。
- 首版不融合 Python 与坐标抽取器的单元格结果。
- 不让 LLM 参与表格结构恢复或发布决策。
- 不在审核页面中直接编辑、修补或回写表格。
- 不自动批量重处理已有文档。
- 不借本项目重构无关的问答、权限或持久化模块。

## 3. 方案选择

采用“结构信息前移”方案。

Python 层输出原始单元格几何、行列槽位、span 和页面证据，不再只输出最终 `rows[][]`。TypeScript 层把这些证据规范化为统一的 `CanonicalTable`，再适配为现有 `TableModel`、KnowledgeObject、Chunk 和 RagTable。

未采用的方案：

- 双抽取器自动择优：两条路径都可能出错，现有文档级统计无法证明被选单元格正确。
- RagTable 后处理修补：坐标和边界已经丢失，只能针对文本结果猜测，容易形成样本补丁。

## 4. 总体架构

```text
PDF 原页
  → Python/pdfplumber 结构保真抽取
      ├─ 表格候选区域
      ├─ 单元格 bbox
      ├─ 物理行列槽位
      ├─ rowSpan / colSpan
      └─ 原始文字顺序与线框证据
  → TypeScript 规范化与结构修复
      ├─ 伪表格判定
      ├─ 行边界恢复
      ├─ 表头树与合并单元格传播
      ├─ 跨页续表合并
      └─ 结构校验与诊断
  → CanonicalTable
  → 现有 TableModel / KnowledgeObject / Chunk / RagTable
  → embedding 与持久化
```

新文档沿正常处理链路发布。旧文档沿独立的显式重处理链路执行：

```text
prepare
  → staging 中重建全部派生数据
  → 生成差异报告与质量门槛
  → 管理员确认
publish
  → 版本冲突检查
  → 可恢复提交
  → 原子切换内存状态
  → 持久化并复核
```

## 5. 数据契约

### 5.1 `RawTableV2`

Python 输出版本化契约。建议由 `scripts/extract_tables.py` 生成，并由 `lib/parse/tablesSidecar.ts` 校验。

```ts
interface RawTableV2 {
  schemaVersion: 2;
  page: number;
  bbox: [number, number, number, number];
  title?: string;
  extractionMethod: "lines" | "text";
  gridEvidence: {
    horizontalBoundaries: number[];
    verticalBoundaries: number[];
    lineCoverage: number;
  };
  cells: RawTableCell[];
  ignoredFragments: IgnoredFragment[];
  warnings: string[];
}

interface RawTableCell {
  text: string;
  bbox: [number, number, number, number];
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
  sourceOrder: number[];
}
```

`rowEnd` 和 `colEnd` 使用不包含上界的区间。`rowSpan`、`colSpan` 分别由 `rowEnd - rowStart`、`colEnd - colStart` 得到，避免同时保存两套可冲突信息。

所有进入表格候选区域但未映射到单元格的文字片段都必须进入 `ignoredFragments`，并记录明确原因，例如页眉、页脚、表题或允许忽略的装饰符号。不得静默丢弃。

### 5.2 `CanonicalTable`

`CanonicalTable` 是 TypeScript 规范化阶段的内部真值，不直接新增另一套持久化业务模型。

```ts
interface CanonicalTable {
  logicalTableId: string;
  title?: string;
  pageStart: number;
  pageEnd: number;
  columns: CanonicalColumn[];
  rows: CanonicalRow[];
  diagnostics: TableDiagnostics;
}

interface CanonicalColumn {
  index: number;
  name: string;
  headerPath: string[];
}

interface CanonicalRow {
  rowId: string;
  sourcePage: number;
  cells: CanonicalCell[];
}

interface CanonicalCell {
  value: string;
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
  sourcePage: number;
  sourceBBox: [number, number, number, number];
}
```

`CanonicalTable` 通过单一适配器生成现有 `TableModel`。下游不再各自重复推断表头、span 或续表关系。

## 6. 结构修复规则

### 6.1 伪表格与阅读顺序

只有满足以下任一结构证据的候选区域才建立表格：

1. 线框可以形成至少两行、两列且互不重叠的物理单元格；或
2. 无框表格至少具有三条物理行、两个稳定列锚点，且不少于 80% 的非标题行落入同一组列锚点。

不满足结构门槛的候选区域降级为按原始文字顺序重建的 paragraph/list block，不生成 TableModel 或 RagTable。第 31 页一类完整说明段落必须走该路径。

同一单元格内的文字按视觉行从上到下、同行从左到右排序。排序只作用于单元格内部，不允许跨单元格重排。

### 6.2 行边界恢复

- 有横向边界时，物理行由边界直接确定。
- 无框表格按文字基线聚类形成物理行；行内换行只有在落入同一列槽、与上一片段垂直间距不超过中位行高的 1.5 倍，且该高度范围内没有其他列的新行锚点时才合并。
- “首列为空”不能单独作为并入上一行的依据。
- 跨物理行传播必须存在明确 `rowSpan`，或由连续边框证明为同一跨行单元格。
- 每个规范化行保留自己的来源页和来源单元格集合。

### 6.3 合并单元格与表头树

- span 由单元格 bbox 覆盖的物理行列区间计算，不从 `null` 或空字符串猜测。
- 表头父值仅传播到其 `colStart..colEnd` 覆盖范围。
- 数据值仅在明确 `rowStart..rowEnd` 范围内继承。
- 删除无边界、无 span 证据的全局前向填充。
- 多层表头输出完整 `headerPath`；显示名使用最末级非空节点。
- 同一层中出现重叠 span、越界 span 或多个单元格占用同一槽位时，质量门槛失败，不发布该结果。

### 6.4 跨页续表

仅比较相邻页的候选表。满足显式“续表/接上表”标题时，仍必须通过列结构兼容检查；没有续表标题时，必须同时满足：

- 叶子列数一致；
- 归一化列边界差异不超过表宽的 3%；
- `headerPath` 指纹相似度不低于 0.8；
- 当前表不存在与前表冲突的独立标题。

列数或列宽不兼容时保持独立，覆盖现有“第 17 页宽表不得并入第 16 页窄表”的回归要求。

确认续表后：

- 使用相同 `logicalTableId`；
- 只剥离与前表 headerPath 归一化一致的重复表头；
- 每行继续保留真实来源页与 bbox；
- 页间说明、表注不作为数据行并入。

## 7. 质量门槛与降级

规范化结果必须同时满足：

- 每个有效源单元格恰好映射到一个规范化单元格；
- 每个被忽略的源片段都有允许的忽略原因；
- span 不重叠、不越界；
- 最终列与 `headerPath` 一一对应；
- 每个数据行至少保留一个可追溯的非空源单元格；
- 跨页合并后所有行仍有来源页和 bbox；
- 代表性解析金标全部通过。

失败处理：

- 新文档：表格候选降级为原页文本块并输出结构化 warning；不得生成看似规整但无法证明正确的 RagTable。
- 旧文档重处理：staging 状态变为 `blocked` 或 `failed`，当前已发布版本保持不变。
- Python 不可用：允许坐标抽取器作为降级路径，但其结果仍必须通过相同质量门槛。

## 8. 显式重处理

### 8.1 两阶段 API

建议增加：

```text
POST /api/documents/:id/reprocess/prepare
GET  /api/documents/:id/reprocess/:stagingId
POST /api/documents/:id/reprocess/:stagingId/publish
```

`prepare`：

1. 取得文档级处理锁，拒绝并发 process/reprocess。
2. 记录源文件 SHA-256、当前文档版本、Chunk/RagTable 数据哈希和 parserVersion。
3. 在 `.data/reprocess/<docId>/<stagingId>/` 中生成新 Block、Table、KnowledgeObject、Chunk、RagTable 和 embedding。
4. 运行结构金标、质量门槛和差异统计。
5. 返回 `ready | blocked | failed`，不改变当前检索数据。

差异报告至少包含：

- 表格、行、列、单元格数量变化；
- 单元格新增、删除、移动和内容变化；
- headerPath、span 和跨页逻辑表变化；
- warning 与低置信项变化；
- 文本覆盖率、重复率、来源定位完整率；
- Chunk、RagTable 和 embedding 预期变更数；
- 所有自动门槛及其原始计数。

`publish`：

1. 校验 stagingId、源文件哈希和基线数据哈希。
2. 若文档在 prepare 后被更新，返回 `conflict`，要求重新 prepare。
3. 在文档级锁内一次性替换该文档的内存 Chunk、RagTable 和 embedding 数据。
4. 使用可恢复提交日志持久化。
5. 重读并校验已发布哈希后标记 `published`。

同一个 stagingId 的 publish 必须幂等，不得生成第二个版本。

### 8.2 可恢复提交

当前数据分散在多份 JSON 文件中，无法依赖单个文件 rename 获得跨文件事务。因此发布前创建包含以下内容的提交日志：

- transactionId、docId、stagingId；
- 基线与目标哈希；
- 该文档旧 Chunk/RagTable 切片；
- 目标 Chunk/RagTable 切片；
- `prepared | applying | committed | rolled_back` 状态。

单个 JSON 文件仍通过临时文件加 rename 写入。进程若在多文件写入之间中断，下次初始化先检查提交日志：

- 所有目标哈希已匹配：完成 commit；
- 目标状态不完整：恢复旧切片并标记 rolled_back；
- 不允许在恢复完成前对该文档提供混合版本。

成功后保留差异报告、manifest 和最终哈希作为审计证据，删除可重建的 staging 大文件。

## 9. 真实解析金标

新增独立于自动审核金标的 `table-parsing-gold-v1`。它直接声明正确结构，而不是只标记风险类型。

### 9.1 阅读顺序与伪表格

- 《北京市居住公共服务设施配置指标京政发〔2025〕25号》，第 31 页；
- 《北京市控制性详细规划编制技术标准与成果规范》，第 30 页。

验收：说明段落按原顺序保留，不生成伪 RagTable，不丢失句子。

### 9.2 行边界

- 《北京市居住公共服务设施配置指标京政发〔2025〕25号》，第 42 页；
- 《北京市控制性详细规划编制技术标准与成果规范》，第 29 页。

验收：逐行、逐列矩阵与人工金标完全一致，换行只进入原单元格。

### 9.3 合并单元格

- 《全-规划综合实施方案指南2022.12 最终最新》，第 14 页。

覆盖现有 6 个明确 `merged_cell_scope_error`。验收 rowSpan、colSpan、headerPath 和值继承范围。

### 9.4 跨页续表

- 《北京市城乡规划用地分类标准》，第 17–18 页；
- 保留现有真实 PDF 第 16–18 页续表与错合并回归。

验收应合并的页面共享 logicalTableId，结构不兼容的相邻表保持独立。

每组金标必须包含同页或相邻页困难负例，防止通过扩大表格区域、盲目前向填充或宽松续表匹配来换取表面通过。

## 10. 测试与验收

### 10.1 TDD 层级

1. Python 契约测试：单元格 bbox、槽位和 span 输出。
2. TypeScript 纯函数测试：候选门槛、行边界、span 校验、headerPath、续表判定。
3. 真实 PDF 金标测试：四组代表性页面。
4. 重处理服务测试：prepare、blocked、conflict、publish、幂等和恢复。
5. 端到端测试：一个真实旧文档完成 prepare → diff → publish → 问答验证。

### 10.2 必须通过

- 四组代表性金标中的表、行、列、单元格值、span、headerPath 和来源映射 100% 匹配；
- 四类已知严重错误在新解析结果中为 0；
- 困难负例不新增伪表格、误合并、内容复制或内容丢失；
- 现有 table/parse/RAG 测试和完整测试套件通过；
- `tsc --noEmit`、build、`git diff --check` 通过；
- 现有真实 PDF 数值问答和引用断言不下降；
- prepare 不改变当前 `.data` 检索数据；
- publish 后 Chunk 与 RagTable parserVersion 和目标哈希一致；
- 抽取失败、质量阻断、版本冲突、持久化中断均有自动测试。

### 10.3 完成定义

只有四组解析金标全部通过、困难负例无回归、一次真实旧文档显式重处理闭环成功，才能声明：

> 代表性表格切分问题已修复。

不得表述为“所有 PDF 表格切分问题已解决”。

## 11. 预计修改边界

主要涉及：

- `scripts/extract_tables.py`
- `lib/parse/tablesSidecar.ts`
- `lib/rag/tableModel.ts`
- `lib/rag/tables/*`
- `lib/rag/ragTable.ts`
- 文档重处理服务与受保护 API
- 表格解析金标、真实 PDF 回归与重处理测试

现有自动审核 Provider、审核排序、人工复审和问答生成逻辑不在本项目修改范围内；它们只消费新解析结果。
