# 控规 / 国土空间规划法规智能问答助手（MVP）

面向控规 / 国土空间规划编制人员的法规条文快查工具。用户上传少量规划法规文档后，
可用自然语言提问；系统从知识库检索相关条文，并生成**带来源、页码、章节、条款依据**的回答。

## 核心原则

1. **只基于知识库回答**；
2. **有明确依据才回答**；
3. **没有明确依据必须拒答**；
4. **不编造**法规、条款、页码、指标数值；
5. MVP 只做法规条文查询，**不做**规划条件审查、指标组合可行性判断、审批结论认定。

## 技术栈

- Next.js 14（App Router）+ TypeScript
- Tailwind CSS + shadcn/ui 风格组件
- Node.js API Routes
- **可替换**的 LLM 调用层（`lib/ai/llm.ts`）
- **可替换**的 Embedding 调用层（`lib/ai/embedding.ts`）
- 数据存储：内存单例（MVP），接口与 Supabase / PostgreSQL + pgvector 对齐，便于替换

> 未配置真实服务时，默认使用内置 **mock Embedding**（确定性伪向量）与 **mock 抽取式 LLM**
> （只复述检索片段原文、绝不编造），即可完整跑通主链路。

## 快速开始

```bash
npm install
npm run dev          # 默认 http://localhost:3000
```

构建与生产运行：

```bash
npm run build
npm run start
```

## 页面

| 路径          | 用途       | 说明                                                         |
| ------------- | ---------- | ------------------------------------------------------------ |
| `/`           | 问答页     | 自然语言提问，返回结论 + 依据卡片 + 注意；无依据则拒答        |
| `/documents`  | 文档管理   | 上传 / 列表 / 删除 / 重新解析 / 切换是否参与检索 / 处理状态   |
| `/debug`      | 检索调试   | 查看关键词检索、向量检索、合并 Top5 及各项得分               |
| `/evaluation` | 评测       | 对题库逐题真实运行问答链路并据实回填结果与统计               |

## API

| 方法 | 路径                            | 说明                               |
| ---- | ------------------------------- | ---------------------------------- |
| POST | `/api/chat`                     | 问答主链路                         |
| GET  | `/api/documents`                | 文档列表                           |
| POST | `/api/documents/upload`         | 上传文档（multipart/form-data）    |
| POST | `/api/documents/:id/process`    | 解析、切片、生成 embedding、入库   |
| PATCH/DELETE | `/api/documents/:id`    | 切换参与检索 / 删除                |
| POST | `/api/retrieve-debug`           | 检索调试结果                       |
| GET / POST | `/api/evaluation`         | 读取题库 / 保存题库 / `{action:"run"}` 运行评测 |

## RAG 链路

```
问题
 → 检索前范围判断（refusal.checkScope，超出 MVP 范围直接拒答）
 → 提取关键词（用地代码 / 指标 / 数值 / 条款号 / 术语）
 → 关键词检索 + 向量检索（retrieve.ts）
 → 合并 + 重排序（rerank.ts：关键词命中 / 语义 / 城市 / 数值 / 用地类型 / 结构）
 → 检索后依据判断（refusal.checkEvidence：空结果 / 相关度低 / 缺对应用地 / 缺数值 → 拒答）
 → LLM 抽取式生成结论（generateAnswer.ts，仅基于传入 chunks）
 → 按【结论】/【依据】/【注意】模板拼装 + 引用卡片
```

## 接入真实服务

Provider 优先级：**智谱 GLM > 通用 OpenAI 兼容端点 > 内置 mock**。

### 方式一：智谱 GLM（推荐，一把 Key 同时驱动对话与向量）

项目已内置 `.env.local`，**只需在其中填入你的 Key**：

```bash
# .env.local
ZHIPU_API_KEY=<在这里粘贴你的智谱 API Key>
ZHIPU_LLM_MODEL=glm-4.6          # 如已开通 glm-5.1 可改成 glm-5.1
ZHIPU_EMBEDDING_MODEL=embedding-3
```

填好后重启 `npm run dev` 即生效：问答走 `ZhipuLLMProvider`、向量检索走
`ZhipuEmbeddingProvider`（均为开放平台 v4 接口，鉴权 `Authorization: Bearer <Key>`）。
Key 仅在服务端 API Routes 读取，不会下发到浏览器。

### 方式二：其它 OpenAI 兼容端点

```bash
EMBEDDING_API_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL   # /v1/embeddings
LLM_API_URL / LLM_API_KEY / LLM_MODEL                     # /v1/chat/completions
```

`getEmbeddingProvider()` / `getLLMProvider()` 会在检测到上述变量时自动切换到真实实现，
上层 RAG 代码无需改动。接入真实向量库时，替换 `lib/db/*` 的读写实现即可。

> 注：切换 Embedding Provider 后请重启服务，使内存知识库用新模型重新生成向量
> （mock 与真实向量维度不同，重启会一并重新播种）。

## 文档切片说明

`lib/rag/chunk.ts` 优先按法规结构切分，识别「第X章 / 第X节 / 第X条 / 表X」。
TXT / Markdown 可直接解析正文，并支持用 `【第12页】` 或 `[[page:12]]` 标注页码
（见 `samples/示例-公共服务设施配置标准.txt`）。PDF / DOCX 在 MVP 阶段仅登记元数据，
接入解析库后即可在 `/process` 中完成真实切片。

## 内置 mock 知识库

`lib/db/mockData.ts` 内置演示性条文（非任何城市真实法规），覆盖：二类居住用地定义、
商务金融用地定义、商业用地与商务用地区别、居住用地绿地率、停车配建标准，以及一条
「未明确规定容积率上限」的条文用于演示拒答。
