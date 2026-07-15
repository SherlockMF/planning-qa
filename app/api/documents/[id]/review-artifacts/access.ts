import { NextRequest, NextResponse } from "next/server";

import { getDocument } from "@/lib/db/documents";
import {
  canManageDocumentInManagement,
  resolveKnowledgeUser,
} from "@/lib/knowledge/permissions";
import type { Document, KnowledgeUser } from "@/lib/types";

type ReviewArtifactAccess =
  | { ok: true; document: Document; user: KnowledgeUser }
  | { ok: false; response: NextResponse };

export async function requireReviewArtifactAccess(
  req: NextRequest,
  documentId: string
): Promise<ReviewArtifactAccess> {
  const document = await getDocument(documentId);
  if (!document) {
    return {
      ok: false,
      response: NextResponse.json({ error: "文档不存在" }, { status: 404 }),
    };
  }

  const user = resolveKnowledgeUser({
    userId: req.nextUrl.searchParams.get("userId") ?? undefined,
  });
  if (!canManageDocumentInManagement(user, document)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "当前账号无权审核该文档" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, document, user };
}
