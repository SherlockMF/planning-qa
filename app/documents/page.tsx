"use client";

import { useCallback, useEffect, useState } from "react";
import type { Document } from "@/lib/types";
import { DocumentUploader } from "@/components/DocumentUploader";
import { DocumentTable } from "@/components/DocumentTable";
import { useKnowledgeUser } from "@/components/KnowledgeUserProvider";
import { Loader2 } from "lucide-react";

export default function DocumentsPage() {
  const { currentUser } = useKnowledgeUser();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (options?: { showLoading?: boolean }) => {
    if (options?.showLoading) setLoading(true);
    const res = await fetch(
      `/api/documents?userId=${encodeURIComponent(currentUser.id)}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    setDocuments(data.documents ?? []);
    setLoading(false);
  }, [currentUser.id]);

  useEffect(() => {
    load({ showLoading: true });
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 md:text-2xl">
          文档管理
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          上传并管理知识库文档。仅「已入库」且「参与检索」的文档会被问答与检索使用。
        </p>
      </div>

      <DocumentUploader onUploaded={() => load({ showLoading: false })} />

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载文档列表…
        </div>
      ) : (
        <DocumentTable
          documents={documents}
          currentUser={currentUser}
          onChange={() => load({ showLoading: false })}
        />
      )}
    </div>
  );
}
