import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_ARTIFACT_ROOT,
  loadArtifact,
  verifyArtifactIntegrity,
} from "@/lib/audit/artifactStore";
import { requireReviewArtifactAccess } from "../access";

const PRIVATE_NO_STORE = "private, no-store";
const REVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; artifactId: string } }
) {
  const access = await requireReviewArtifactAccess(req, params.id);
  if (!access.ok) return access.response;

  let artifact;
  try {
    artifact = loadArtifact(
      DEFAULT_ARTIFACT_ROOT,
      params.id,
      params.artifactId
    );
  } catch {
    return NextResponse.json(
      { error: "审核副本不存在" },
      { status: 404 }
    );
  }

  const integrity = verifyArtifactIntegrity(artifact);
  if (!integrity.ok) {
    return NextResponse.json(
      { error: "审核副本完整性校验失败", details: integrity.errors },
      { status: 409 }
    );
  }

  const format = req.nextUrl.searchParams.get("format") ?? "html";
  if (format === "manifest") {
    return NextResponse.json(artifact.manifest, {
      headers: { "Cache-Control": PRIVATE_NO_STORE },
    });
  }
  if (format === "markdown") {
    return new NextResponse(artifact.reviewMd, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": PRIVATE_NO_STORE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (format !== "html") {
    return NextResponse.json(
      { error: "审核副本格式无效" },
      { status: 400 }
    );
  }

  return new NextResponse(artifact.reviewHtml, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": PRIVATE_NO_STORE,
      "Content-Security-Policy": REVIEW_CSP,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}
