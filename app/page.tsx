import { ChatPanel } from "@/components/ChatPanel";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800 md:text-2xl">
          城市规划与建筑设计院企业知识库
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          支持企业通用知识、行业标准与项目资料的可溯源问答；项目资料会按模拟账号权限过滤。
        </p>
      </div>
      <ChatPanel />
    </div>
  );
}
