import type { ChatResponse } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CitationCard } from "@/components/CitationCard";
import { TableBlock, hasTableStructure } from "@/components/TableBlock";
import { AnswerBlocks } from "@/components/AnswerBlocks";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";

/** 将回答文本按已知【标题】切分为分段，便于结构化渲染。
 *  只拆分已知的模板节标题，防止 chunk 内容里的【所属表:…】【表头:…】等
 *  被误当成节标题，导致"结论"正文被截空。
 */
function parseSections(answer: string): { title: string; body: string }[] {
  // 仅匹配模板约定的节标题，内容中的【…】不参与拆分
  const parts = answer
    .split(/【(结论|依据|注意|无法确定|原因|建议)】/)
    .filter((s) => s !== "");
  const KNOWN = new Set(["结论", "依据", "注意", "无法确定", "原因", "建议"]);
  const sections: { title: string; body: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const title = parts[i]?.trim();
    const body = (parts[i + 1] ?? "").trim();
    if (title && KNOWN.has(title)) sections.push({ title, body });
  }
  return sections;
}

export function AnswerCard({ response }: { response: ChatResponse }) {
  const sections = parseSections(response.answer);
  const get = (t: string) => sections.find((s) => s.title === t)?.body ?? "";
  // P0：命中表格时优先用结构化 answerBlocks 渲染（真实表格，非 LLM 手写）
  const hasBlocks = (response.answerBlocks?.length ?? 0) > 0;

  // ---- 拒答展示 ----
  if (!response.foundEvidence) {
    return (
      <Alert variant="warning" className="border-2">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="flex items-center gap-2">
          无法确定
          {response.refusalReason && (
            <Badge variant="warning">{response.refusalReason}</Badge>
          )}
        </AlertTitle>
        <AlertDescription className="space-y-3 pt-1">
          <p>{get("无法确定")}</p>
          <div>
            <p className="font-medium text-amber-900">原因</p>
            <p className="text-amber-800">{get("原因")}</p>
          </div>
          <div>
            <p className="font-medium text-amber-900">建议</p>
            <p className="text-amber-800">{get("建议")}</p>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  // ---- 正常回答展示 ----
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
              <CheckCircle2 className="h-4 w-4" />
              结论
            </div>
            {hasBlocks ? (
              <AnswerBlocks blocks={response.answerBlocks!} />
            ) : hasTableStructure(get("结论")) ? (
              <div className="overflow-auto rounded-md border bg-white p-1">
                <TableBlock text={get("结论")} />
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">
                {get("结论")}
              </p>
            )}
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-amber-800">
              <Info className="h-3.5 w-3.5" />
              注意
            </div>
            <p className="text-xs leading-relaxed text-amber-900">
              {get("注意")}
            </p>
          </div>
        </CardContent>
      </Card>

      {response.citations.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-700">
            依据（{response.citations.length}）
          </div>
          <div className="space-y-3">
            {response.citations.map((c, i) => (
              <CitationCard key={c.id} citation={c} index={i + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
