import { ChatPanel } from "@/components/ChatPanel";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 md:text-2xl">
          DesignBase AI 项目组知识工作台
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          面向规划/建筑设计院项目组的可信 RAG 问答：查项目资料、规范表格和成果要求，同时前置权限过滤、引用追溯和依据不足拒答。
        </p>
      </div>
      <ChatPanel />
    </div>
  );
}
