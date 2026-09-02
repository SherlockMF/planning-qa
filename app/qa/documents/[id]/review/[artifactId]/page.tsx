import { AlertTriangle } from "lucide-react";

import { AuditReviewWorkbench } from "@/components/AuditReviewWorkbench";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AuditManifest, AutoReviewRun, HumanReviewRound } from "@/lib/audit/types";
import { KNOWLEDGE_USERS } from "@/lib/knowledge/permissions";
import { getReviewArtifactApi } from "@/app/api/documents/[id]/review-artifacts/access";

export const dynamic = "force-dynamic";

export default async function AuditReviewPage({
  params,
  searchParams,
}: {
  params: { id: string; artifactId: string };
  searchParams: { userId?: string };
}) {
  const userId = searchParams.userId ?? "";
  const api = await getReviewArtifactApi();
  const base = `http://localhost/api/documents/${params.id}/review-artifacts/${params.artifactId}`;
  const query = `userId=${encodeURIComponent(userId)}`;
  const [manifestResponse, autoResponse, reviewsResponse] = await Promise.all([
    api.readArtifact(new Request(`${base}?${query}&format=manifest`), params),
    api.readArtifact(new Request(`${base}?${query}&format=auto-review`), params),
    api.listReviews(new Request(`${base}/reviews?${query}`), params),
  ]);
  if (!manifestResponse.ok || !autoResponse.ok || !reviewsResponse.ok) {
    const failed = [manifestResponse, autoResponse, reviewsResponse].find((response) => !response.ok)!;
    const body = await failed.json().catch(() => ({}));
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>无法打开审核工作台</AlertTitle>
        <AlertDescription>{body.error ?? "审核产物不可用或当前账号无管理权限。"}</AlertDescription>
      </Alert>
    );
  }

  const manifestBody = await manifestResponse.json() as { manifest: AuditManifest };
  const autoBody = await autoResponse.json() as { autoReview: AutoReviewRun };
  const reviewsBody = await reviewsResponse.json() as { reviews: HumanReviewRound[] };
  const reviewerNames = Object.fromEntries(KNOWLEDGE_USERS.map((user) => [user.id, user.name]));
  const currentUserName = reviewerNames[userId] ?? userId ?? "未知用户";

  return (
    <AuditReviewWorkbench
      docId={params.id}
      currentUserId={userId}
      currentUserName={currentUserName}
      reviewerNames={reviewerNames}
      manifest={manifestBody.manifest}
      initialAutoReview={autoBody.autoReview}
      initialRounds={reviewsBody.reviews}
    />
  );
}
