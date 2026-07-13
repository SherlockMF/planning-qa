import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";
import { KnowledgeUserProvider } from "@/components/KnowledgeUserProvider";

export const metadata: Metadata = {
  title: "规划设计院企业知识库",
  description:
    "面向城市规划与建筑设计院的企业知识库：支持通用知识、行业标准与项目资料权限问答。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background antialiased">
        <KnowledgeUserProvider>
          <SiteNav />
          <main className="mx-auto w-full max-w-[1800px] px-4 py-6 md:py-8">
            {children}
          </main>
          <footer className="border-t bg-card">
            <div className="mx-auto max-w-[1800px] px-4 py-4 text-xs text-muted-foreground">
              本系统仅基于当前账号可访问的企业知识库作答；项目资料、技术标准与成果要求以正式发布文件和项目授权为准。
            </div>
          </footer>
        </KnowledgeUserProvider>
      </body>
    </html>
  );
}
