# P2：从 PDF 坐标层重构表格抽取（纯 TypeScript）

> 交给执行 agent 的自包含任务书。你**没有**本项目的历史对话上下文，本文给出全部必要信息。
> 仓库根目录：`D:\OPC\问答`（Next.js 14 + TypeScript）。Windows，`py` = Python 3.12。

---

## 0. 一句话目标

**新增一条纯 Node/TS 的表格抽取链路**：直接从 PDF 的坐标级 text items 检测表格区域、重建单元格网格、产出与现有 Python sidecar **同形状**的结果，从而让表格抽取**不再依赖 Python**，也不再从"压平成 `\t`/`[[T]]` 的行文本"反推表格。

**关键约束：P2 只替换"从 PDF 到单元格矩阵"这一段。** 下游（TableModel 合并、RagTable 合成、检索、切片、渲染、置信度、debug、overlay）**已经全部做好且必须复用**，不要重写。

---

## 1. 现状（必读，决定接入方式）

### 1.1 已完成、必须复用的下游
当前系统已实现完整的"表格 RAG 闭环"（P0/P1/P3 已交付）：

| 能力 | 文件 | 复用方式 |
|---|---|---|
| 单元格矩阵 → TableModel（多行表头合并、合并单元格前向填充、rowKey） | `lib/rag/tableModel.ts` → `buildTableModelFromMatrix(matrix, opts)` | **直接调用** |
| TableModel → Block[]（table + 每行 table_row） | `lib/parse/tablesSidecar.ts` → `tablesToBlocks(rawTables)`、`groupTables`（含续表 fingerprint 合并） | **直接调用** |
| Block[] → 带类型 chunk | `lib/rag/chunk.ts` → `buildChunks` | 已接好 |
| chunk → RagTable 一级对象（tableType 分类、列 flatten、rowKey、告警、code 续写归并、页码残片清理） | `lib/rag/ragTable.ts` → `buildRagTablesFromChunks`、`classifyTableType` | 已接好 |
| 表格置信度评分（判真假表，替代旧的一票否决） | `lib/rag/tableConfidence.ts` → `scoreTableRegion`、`shouldKeepAsTable` | **复用判据** |
| 检索命中 → TableSlice → 真实表格展示 | `lib/rag/tableSlice.ts`、`lib/rag/tableAssembly.ts`、`components/StructuredTableBlock.tsx` | 不动 |
| debug 导出 / overlay 可视化 | `app/api/debug/tables`、`app/api/debug/overlay`、`scripts/overlay_tables.py` | 用于验证 |

### 1.2 现有的两条 PDF→表格链路
入口：`lib/parse/tablesSidecar.ts` 的 `extractBlocksWithTables(buffer): Promise<Block[]>`（被 `app/api/documents/[id]/process/route.ts` 调用）。它当前：
1. `extractBlocks(buffer)`（`lib/parse/ir.ts`）：纯几何 IR，把 pdfjs 文本**压平成行 + `\t` + `[[T]]`**再猜表格 → 质量差，是**回退**。
2. `extractTablesViaPython(buffer)`：spawn `scripts/extract_tables.py`（pdfplumber 抽单元格矩阵）→ `RawTable[]` → `tablesToBlocks` → 与几何块按页合并。**当前主力**。

**P2 要新增第 3 条**：`extractTablesFromCoords(buffer): Promise<RawTable[]>`（纯 TS，坐标级），与 Python 输出同形状，可直接喂 `tablesToBlocks`。

### 1.3 坐标在哪、为什么现在拿不到
`lib/parse/extractText.ts` 的 `extractPdfPages` 用 `pdfjs-dist/legacy` 拿到每页 `textContent.items`（每个 item 有 `.str`、`.transform`=[a,b,c,d,e,f] 仿射矩阵、`.width`、`.height`），但 `reconstructPageLines` **把坐标用完就丢了**，只返回 `string[]`。

⚠️ **政府 PDF 常用旋转坐标系**（整页 transform 的 b/c 非 0，如 b=14.749,c=-14.749）。`extractText.ts` 里已有处理逻辑必须复用/抽取：
- `computePageParams(rawItems)` → `{dominantB, dominantC, avgH}`（页面主方向 + 平均字高）。
- `isWatermark(item, dominantB, dominantC, avgH)` → 过滤水印/旋转盖章。
- `detectColumns(items, avgH)`、`findColIndex` → 列边界频率聚类（可作 GridBuilder 列聚类的起点）。

**建议**：把这些纯函数从 `extractText.ts` 抽到一个共享模块 `lib/parse/pdfItems.ts`，供 P2 与现有重建共用，避免复制。

---

## 2. 非目标（不要做）

