import { NextRequest, NextResponse } from "next/server";
import { listDocuments } from "@/lib/db/documents";
import {
  canViewDocumentInManagement,
  resolveKnowledgeUser,
} from "@/lib/knowledge/permissions";
import type { KnowledgeRoleId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const user = resolveKnowledgeUser({
    userId: params.get("userId") ?? undefined,
    userRole: (params.get("userRole") ?? undefined) as
      | KnowledgeRoleId
      | undefined,
  });
  const documents = (await listDocuments()).filter((doc) =>
    canViewDocumentInManagement(user, doc)
  );
  return NextResponse.json({ documents });
}
