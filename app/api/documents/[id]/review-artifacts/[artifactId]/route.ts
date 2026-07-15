import type { NextRequest } from "next/server.js";

import { getReviewArtifactApi } from "../access";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; artifactId: string } },
) {
  return (await getReviewArtifactApi()).readArtifact(request, params);
}
