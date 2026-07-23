import { NextRequest, NextResponse } from "next/server";

import { getTableReprocessRequest } from "@/lib/reprocess/tableReprocessApi";
import { tableReprocessApiDependencies } from "../dependencies";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; stagingId: string } }
) {
  const result = await getTableReprocessRequest(
    {
      docId: params.id,
      stagingId: params.stagingId,
      userId: request.nextUrl.searchParams.get("userId") ?? undefined,
    },
    tableReprocessApiDependencies
  );
  return NextResponse.json(result.body, { status: result.status });
}
