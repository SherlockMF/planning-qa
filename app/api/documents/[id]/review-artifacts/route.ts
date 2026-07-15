import { NextRequest, NextResponse } from "next/server";

import { listReviewArtifacts } from "@/lib/audit/artifactStore";
import { requireReviewArtifactAccess } from "./access";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requireReviewArtifactAccess(req, params.id);
  if (!access.ok) return access.response;

  try {
    const artifacts = listReviewArtifacts(params.id);
    return NextResponse.json({ artifacts });
  } catch (error) {
    console.error("[review] artifact listing failed:", error);
    return NextResponse.json(
      { error: "审核副本读取失败" },
      { status: 500 }
    );
  }
}
