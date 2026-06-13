import { EvaluationManager } from "@/components/EvaluationManager";
import { DeveloperOnly } from "@/components/DeveloperOnly";

export default function EvaluationPage() {
  return (
    <div className="space-y-6">
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
