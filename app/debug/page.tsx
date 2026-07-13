import { RetrievalDebugPanel } from "@/components/RetrievalDebugPanel";
import { DeveloperOnly } from "@/components/DeveloperOnly";

export default function DebugPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 md:text-2xl">
          可信 AI 解释台
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          展示当前账号的可检索范围、无权资料隔离、三路检索得分和最终候选，用于解释回答、拒答与权限判断。
        </p>
      </div>
      <DeveloperOnly>
        <RetrievalDebugPanel />
      </DeveloperOnly>
    </div>
  );
}
