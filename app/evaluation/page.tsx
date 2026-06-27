import { EvaluationManager } from "@/components/EvaluationManager";
import { DeveloperOnly } from "@/components/DeveloperOnly";

export default function EvaluationPage() {
  return (
    // 评测表格列多，撑出 max-w-6xl 主容器会出现横向滚动条；
    // 此页放开为近整屏宽度（full-bleed），让表格自适应可用宽度。
    // 用 100vw-1rem 而非 100vw，预留滚动条宽度，避免出现页面级横向滚动条。
    <div className="mx-[calc(50%-50vw+0.5rem)] w-[calc(100vw-1rem)] space-y-6 px-4 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 md:text-2xl">
          评测
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          可自定义题目与标准答案，逐题真实运行问答链路自动判分，并支持人工复核调整得分与判定。
          所有统计来自当前题库的真实记录，不预设指标。
        </p>
      </div>
      <DeveloperOnly>
        <EvaluationManager />
      </DeveloperOnly>
    </div>
  );
}
