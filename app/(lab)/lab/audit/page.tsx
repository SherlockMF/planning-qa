import { WorkflowAuditPanel } from "@/components/WorkflowAuditPanel";
import { DeveloperOnly } from "@/components/DeveloperOnly";
import { parseAuditTraceIdParam } from "@/lib/workflow/presentation";

export default function AuditPage({
  searchParams,
}: {
  searchParams?: { traceId?: string | string[] };
}) {
  const initialTraceId = parseAuditTraceIdParam(searchParams?.traceId);
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          AI 工作流审计台
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          从文档上传、解析、切块到问题安全检测、权限过滤、三路召回、答案反思与最终输出，实时查看并回放完整链路。
        </p>
      </div>
      <DeveloperOnly>
        <WorkflowAuditPanel initialTraceId={initialTraceId} />
      </DeveloperOnly>
    </div>
  );
}
