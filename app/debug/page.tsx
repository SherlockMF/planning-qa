import { RetrievalDebugPanel } from "@/components/RetrievalDebugPanel";
import { DeveloperOnly } from "@/components/DeveloperOnly";

export default function DebugPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 md:text-2xl">
          检索调试
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查看关键词检索、向量检索及合并重排序后的 Top5 片段与各项得分，用于测试 RAG 效果。
        </p>
      </div>
      <DeveloperOnly>
        <RetrievalDebugPanel />
      </DeveloperOnly>
    </div>
  );
}
