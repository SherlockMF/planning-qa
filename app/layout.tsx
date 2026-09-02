import type { Metadata } from "next";
import "./globals.css";
import { KnowledgeUserProvider } from "@/components/KnowledgeUserProvider";
import { RootRouteShell } from "@/components/RootRouteShell";

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
    <html lang="zh-CN" className="bg-background">
      <body className="flex min-h-screen flex-col bg-background text-foreground antialiased">
        <KnowledgeUserProvider>
          <RootRouteShell>{children}</RootRouteShell>
        </KnowledgeUserProvider>
      </body>
    </html>
  );
}
