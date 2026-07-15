"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ReviewArtifactSummary } from "@/lib/audit/types";
import {
  parseReviewArtifactSummaries,
  reviewStatusMeta,
} from "@/lib/audit/reviewPresentation";

function responseProperty(value: unknown, key: "error" | "artifacts"): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

export function ReviewArtifactControl({
  documentId,
  currentUserId,
  refreshToken,
}: {
  documentId: string;
  currentUserId: string;
  refreshToken: number;
}) {
  const [artifacts, setArtifacts] = useState<ReviewArtifactSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetch(
      `/api/documents/${encodeURIComponent(documentId)}/review-artifacts?userId=${encodeURIComponent(currentUserId)}`,
      { cache: "no-store" }
    )
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => ({}));
        if (!response.ok) {
          const responseError = responseProperty(data, "error");
          throw new Error(
            typeof responseError === "string"
              ? responseError
              : "审核副本读取失败"
          );
        }
        return parseReviewArtifactSummaries(
          responseProperty(data, "artifacts")
        );
      })
      .then((next) => {
        if (!active) return;
        setArtifacts(next);
        setSelectedId((current) =>
          next.some((item) => item.artifactId === current)
            ? current
            : (next[0]?.artifactId ?? "")
        );
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error ? cause.message : "审核副本读取失败"
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [documentId, currentUserId, refreshToken]);

  if (loading) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="text-xs text-muted-foreground"
      >
        读取审核状态…
      </span>
    );
  }
  if (error) {
    return (
      <Badge role="alert" variant="destructive">
        {error}
      </Badge>
    );
  }
  if (!artifacts.length) {
    return <Badge variant="secondary">无审核副本</Badge>;
  }

  const selected =
    artifacts.find((item) => item.artifactId === selectedId) ?? artifacts[0];
  const status = reviewStatusMeta(selected.status);
  const href = `/api/documents/${encodeURIComponent(documentId)}/review-artifacts/${encodeURIComponent(selected.artifactId)}?format=html&userId=${encodeURIComponent(currentUserId)}`;

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1.5">
        <Badge variant={status.variant}>{status.label}</Badge>
        <span className="text-[11px] text-muted-foreground">
          {artifacts.length} 个快照
        </span>
      </div>
      {artifacts.length > 1 && (
        <Select
          className="h-8 text-xs"
          value={selected.artifactId}
          aria-label="选择审核快照"
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {artifacts.map((item) => (
            <option key={item.artifactId} value={item.artifactId}>
              {new Date(item.generatedAt).toLocaleString("zh-CN")}
            </option>
          ))}
        </Select>
      )}
      <Button asChild size="sm" variant="outline">
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`打开文档 ${documentId} 的审核快照 ${selected.artifactId}`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          打开审核
        </a>
      </Button>
    </div>
  );
}
