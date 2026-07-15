import { NextRequest } from "next/server";

import {
  DEFAULT_ARTIFACT_ROOT,
  loadArtifact,
  replaceReviewResult,
  verifyArtifactIntegrity,
  type LoadedArtifact,
} from "@/lib/audit/artifactStore";
import { sha256Buffer } from "@/lib/audit/createReviewArtifact";
import { evaluateReviewAvailability } from "@/lib/audit/reviewAvailability";
import {
  applyReviewSubmission,
  ReviewSubmissionError,
} from "@/lib/audit/reviewSubmission";
import { getStore } from "@/lib/db/store";
import { privateJson, requireReviewArtifactAccess } from "../../access";

export const dynamic = "force-dynamic";

function loadChecked(
  documentId: string,
  artifactId: string,
  requesterUserId: string
): {
  artifact: LoadedArtifact;
  availability: ReturnType<typeof evaluateReviewAvailability>;
} {
  const artifact = loadArtifact(
    DEFAULT_ARTIFACT_ROOT,
    documentId,
    artifactId
  );
  const integrity = verifyArtifactIntegrity(artifact);
  const sourceBuffer = getStore().rawBuffers[documentId];
  const sourceMatches = Boolean(
    sourceBuffer &&
      sha256Buffer(sourceBuffer) === artifact.manifest.document.sourceFileSha256
  );
  return {
    artifact,
    availability: evaluateReviewAvailability({
      integrityOk: integrity.ok,
      sourceMatches,
      status: artifact.result.status,
      reviewerUserId: artifact.result.reviewerUserId,
      requesterUserId,
      finalizedAt: artifact.result.finalizedAt,
    }),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; artifactId: string } }
) {
  const access = await requireReviewArtifactAccess(req, params.id);
  if (!access.ok) return access.response;

  try {
    const { artifact, availability } = loadChecked(
      params.id,
      params.artifactId,
      access.user.id
    );
    return privateJson({ result: artifact.result, ...availability });
  } catch {
    return privateJson(
      { error: "审核副本不存在" },
      { status: 404 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; artifactId: string } }
) {
  const access = await requireReviewArtifactAccess(req, params.id);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => null);
  let checked: ReturnType<typeof loadChecked>;
  try {
    checked = loadChecked(params.id, params.artifactId, access.user.id);
  } catch {
    return privateJson(
      { error: "审核副本不存在" },
      { status: 404 }
    );
  }

  if (!checked.availability.canSubmit) {
    return privateJson(
      { error: checked.availability.error },
      { status: 409 }
    );
  }

  try {
    const result = applyReviewSubmission({
      manifest: checked.artifact.manifest,
      current: checked.artifact.result,
      reviewerUserId: access.user.id,
      now: new Date().toISOString(),
      body,
    });
    replaceReviewResult(
      DEFAULT_ARTIFACT_ROOT,
      params.id,
      params.artifactId,
      result
    );
    return privateJson({ result });
  } catch (error) {
    if (error instanceof ReviewSubmissionError) {
      return privateJson(
        { error: error.message },
        { status: error.status }
      );
    }
    if (error instanceof Error && error.message === "review already finalized") {
      return privateJson(
        { error: "审核结果已提交" },
        { status: 409 }
      );
    }
    console.error("[review] save failed:", error);
    return privateJson(
      { error: "审核结果保存失败" },
      { status: 500 }
    );
  }
}
