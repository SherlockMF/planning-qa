import Link from "next/link";
import { DeveloperOnly } from "@/components/DeveloperOnly";
import { listBatches } from "@/lib/evaluation/batch";
import { buildLabOverview } from "@/lib/evaluation/labOverview";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, Layers, SearchCode } from "lucide-react";

const LINKS = [
  {
    href: "/lab/evaluation",
    title: "评测",
    description: "管理题库、批次跑测与人工复核。",
    Icon: ClipboardCheck,
  },
  {
    href: "/lab/audit",
    title: "工作流审计",
    description: "端到端发起问答并逐步查看权限、检索与生成链路。",
    Icon: SearchCode,
  },
  {
    href: "/lab/chunks",
    title: "切分查看",
    description: "核对文档切分结果，辅助诊断检索可解释性。",
    Icon: Layers,
  },
] as const;

export default function LabHomePage() {
  const overview = buildLabOverview(listBatches());
  const gateVariant =
    overview.gate?.status === "passed"
      ? "success"
      : overview.gate?.status === "blocked_infra"
        ? "warning"
        : overview.gate
          ? "destructive"
          : "secondary";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 md:text-2xl">
          测试台
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          独立于问答产品的质量诊断入口。跑测与审计会真实调用当前问答链路，用于回归与排障，不替代正式发布文件。
        </p>
      </div>

      <DeveloperOnly>
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  质量概览
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {overview.baselineNote}
                </p>
              </div>
              {overview.gate && (
                <Badge variant={gateVariant}>
                  gate · {overview.gate.status}
                </Badge>
              )}
            </div>

            {!overview.latest ? (
              <p className="mt-4 text-sm text-muted-foreground">
                还没有完成的评测批次。前往{" "}
                <Link href="/lab/evaluation" className="text-primary underline">
                  评测
                </Link>{" "}
                跑一批后再看趋势。
              </p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <Metric
                  label="最近批次"
                  value={overview.latest.versionLabel}
                  hint={new Date(overview.latest.createdAt).toLocaleString(
                    "zh-CN"
                  )}
                />
                <Metric
                  label="产品通过率"
                  value={
                    overview.latest.productPassRate == null
                      ? "—"
                      : `${(overview.latest.productPassRate * 100).toFixed(0)}%`
                  }
                  hint={`PASS ${overview.latest.passed} / FAIL ${overview.latest.failed} / REVIEW ${overview.latest.review} / ERROR ${overview.latest.error}`}
                />
                <Metric
                  label="可比回归"
                  value={
                    overview.regression
                      ? `+${overview.regression.fixed.length} / -${overview.regression.regressed.length}`
                      : "—"
                  }
                  hint={
                    overview.regression
                      ? "变好 / 变差（仅指纹一致时）"
                      : "无可比基线，不展示假趋势"
                  }
                />
                <Metric
                  label="门槛结论"
                  value={overview.gate?.status ?? "—"}
                  hint={overview.gate?.summary ?? "尚无门禁结果"}
                />
              </div>
            )}

            {overview.topClusters.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-slate-700">
                  Top 失败簇
                </div>
                <div className="flex flex-wrap gap-2">
                  {overview.topClusters.map((cluster) => (
                    <div
                      key={cluster.id}
                      className="flex items-center gap-2 rounded border bg-background px-2 py-1 text-xs"
                    >
                      <Badge variant="warning">
                        {cluster.label} × {cluster.count}
                      </Badge>
                      {cluster.sampleWorkflowTraceId && (
                        <Link
                          href={`/lab/audit?traceId=${encodeURIComponent(cluster.sampleWorkflowTraceId)}`}
                          className="text-primary underline"
                        >
                          查看审计
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {LINKS.map(({ href, title, description, Icon }) => (
              <Link
                key={href}
                href={href}
                className="rounded-lg border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <div className="flex items-center gap-2 text-slate-800">
                  <Icon className="h-4 w-4" />
                  <h2 className="text-sm font-semibold">{title}</h2>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </DeveloperOnly>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded border bg-background px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-800">
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
        {hint}
      </div>
    </div>
  );
}
