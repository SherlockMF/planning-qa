import { WorkflowAuditPanel } from "@/components/WorkflowAuditPanel";
import { DeveloperOnly } from "@/components/DeveloperOnly";

export default function DebugPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 md:text-2xl">
          AI 工作流审计台
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          从文档上传、解析、切块到问题安全检测、权限过滤、三路召回、答案反思与最终输出，实时查看并回放完整链路。
        </p>
      </div>
      <DeveloperOnly>
        <WorkflowAuditPanel />
      </DeveloperOnly>
    </div>
  );
}
