import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = {
  title: "智能问答助手",
  description:
    "基于知识库的问答工具：仅基于知识库回答，有明确依据才回答，无依据则拒答。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background antialiased">
        <SiteNav />
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8">
          {children}
        </main>
        <footer className="border-t bg-card">
          <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted-foreground">
            本工具为法规条文快查 MVP，仅基于已收录知识库作答，不进行规划条件审查、
            指标组合可行性判断或审批结论认定。最终以经批准的具体文件为准。
          </div>
        </footer>
      </body>
    </html>
  );
}