- ❌ 不要改下游（RagTable/检索/切片/渲染/置信度）。
- ❌ 不要删除或破坏 Python sidecar（P3）与几何 IR（回退）。P2 与它们**并存**，由 `extractBlocksWithTables` 路由。
- ❌ 不要针对具体文件名写死规则（按结构识别）。
- ❌ 不要做 OCR/扫描页（那是 P3，已有；扫描页继续走 Python sidecar 的 OCR 分支）。

---

## 3. 要新增的模块与接口

> 接口可按需微调，但**输出必须能喂进 `buildTableModelFromMatrix` / `tablesToBlocks`**。推荐让 GridBuilder 产出 `(string|null)[][]` 单元格矩阵（合并单元格用 `null`，与 pdfplumber 一致 → 前向填充复用现有逻辑）。

### 3.1 坐标提取：`lib/parse/pdfItems.ts`（新）
```ts
export interface PdfTextItem {
  text: string;
  x: number;      // 左下角 x（页面主坐标系，已校正旋转）
  y: number;      // 基线 y（自页面上沿，越大越靠下；或统一约定并在全模块一致）
  width: number;
  height: number; // 字高
  fontSize?: number;
  pageNumber: number;
}
export async function extractPageItems(buffer: Buffer): Promise<PdfTextItem[][]>; // 每页一组，已过滤水印、已按主方向校正
```
- 复用 `computePageParams` / `isWatermark`。
- 旋转页：把 item 坐标投影到页面主方向，使后续聚类在"正"的坐标系里做。
- 纯页码行/页眉页脚**不在这里删**（交给 region/grid 阶段或复用 `lib/rag/clean.ts` 思路），但要保证页码残片不进单元格（见 §4.4）。

### 3.2 `lib/parse/tableRegionDetector.ts`（新）
```ts
export interface TableRegion {
  regionId: string;
  pageNumber: number;
  bbox: [number, number, number, number]; // x0,y0,x1,y1
  tableTitle?: string;
  isContinuation?: boolean;
  confidence: number;
  reasons: string[];
}
export function detectTableRegions(items: PdfTextItem[], pageNumber: number): TableRegion[];
```
职责：判断**哪些区域是表格**（不解析 cell、不展开 row、**不依赖 `\t`**）。
检测依据（综合打分，非单条否决）：
1. 表题模式：`/^\s*(续表|表)\s*\d+([—\-.．]\d+)*/`、`/.*表$/`，附近出现"指标表/配置要求表/分类和代码/成果要求/图纸目录"等信号。
2. **稳定 x 对齐簇**：连续多行的 item.x 落在同一组列边界上（频率聚类，参考 `detectColumns`）。
3. 局部二维排列密度明显高于普通段落。
4. 若 pdfjs 能读出 rect/line（`getOperatorList` 里的矩形/描边）→ **优先用线条边界**界定 region。
5. **不要**用"数字单元格比例"作为通用判据（会误杀配置要求表/成果表）。
回退为非表只在 §`tableConfidence.shouldKeepAsTable` 同款判据下（分极低 + 无 tableType 信号 + 无稳定二维结构）。

### 3.3 `lib/parse/tableGridBuilder.ts`（新，核心难点）
```ts
export interface TableGrid {
  region: TableRegion;
  /** (string|null)[][]，合并单元格=null，可直接喂 buildTableModelFromMatrix */
  matrix: (string | null)[][];
  warnings: string[];
  // 可选：保留 cell bbox 供 overlay/debug
  cellBBoxes?: ([number, number, number, number] | null)[][];
}
export function buildTableGrid(region: TableRegion, items: PdfTextItem[]): TableGrid;
```
职责（必须处理）：
- **列边界聚类**：用 region 内 item.x 起止做一维聚类，得到列分隔线。
- **行边界聚类**：用 item.y 聚类成行；注意**单元格内多行文本**（同一逻辑行跨多个 y）要合并。
- **item → cell 分配**：按列/行边界归位；同 cell 多 item 合并文本（处理断字、空格、换行）。
- **合并单元格**：纵向合并 → 下方行该列 `null`（让现有前向填充处理）；横向合并 → 该 cell 占多列（先简化为内容放首列、其余 null，或记录 colspan 到 warnings）。
- **左侧分类列向下填充**：输出 `null`，交给 `buildTableModelFromMatrix` 的前向填充（已实现）。
- **多级表头**：保留前导多行表头（`buildTableModelFromMatrix` 会 `detectHeaderRowCount` + `mergeHeaderRows` 合并）。
- **删除混入表格区的页码/页眉页脚/水印**（见 §4.4）。
- 表中夹杂"注/备注/小计"行：保留（下游 `classifyRowType` 已能标 summary/note）。
warnings 词表与现有一致，至少：`duplicate_headers / missing_headers / rowspan_filled / colspan_merged / page_footer_removed / row_key_missing / too_many_empty_cells / long_text_cell / low_confidence`。

