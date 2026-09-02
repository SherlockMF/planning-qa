import { SiteNav } from "@/components/SiteNav";

export default function QaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-8 md:py-10">
        {children}
      </main>
      <footer className="border-t border-border/60 bg-muted/30">
        <div className="mx-auto max-w-[1800px] px-4 py-5 text-xs leading-relaxed text-muted-foreground">
          本系统仅基于当前账号可访问的企业知识库作答；项目资料、技术标准与成果要求以正式发布文件和项目授权为准。
        </div>
      </footer>
    </>
  );
}
