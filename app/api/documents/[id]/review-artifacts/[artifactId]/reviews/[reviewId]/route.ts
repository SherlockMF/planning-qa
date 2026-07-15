import type { NextRequest } from "next/server.js";

import { getReviewArtifactApi } from "../../../access";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; artifactId: string; reviewId: string } },
) {
  return (await getReviewArtifactApi()).readReview(request, params);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; artifactId: string; reviewId: string } },
) {
  return (await getReviewArtifactApi()).updateReview(request, params);
}
