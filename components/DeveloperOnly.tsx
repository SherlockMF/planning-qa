"use client";

import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useKnowledgeUser } from "@/components/KnowledgeUserProvider";

export function DeveloperOnly({ children }: { children: ReactNode }) {
  const { canUseDeveloperTools } = useKnowledgeUser();

  if (canUseDeveloperTools) return <>{children}</>;

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col gap-3 py-10 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-700">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            功能暂时关闭
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            检索调试、切分查看、评测等开发人员功能已临时隐藏。
          </p>
        </div>
        <div>
          <Badge variant="warning">暂未开放</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
