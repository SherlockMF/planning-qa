import { ChatPanel } from "@/components/ChatPanel";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 md:text-2xl">
          智能问答助手
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          基于知识库的问答工具。
        </p>
      </div>
      <ChatPanel />
    </div>
  );
}
