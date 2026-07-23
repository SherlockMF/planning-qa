import { NextRequest, NextResponse } from "next/server";

import { prepareTableReprocessRequest } from "@/lib/reprocess/tableReprocessApi";
import { tableReprocessApiDependencies } from "../dependencies";

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json().catch(() => ({}));
  const result = await prepareTableReprocessRequest(
    {
      docId: params.id,
      userId: request.nextUrl.searchParams.get("userId") ?? undefined,
      stagingId:
        typeof body.stagingId === "string" ? body.stagingId : undefined,
    },
    tableReprocessApiDependencies
  );
  return NextResponse.json(result.body, { status: result.status });
}
