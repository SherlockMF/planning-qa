# 城市规划与建筑设计院企业知识库

面向城市规划、建筑设计、交通、市政和技术质量团队的企业知识库问答系统。系统同时支持：

- 企业通用知识：制度、流程、FAQ、IT/行政、财务报销等；
- 行业垂直知识：规划法规、技术标准、设计指引、项目资料、成果要求等；
- 项目资料权限：普通员工、项目负责人、管理员在同一问题下只能检索自己有权访问的资料。

系统保留原有结构化 RAG 主链路：上传文档后解析文本、表格与结构化知识对象，生成检索 chunk 和 `RagTable`，问答时执行混合检索、重排、上下文扩展、拒答判断和带引用回答。

## 快速开始

```bash
npm install
npm run dev
```

默认开发地址为 `http://localhost:3100`。

## 页面

| 路径 | 用途 |
| --- | --- |
| `/` | 企业知识库问答工作台，可切换模拟账号并提交反馈 |
| `/documents` | 文档上传、解析、分类、项目和权限管理 |
| `/chunks` | 查看文档切片与结构化检索单元 |
| `/debug` | 查看关键词、向量、重排和 TopK 检索过程 |
| `/evaluation` | 题库评测与结果导入导出 |

## 模拟账号与权限

内置账号位于 `lib/knowledge/permissions.ts`。

- 普通员工：可访问 L1 公开资料，以及自己被授权的项目资料；
- 项目负责人：可访问 L1 公开资料、L2 非项目资料，以及自己负责的项目资料；
- 管理员：可访问全部资料。

项目资料通过 `Document.projectId/projectName/projectOwnerId/permissionLevel` 绑定。检索前会先过滤权限，无权资料不会进入 LLM 上下文；如果问题只命中无权资料，系统返回权限提示，不展示原文引用。

## 内置示例

内置 mock 数据包括公开技术标准和 4 类设计院项目/成果资料：

- 滨江片区控规优化项目资料；
- 产业园城市设计项目资料；
- 轨道站点 TOD 综合开发项目资料；
- 建筑方案报审资料清单。

这些示例用于验证不同账号下的项目资料可见性和权限拒答。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/chat` | 问答主链路，支持 `question/city/userId/userRole` |
| `POST` | `/api/feedback` | 保存本地反馈记录 |
| `GET` | `/api/documents` | 文档列表 |
| `POST` | `/api/documents/upload` | 上传文档 |
| `POST` | `/api/documents/:id/process` | 解析、切片、embedding、入库 |
| `PATCH/DELETE` | `/api/documents/:id` | 更新元数据、切换检索、删除文档 |
| `POST` | `/api/retrieve-debug` | 检索调试 |
| `GET/POST` | `/api/evaluation` | 题库与评测运行 |

## 验证

```bash
npm test
npx tsc --noEmit
npm run build
```

在 Windows PowerShell 如果 `npm` shim 被执行策略拦截，可使用 `npm.cmd test`、`npx.cmd tsc --noEmit`、`npm.cmd run build`。
