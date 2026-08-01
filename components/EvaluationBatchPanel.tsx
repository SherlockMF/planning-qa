"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EvaluationBatch,
  EvaluationBatchCompareResult,
  EvaluationItem,
} from "@/lib/types";
import type { FailureCluster } from "@/lib/evaluation/failureClusters";
import type { ReleaseGateResult } from "@/lib/evaluation/releaseGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import Link from "next/link";
import { Loader2, GitCompareArrows, Ban } from "lucide-react";

const POLL_MS = 1200;

export function EvaluationBatchPanel({
  items,
  selectedIds,
  running,
  onRunningChange,
  onItemsRefresh,
}: {
  items: EvaluationItem[];
  selectedIds: string[];
  running: boolean;
  onRunningChange: (running: boolean) => void;
  onItemsRefresh: () => Promise<void> | void;
}) {
  const [batches, setBatches] = useState<EvaluationBatch[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [versionLabel, setVersionLabel] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [compare, setCompare] = useState<EvaluationBatchCompareResult | null>(
    null
  );
  const [error, setError] = useState<string>();
  const [comparing, setComparing] = useState(false);
  const [gate, setGate] = useState<ReleaseGateResult | null>(null);
  const [clusters, setClusters] = useState<FailureCluster[]>([]);
  const [draftingCaseId, setDraftingCaseId] = useState<string>();

  const active = useMemo(() => {
    const running = batches.find(
      (batch) => batch.status === "running" || batch.status === "queued"
    );
    return running ?? batches.find((batch) => batch.id === activeId);
  }, [batches, activeId]);
  // 只轮询进行中的批次；点选历史不应打断进度，也不应对已结束批次反复 refresh
  const trackingId = useMemo(
    () =>
      batches.find(
        (batch) => batch.status === "running" || batch.status === "queued"
      )?.id,
    [batches]
  );
  const doneBatches = useMemo(
    () => batches.filter((batch) => batch.status === "done"),
    [batches]
  );

  const refreshBatches = useCallback(async () => {
    const res = await fetch("/api/evaluation/batch", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "读取批次失败");
    setBatches(data.batches ?? []);
    return data.batches as EvaluationBatch[];
  }, []);

  useEffect(() => {
    void refreshBatches().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause))
    );
  }, [refreshBatches]);

  useEffect(() => {
    if (!trackingId) return;

    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/evaluation/batch/${encodeURIComponent(trackingId)}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "轮询失败");
        if (stopped) return;
        const next = data.batch as EvaluationBatch;
        setBatches((prev) => {
          const others = prev.filter((item) => item.id !== next.id);
          return [next, ...others].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          );
        });
        const terminal =
          next.status === "done" ||
          next.status === "error" ||
          next.status === "cancelled";
        if (next.status === "running" || next.status === "queued") {
          onRunningChange(true);
        }
        if (terminal) {
          onRunningChange(false);
          void onItemsRefresh();
          if (timer) clearInterval(timer);
        }
      } catch (cause) {
        if (!stopped) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };

    void tick();
    timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [trackingId, onItemsRefresh, onRunningChange]);

  useEffect(() => {
    if (!active || active.status !== "done") {
      setGate(null);
      setClusters([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [gateRes, clusterRes] = await Promise.all([
          fetch("/api/evaluation/gate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batchId: active.id }),
          }),
          fetch(
            `/api/evaluation/batch/${encodeURIComponent(active.id)}/clusters`,
            { cache: "no-store" }
          ),
        ]);
        const gateData = await gateRes.json();
        const clusterData = await clusterRes.json();
        if (cancelled) return;
        if (gateRes.ok) setGate(gateData.gate as ReleaseGateResult);
        if (clusterRes.ok) {
          setClusters((clusterData.clusters as FailureCluster[]) ?? []);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  async function draftFromFailure(caseId: string) {
    if (!active) return;
    setDraftingCaseId(caseId);
    setError(undefined);
    try {
      const res = await fetch("/api/evaluation/cases/from-failure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: active.id, caseId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成草稿失败");
      await onItemsRefresh();
      alert(data.message ?? "已写入草稿题");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDraftingCaseId(undefined);
    }
  }

  async function startBatch(caseIds?: string[]) {
    setError(undefined);
    setCompare(null);
    onRunningChange(true);
    try {
      const label =
        versionLabel.trim() ||
        `run-${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
      const res = await fetch("/api/evaluation/batch/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionLabel: label,
          changeNote:
            changeNote.trim() || (caseIds?.length ? "运行所选" : "运行全部"),
          caseIds,
          items,
          clientRequestId: `ui-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 6)}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? data.error ?? "启动批次失败");
      const batch = data.batch as EvaluationBatch;
      setActiveId(batch.id);
      await refreshBatches();
    } catch (cause) {
      onRunningChange(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function cancelActive() {
    const id = trackingId ?? activeId;
    if (!id) return;
    const res = await fetch(`/api/evaluation/batch/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "取消失败");
      return;
    }
    await refreshBatches();
  }

  async function runCompare() {
    if (!baselineId || !candidateId) return;
    setComparing(true);
    setError(undefined);
    try {
      const res = await fetch("/api/evaluation/batch/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baselineId, candidateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "对比失败");
      setCompare(data.compare as EvaluationBatchCompareResult);
    } catch (cause) {
      setCompare(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setComparing(false);
    }
  }

  const progress = active
    ? `${active.caseResults.length}/${active.caseIds.length}`
    : "—";

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">评测批次</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            每次运行固化题库快照与索引指纹；长跑可轮询、可取消；仅指纹一致时才能做回归对比。
          </p>
        </div>
        {active && (
          <Badge
            variant={
              active.status === "done"
                ? "success"
                : active.status === "error" || active.status === "cancelled"
                  ? "destructive"
                  : "warning"
            }
          >
            {active.status} · {progress}
          </Badge>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto_auto]">
        <Input
          value={versionLabel}
          onChange={(e) => setVersionLabel(e.target.value)}
          placeholder="版本标签（如 fix-citation-v2）"
        />
        <Input
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          placeholder="变更说明（可选）"
        />
        <Button
          onClick={() => void startBatch()}
          disabled={running || items.length === 0}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          运行全部（批次）
        </Button>
        <Button
          variant="outline"
          onClick={() => void startBatch(selectedIds)}
          disabled={running || selectedIds.length === 0}
        >
          运行所选
        </Button>
        <Button
          variant="ghost"
          onClick={() => void cancelActive()}
          disabled={!trackingId}
        >
          <Ban className="h-4 w-4" />
          取消
        </Button>
      </div>

      {active && (
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
          <Stat label="PASS" value={active.passed} />
          <Stat label="FAIL" value={active.failed} />
          <Stat label="REVIEW" value={active.review} />
          <Stat label="ERROR" value={active.error} />
          <Stat
            label="产品通过率"
            value={
              active.productPassRate == null
                ? "—"
                : `${(active.productPassRate * 100).toFixed(0)}%`
            }
          />
        </div>
      )}

      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">历史批次</div>
        <div className="max-h-40 overflow-auto rounded border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted/70">
              <tr>
                <th className="px-2 py-1">版本</th>
                <th className="px-2 py-1">状态</th>
                <th className="px-2 py-1">进度</th>
                <th className="px-2 py-1">通过率</th>
                <th className="px-2 py-1">时间</th>
              </tr>
            </thead>
            <tbody>
              {batches.slice(0, 20).map((batch) => (
                <tr
                  key={batch.id}
                  className={`cursor-pointer border-t hover:bg-muted/40 ${
                    batch.id === activeId ? "bg-primary/5" : ""
                  }`}
                  onClick={() => setActiveId(batch.id)}
                >
                  <td className="px-2 py-1">{batch.versionLabel}</td>
                  <td className="px-2 py-1">{batch.status}</td>
                  <td className="px-2 py-1">
                    {batch.caseResults.length}/{batch.caseIds.length}
                  </td>
                  <td className="px-2 py-1">
                    {batch.productPassRate == null
                      ? "—"
                      : `${(batch.productPassRate * 100).toFixed(0)}%`}
                  </td>
                  <td className="px-2 py-1 text-muted-foreground">
                    {new Date(batch.createdAt).toLocaleString("zh-CN")}
                  </td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-2 py-4 text-center text-muted-foreground"
                  >
                    尚无批次。点击「运行全部（批次）」开始。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {active && active.status === "done" && (
        <div className="space-y-3 rounded border bg-muted/20 p-3 text-xs">
          {gate && (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">发布门槛</span>
                <Badge
                  variant={
                    gate.status === "passed"
                      ? "success"
                      : gate.status === "blocked_infra"
                        ? "warning"
                        : "destructive"
                  }
                >
                  {gate.status}
                </Badge>
                <span className="text-muted-foreground">{gate.summary}</span>
              </div>
              <ul className="space-y-0.5 text-muted-foreground">
                {gate.rules.map((rule) => (
                  <li key={rule.id}>
                    {rule.passed ? "✓" : "✗"} {rule.label} — {rule.evidence}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {clusters.length > 0 && (
            <div className="space-y-2">
              <div className="font-medium text-foreground">失败簇</div>
              {clusters.map((cluster) => (
                <div
                  key={cluster.id}
                  className="rounded border bg-background px-2 py-1.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">
                      {cluster.label} × {cluster.count}
                    </Badge>
                    {cluster.sampleWorkflowTraceId && (
                      <Link
                        href={`/lab/audit?traceId=${encodeURIComponent(cluster.sampleWorkflowTraceId)}`}
                        className="text-primary underline"
                      >
                        样本审计
                      </Link>
                    )}
                    <span className="text-muted-foreground">
                      {cluster.representativeErrorReason}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {cluster.caseIds.map((caseId) => (
                      <Button
                        key={caseId}
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px]"
                        disabled={draftingCaseId === caseId}
                        onClick={() => void draftFromFailure(caseId)}
                      >
                        {draftingCaseId === caseId ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : null}
                        入库草稿 {caseId}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">基线批次</div>
          <Select
            value={baselineId}
            onChange={(e) => setBaselineId(e.target.value)}
            className="min-w-[180px]"
          >
            <option value="">选择</option>
            {doneBatches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.versionLabel}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">候选批次</div>
          <Select
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
            className="min-w-[180px]"
          >
            <option value="">选择</option>
            {doneBatches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.versionLabel}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="outline"
          onClick={() => void runCompare()}
          disabled={comparing || !baselineId || !candidateId}
        >
          {comparing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GitCompareArrows className="h-4 w-4" />
          )}
          对比
        </Button>
      </div>

      {compare && (
        <div className="rounded border bg-muted/30 p-3 text-xs">
          {compare.comparable ? (
            <div className="space-y-1">
              <div>
                变好 {compare.fixed.length} · 变差 {compare.regressed.length} ·
                不变 {compare.unchanged.length}
              </div>
              {compare.fixed.length > 0 && (
                <div className="text-success">
                  fixed: {compare.fixed.join(", ")}
                </div>
              )}
              {compare.regressed.length > 0 && (
                <div className="text-destructive">
                  regressed: {compare.regressed.join(", ")}
                </div>
              )}
              {compare.metricDeltas?.productPassRate != null && (
                <div>
                  产品通过率 Δ{" "}
                  {(compare.metricDeltas.productPassRate * 100).toFixed(1)} pt
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1 text-warning-foreground">
              <div>不可比：</div>
              {compare.reasons.map((reason) => (
                <div key={reason}>· {reason}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded border border-destructive-border bg-destructive-surface px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border bg-background px-2 py-1.5 text-center">
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
