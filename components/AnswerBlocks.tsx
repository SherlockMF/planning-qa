import type { AnswerBlock } from "@/lib/types";
import { StructuredTableBlock } from "@/components/StructuredTableBlock";

// ============================================================================
// 结构化答案渲染（P0，spec 第十六章）
// ----------------------------------------------------------------------------
// 按 AnswerBlock 类型分发：text → 段落；table_slice → 真实表格；citation → 引用。
// 表格本体只由 StructuredTableBlock 从 cells 渲染，不交给 LLM 转 Markdown。
// ============================================================================

export function AnswerBlocks({ blocks }: { blocks: AnswerBlock[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        if (block.type === "text") {
          if (!block.content.trim()) return null;
          return (
            <p
              key={i}
              className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800"
            >
              {block.content}
            </p>
          );
        }

        if (block.type === "table_slice") {
          return (
            <StructuredTableBlock
              key={block.tableId + "_" + i}
              tableTitle={block.tableTitle}
              columns={block.columns}
              rows={block.rows}
              source={block.source}
            />
          );
        }

        if (block.type === "citation") {
          return (
            <p key={i} className="text-xs text-muted-foreground">
              {block.content}
            </p>
          );
        }

        return null;
      })}
    </div>
  );
}
