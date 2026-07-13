"use client";

import type { EvaluationItem, EvaluationStats } from "@/lib/types";
import type { QualityMetricsSummary } from "@/lib/evaluation/qualityMetrics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

function ScoreBadge({ score }: { score?: 0 | 1 | 2 }) {
  if (score === undefined)
    return <span className="text-xs text-muted-foreground">—</span>;
  const variant = score === 2 ? "success" : score === 1 ? "warning" : "destructive";
  return <Badge variant={variant}>{score}</Badge>;
}

function YesNo({ value }: { value?: boolean }) {
  if (value === undefined)
    return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge variant={value ? "success" : "destructive"}>
      {value ? "是" : "否"}
    </Badge>
  );
}

export function EvaluationTable({ items }: { items: EvaluationItem[] }) {
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[200px]">问题</TableHead>
            <TableHead className="min-w-[140px]">正确文件 / 条款 / 页码</TableHead>
            <TableHead>应拒答</TableHead>
            <TableHead>正确条文进Top5</TableHead>
            <TableHead>引用正确</TableHead>
            <TableHead>是否正确拒答</TableHead>
            <TableHead>答案得分</TableHead>
            <TableHead className="min-w-[120px]">主要错误原因</TableHead>
            <TableHead className="text-right">系统回答</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.id}>
              <TableCell className="align-top text-sm text-slate-800">
                {it.question}
                <p className="mt-1 text-xs text-muted-foreground">
                  标准：{it.standardAnswer}
                </p>
              </TableCell>
              <TableCell className="align-top text-xs text-muted-foreground">
                <div>{it.correctFile}</div>
                <div>
                  {it.correctArticle}　第{it.correctPage}页
                </div>
              </TableCell>
              <TableCell className="align-top">
                <Badge variant={it.shouldRefuse ? "warning" : "secondary"}>
                  {it.shouldRefuse ? "是" : "否"}
                </Badge>
              </TableCell>
              <TableCell className="align-top">
                <YesNo value={it.inTop5} />
              </TableCell>
              <TableCell className="align-top">
                <YesNo value={it.citationCorrect} />
              </TableCell>
              <TableCell className="align-top">
                {it.shouldRefuse ? (
                  <YesNo value={it.refusedCorrectly} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="align-top">
                <ScoreBadge score={it.answerScore} />
              </TableCell>
              <TableCell className="align-top text-xs text-muted-foreground">
                {it.errorReason || (it.answerScore !== undefined ? "—" : "未运行")}
              </TableCell>
              <TableCell className="align-top text-right">
                {it.systemAnswer ? (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        查看
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle className="text-base">
                          系统回答
                        </DialogTitle>
                      </DialogHeader>
                      <div className="max-h-[60vh] overflow-auto rounded-md bg-muted/40 p-4">
                        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">
                          {it.systemAnswer}
                        </pre>
                      </div>
                    </DialogContent>
                  </Dialog>
                ) : (
                  <span className="text-xs text-muted-foreground">未运行</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EvaluationStatsPanel({ stats }: { stats: EvaluationStats }) {
  const cards = [
    { label: "测试题数量", value: stats.total },
    { label: "正确条文进入 Top5", value: stats.inTop5Count },
    { label: "引用完全正确", value: stats.citationCorrectCount },
    { label: "平均答案得分", value: stats.averageScore.toFixed(2) },
    { label: "正确拒答数量", value: stats.refusedCorrectlyCount },
  ];

  const errors = Object.entries(stats.errorReasonSummary);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border bg-card p-4 text-center"
          >
            <div className="text-2xl font-semibold tabular-nums text-primary">
              {c.value}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 text-sm font-medium text-slate-700">
          主要错误原因汇总
        </div>
        {errors.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            暂无错误记录（运行评测后此处显示真实统计）。
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {errors.map(([reason, count]) => (
              <Badge key={reason} variant="warning">
                {reason} × {count}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function QualityMetricsPanel({
  summary,
}: {
  summary: QualityMetricsSummary;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            AI 产品质量控制
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            用题库把检索、引用、拒答、权限隔离和表格数值风险转成可复盘指标。
          </p>
        </div>
        <Badge variant="outline">面试演示视角</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {summary.cards.map((card) => (
          <div key={card.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-700">
                  {card.label}
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-primary">
                  {card.value}
                </div>
              </div>
              {card.rate !== undefined && (
                <Badge variant={card.rate >= 0.8 ? "success" : "warning"}>
                  {(card.rate * 100).toFixed(0)}%
                </Badge>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {card.description}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 text-sm font-medium text-slate-700">
          主要失败原因
        </div>
        {summary.topErrors.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            暂无失败原因。运行评测后，这里会沉淀最值得优先改进的 AI 质量问题。
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {summary.topErrors.map((item) => (
              <Badge key={item.reason} variant="warning">
                {item.reason} × {item.count}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