### 3.4 语义解析：**大部分复用，不要重写**
原始需求里的 "TableSemanticParser"（tableType 判定、表头 flatten、rowKey、续表合并、注/小计）**已在下游实现**：
- `buildTableModelFromMatrix`：表头检测/合并/前向填充。
- `lib/rag/ragTable.ts`：`classifyTableType`、列 flatten（headerPath/unit/canonicalName/唯一化）、rowKey、rowType、告警、code 续写归并。
- `tablesSidecar.groupTables`：续表 `headerFingerprint` 合并（`lib/parse/headerFingerprint.ts`）。

所以 P2 的"SemanticParser"= 把 `TableGrid.matrix` 交给现有链路即可。**新代码只需 §3.1–3.3。**

### 3.5 顶层桥接：`lib/parse/coordTables.ts`（新）
```ts
import type { RawTable } from "./tablesSidecar"; // 需把 RawTable 导出
export async function extractTablesFromCoords(buffer: Buffer): Promise<RawTable[]>;
// 流程：extractPageItems → 每页 detectTableRegions → buildTableGrid →
//       { page, bbox, title, rows: grid.matrix } 即 RawTable
```
`RawTable` 形状（见 `tablesSidecar.ts`，需 `export`）：
```ts
interface RawTable { page:number; bbox:number[]|null; title:string|null; rows:(string|null)[][]; scanned?:boolean; ocrText?:string }
```

### 3.6 路由：改 `extractBlocksWithTables`
在 `tablesSidecar.ts` 顶层按开关选择抽取器，**保持回退**：
```ts
// 优先级：env TABLE_EXTRACTOR = "coords" | "python" | "auto"(默认)
// auto：先试 coords(P2)，每页 region 置信度低/无表的页再用 python 补，或反之。
// 任一不可用都回退几何 IR。三者输出统一是 RawTable[] → tablesToBlocks。
```
默认建议 `auto`，但**先实现 `coords` 单独可用并通过验收**，再做融合。

---

## 4. 关键实现细节与坑（务必看）

1. **旋转坐标系**：必须先用 `computePageParams` 求主方向，把 item 投影到主坐标系再聚类。直接用 raw transform[4]/[5] 会错列。
2. **pdfjs item 合并**：`getTextContent({ disableCombineTextItems:false })` 已做基本合并，但中文逐字 PDF 仍可能一字一 item；列聚类要对"字"级 x 鲁棒。
3. **列聚类容差**：参考 `extractText.ts` 的 `BUCKET=max(avgH*0.5,4)`、`COL_TOL=20`。窄数字列换行（如 `1400`/`1200` 竖排）参考 `mergeNumberFragments` 的思路，别把跨行数字拼成 `140120`。
4. **页码残片**：`isPageFragment`（在 `lib/rag/ragTable.ts` 已导出）判 `— 15 —`、`— 5 1 —`，且不误删 `40-50`。GridBuilder 落格前过滤这类 item。页眉页脚跨页重复过滤参考 `lib/rag/clean.ts`。
5. **置信度回退**：是否当表用 `tableConfidence.scoreTableRegion(cellRows)` + `shouldKeepAsTable`（已实现，输入 `string[][]`）。
6. **续表**：跨页同 fingerprint 合并已在 `groupTables` 做；P2 只要保证每页输出独立 RawTable，合并交给它。
7. **不要破坏现有路径**：Python sidecar、几何 IR 都要能继续工作（环境无 Node 坐标能力/解析失败时回退）。

---

## 5. 验收标准

### 5.1 功能（端到端，对真实 PDF）
原始文件在 `.data/raw/`（无扩展名，按 docId 命名；其中 `doc-1780538182452-zox295` 是"居住公共服务设施配置指标"，含指标表/要求表；`doc-1780538182607-...` 是用地分类代码表）。设 `TABLE_EXTRACTOR=coords` 后：
1. 用户问某设施（如"物业服务用房的建筑面积"）→ 命中大表对应行 → 以**真实表格**展示该行（cells 来自 RagTable，非 LLM 手写）。
2. 多设施 → 同一张表截多行合并为一个表。
3. 代码查询（A21）→ 从代码表截对应行。
4. 多级表头不出现重复列名（`建筑面积/建筑面积` 必须带上级 → `一般规模-建筑面积`/`千人指标-建筑面积`）。
5. 配置要求表（数字少、长文本）不被误判为段落。
6. 页码残片、页眉页脚不进 cell。

### 5.2 与 pdfplumber 基线对比（量化）
P2 产出的单元格矩阵质量应**不低于** Python sidecar。写一个对比脚本：对 `.data/raw/*` 跑 coords 与 python 两路，对每张表算：
- 表数、行数、有效列数（≥2 个非空单元格的列）、空单元格率、`missing_headers` 告警率。
- 目标：**有效列数 ≥ pdfplumber，空单元格率不显著更高，错列（人工抽查 overlay）更少或相当**。

