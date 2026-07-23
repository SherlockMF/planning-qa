import { NextRequest, NextResponse } from "next/server";

import { publishTableReprocessRequest } from "@/lib/reprocess/tableReprocessApi";
import { tableReprocessApiDependencies } from "../../dependencies";

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; stagingId: string } }
) {
  const result = await publishTableReprocessRequest(
    {
      docId: params.id,
      stagingId: params.stagingId,
      userId: request.nextUrl.searchParams.get("userId") ?? undefined,
    },
    tableReprocessApiDependencies
  );
  return NextResponse.json(result.body, { status: result.status });
}
