# MinerU 解析器接口预留设计

日期：2026-09-02

## 背景

当前 PDF 摄取和表格重处理直接调用 `extractBlocksWithTables`。如果后续接入 MinerU，直接替换该函数会让外部服务的响应结构、超时和失败语义渗入现有摄取链路，也会增加 Demo 环境对 Python、Docker 或 GPU 的依赖。

本次仅建立稳定的文档解析边界，并以现有解析器作为唯一可运行实现。MinerU 的服务部署、HTTP 调用和结果归一化留到确有复杂 PDF 展示需求时再实施。

## 目标

- 为 PDF 解析建立统一的 `DocumentParser` 契约。
- 将现有 `extractBlocksWithTables` 封装为 `native` 适配器。
- 通过单一入口选择解析器，默认行为与当前版本一致。
- 在类型和配置层预留 `mineru` 后端名称，但不建立外部网络连接。
- 保持现有 `Block[]`、`TableModel`、`processDocument`、RagTable 和 RAG 链路不变。
- 为后续 MinerU HTTP 适配器提供可测试的注入点。

## 非目标

- 不安装或启动 MinerU、Python、Docker、WSL 或 GPU 环境。
- 不实现 `/file_parse` HTTP 客户端。
- 不解析 MinerU 的 `content_list` 或表格 HTML。
- 不增加生产依赖。
- 不改变非 PDF 文档的文本提取路径。
- 不实现自动路由、A/B 对比或解析质量评估。

## 设计

### 统一契约

解析层接收文档内容和必要上下文，返回现有领域模型：

```ts
export type DocumentParserBackend = "native" | "mineru";

export interface ParseDocumentInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

export interface ParseDocumentResult {
  blocks: Block[];
  backend: DocumentParserBackend;
}

export interface DocumentParser {
  readonly backend: DocumentParserBackend;
  parse(input: ParseDocumentInput): Promise<ParseDocumentResult>;
}
```

`Block[]` 是解析层唯一向下游暴露的内容结构。未来 MinerU 的字段、页码规则和表格 HTML 只能在适配器内部转换，不能传给摄取、切块或检索代码。

### Native 适配器

`nativeDocumentParser` 调用现有 `extractBlocksWithTables(input.buffer)`，并返回：

```ts
{
  blocks,
  backend: "native"
}
```

适配器不改变当前 PDF.js 文本与表格提取行为。

### 解析入口与配置

新增 `parseDocument(input, options?)` 作为唯一入口。默认从 `DOCUMENT_PARSER` 读取后端，未配置时使用 `native`。

本阶段允许的运行值只有：

- 未设置或 `native`：调用 Native 适配器。
- `mineru`：抛出明确的 `DocumentParserUnavailableError`，说明 MinerU 适配器尚未配置。
- 其他值：抛出 `DocumentParserConfigurationError`，避免拼写错误被静默忽略。

测试可以通过 `options.parser` 注入假解析器，不需要修改全局环境变量，也不需要启动外部服务。

### 调用链调整

PDF 初次摄取由：

```text
process route -> extractBlocksWithTables -> processDocument
```

调整为：

```text
process route -> parseDocument -> Block[] -> processDocument
```

表格重处理中的 PDF 重新解析也通过同一入口，避免形成第二条绕过解析器抽象的路径。非 PDF 文档继续使用现有 `extractText`。

### 审计信息

解析结果携带实际使用的 `backend`。调用方把该值写入现有摄取审计诊断；若现有审计类型不支持独立字段，则只做最小类型扩展，不改变历史记录的解释方式。

本阶段不会发生自动回退，因此审计中不引入虚假的 fallback 状态。

## 错误处理

- Native 解析器错误保持原有失败语义并向上抛出。
- 选择 `mineru` 时明确失败，不伪造结果，也不静默使用 Native。
- 配置错误与解析执行错误使用不同错误类型，方便未来决定哪些错误允许回退。

## 测试

- 默认配置选择 Native 解析器。
- 显式 `native` 选择 Native 解析器。
- 未实现的 `mineru` 返回可识别的 unavailable 错误。
- 未知后端返回配置错误。
- 注入假解析器时返回统一的 `ParseDocumentResult`。
- PDF 摄取和表格重处理相关测试继续通过。
- 运行最小相关测试、TypeScript 检查和生产构建。

## 后续接入 MinerU

如果 Demo 后续必须展示扫描 PDF、复杂表格或公式解析，再单独增加：

1. `mineruDocumentParser` HTTP 适配器；
2. `/file_parse` 请求、超时和可选鉴权；
3. `content_list` 到 `Block[]` 的归一化；
4. 表格 HTML 到矩阵及 `buildTableModelFromMatrix` 的转换；
5. 明确的服务错误回退策略与审计字段；
6. 使用真实 MinerU 服务的冒烟测试。

该阶段不会要求修改 `processDocument` 或下游 RAG 数据结构。

## 风险与控制

- **抽象过度**：只增加一个契约、一个 Native 适配器和一个路由入口，不引入注册中心或插件框架。
- **行为回归**：Native 适配器直接复用当前函数，并以现有测试和构建验证。
- **配置误导**：`mineru` 未实现时明确失败；文档不会宣称已经完成真实 MinerU 接入。
- **Demo 稳定性**：默认配置保持 `native`，不依赖外部服务。
