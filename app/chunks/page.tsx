import { ChunkViewer } from "@/components/ChunkViewer";
import { DeveloperOnly } from "@/components/DeveloperOnly";

export default function ChunksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 md:text-2xl">
          切分查看
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          按文档检视实际切分结果：每个切片的页码、章节、条款、字数、关键词与原文，
          用于核对分块质量与检索可解释性。
        </p>
      </div>
      <DeveloperOnly>
        <ChunkViewer />
      </DeveloperOnly>
    </div>
  );
}
