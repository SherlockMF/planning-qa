import { LabNav } from "@/components/LabNav";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LabNav />
      <main className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-6 md:py-8">
        {children}
      </main>
      <footer className="border-t bg-card">
        <div className="mx-auto max-w-[1800px] px-4 py-4 text-xs text-muted-foreground">
          测试台跑测与审计会真实调用问答链路；结果仅供质量诊断，不替代正式发布文件。
        </div>
      </footer>
    </>
  );
}