### 5.3 可视化核查
复用 overlay：`POST /api/debug/overlay {docId}` 现在画的是 pdfplumber 检测框。**新增** P2 自己的 overlay（用 `cellBBoxes` 画 TS 检测出的网格），人工对 3–5 页（含多级表头页、配置要求页、代码表页）核对是否错列。

### 5.4 单元测试（必须）
测试运行方式（无 jest，用 Node 原生类型擦除）：
- 测试放 `tests/*.test.ts`，在 `tests/index.ts` 里 `import "./xxx.test.ts"`。
- 跑：`npm test`（= `node --experimental-strip-types tests/index.ts`）。
- ⚠️ 被测模块若 `import` 了 `@/...` 的**值导入**，node 无法解析路径 → 测试会失败。所以：**把 P2 的纯函数（列聚类、行聚类、region 打分、item→cell）写成只 `import type` 的纯模块**，或用相对路径导入。参考现有 `tests/tableConfidence.test.ts`、`tests/p1Parse.test.ts`、`lib/parse/headerFingerprint.ts`（纯函数无依赖，可被测）。
至少覆盖：
- 列聚类：给定一组 PdfTextItem，得到正确列边界（含旋转页 fixture）。
- 行聚类 + 多行单元格合并。
- region 检测：指标表/要求表/代码表 → 命中；普通段落/目录 → 不命中。
- 合并单元格 → `null` 输出，前向填充后正确。
- 页码残片不进 cell。
- 端到端：一组 fixture items → `extractTablesFromCoords` 风格函数 → 矩阵正确。

### 5.5 不回归
- `npm test` 全绿（现有 10 个测试 + 新增）。
- `npx tsc --noEmit` 干净。
- `TABLE_EXTRACTOR` 未设/设为 `python` 时，行为与现在完全一致。

---

## 6. 增量实施顺序（不要一次性大改）

1. **抽共享坐标工具**：从 `extractText.ts` 提取 `computePageParams/isWatermark/detectColumns` 到 `lib/parse/pdfItems.ts`，加 `extractPageItems`（含旋转校正）。加单测（列聚类）。
2. **TableRegionDetector**：region 检测 + 打分。单测。
3. **TableGridBuilder**：item→cell→矩阵（先不处理 colspan，纵向合并用 null）。单测。
4. **coordTables 桥接** → `RawTable[]`，喂现有 `tablesToBlocks`。
5. **路由开关** `TABLE_EXTRACTOR`，默认仍 `python`；用 `coords` 跑 `.data/raw/*` 做 §5.2 对比 + overlay 核查。
6. 调参达标后，再考虑 `auto` 融合（coords 为主、python 补漏）。
7. 文档：更新 `scripts/`/README 说明，写清开关与回退。

---

## 7. 运行 & 验证速查

```bash
# 类型检查
npx tsc --noEmit
# 单测
npm test
# 起服务（端口 3100；若占用先 netstat -ano | findstr :3100 然后 taskkill /F /PID <pid>）
npm run dev
# 重新解析某文档（应用新抽取器）
curl -X POST http://localhost:3100/api/documents/<docId>/process
# 导出表格 debug（json/html/txt + 告警汇总；会 rebuild）
curl -X POST http://localhost:3100/api/debug/tables
# 生成 overlay 截图（人工核对错列）
curl -X POST http://localhost:3100/api/debug/overlay -H "Content-Type: application/json" -d "{\"docId\":\"<docId>\"}"
# 问答（看 answerBlocks 里的 table_slice）
curl -X POST http://localhost:3100/api/chat -H "Content-Type: application/json" -d "{\"question\":\"物业服务用房的建筑面积指标是多少？\",\"city\":\"北京\"}"
```

> 数据坑提醒：检索"漏答/答错"先查文档 `enabled` 状态（`.data/documents.json`，会被外部重新上传覆盖成多数禁用）。用 `PATCH /api/documents/<id> {"enabled":true}` 修复，不是代码问题。

---

## 8. 交付物清单

- 新增：`lib/parse/pdfItems.ts`、`lib/parse/tableRegionDetector.ts`、`lib/parse/tableGridBuilder.ts`、`lib/parse/coordTables.ts`。
- 改动：`lib/parse/extractText.ts`（抽公共函数）、`lib/parse/tablesSidecar.ts`（`export RawTable`、`extractBlocksWithTables` 加路由）、`lib/parse/ir.ts`（必要时共享坐标工具）。
- 测试：`tests/coordTables.test.ts` 等 + 注册到 `tests/index.ts`。
- 可选：P2 overlay（在 `scripts/overlay_tables.py` 之外，用 TS 的 cellBBoxes 出一版）。
- 不动：`lib/rag/*`（tableModel 除外仅调用）、`components/*`、检索与切片层。
```
```
