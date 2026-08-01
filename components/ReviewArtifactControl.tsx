"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, Loader2 } from "lucide-react";

import type { ReviewArtifactSummary } from "@/lib/audit/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export function ReviewArtifactControl({
  docId,
  userId,
  enabled,
}: {
  docId: string;
  userId: string;
  enabled: boolean;
}) {
  const [artifacts, setArtifacts] = useState<ReviewArtifactSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);
    fetch(`/api/documents/${docId}/review-artifacts?userId=${encodeURIComponent(userId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "审核快照加载失败");
        return body.artifacts as ReviewArtifactSummary[];
      })
      .then((items) => {
        if (!active) return;
        setArtifacts(items);
        setSelectedId((current) => current || items[0]?.artifactId || "");
        setError("");
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [docId, enabled, userId]);

  if (!enabled) return <span className="text-[11px] text-muted-foreground">入库后可进入审核</span>;
  if (loading) {
    return <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />加载审核快照</span>;
  }
  if (error) return <span className="text-[11px] text-destructive">{error}</span>;
  if (artifacts.length === 0) return <span className="text-[11px] text-muted-foreground">暂无审核快照，请先重新解析</span>;

  const selected = artifacts.find((artifact) => artifact.artifactId === selectedId) ?? artifacts[0];
  return (
    <div className="grid gap-2 rounded-md border bg-muted/50 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">审核快照</span>
        <div className="flex gap-1">
          <Badge variant={selected.suspectedCount > 0 ? "warning" : "success"}>
            疑似 {selected.suspectedCount}
          </Badge>
          {selected.unavailableCount > 0 && <Badge variant="destructive">不可用 {selected.unavailableCount}</Badge>}
        </div>
      </div>
      <Select className="h-8 text-xs" value={selected.artifactId} onChange={(event) => setSelectedId(event.target.value)}>
        {artifacts.map((artifact) => (
          <option key={artifact.artifactId} value={artifact.artifactId}>
            {formatTime(artifact.createdAt)} · {modeLabel(artifact.autoReviewMode)}
          </option>
        ))}
      </Select>
      <Button asChild size="sm" variant="outline" className="justify-center bg-card">
        <Link href={`/documents/${docId}/review/${selected.artifactId}?userId=${encodeURIComponent(userId)}`}>
          <ClipboardCheck className="h-3.5 w-3.5" />进入审核
        </Link>
      </Button>
    </div>
  );
}

function modeLabel(mode: ReviewArtifactSummary["autoReviewMode"]): string {
  if (mode === "hybrid") return "混合 Agent";
  if (mode === "rules_only") return "规则模式";
  if (mode === "partial") return "部分完成";
  return "不可用";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
