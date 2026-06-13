"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Scale,
  FileText,
  SearchCode,
  ClipboardCheck,
  Layers,
} from "lucide-react";

const NAV = [
  { href: "/", label: "问答", icon: Scale },
  { href: "/documents", label: "文档管理", icon: FileText },
  { href: "/chunks", label: "切分查看", icon: Layers },
  { href: "/debug", label: "检索调试", icon: SearchCode },
  { href: "/evaluation", label: "评测", icon: ClipboardCheck },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b bg-primary text-primary-foreground shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          <span className="text-sm font-semibold tracking-tight md:text-base">
            规划设计院知识库
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary-foreground/15 text-primary-foreground"
                    : "text-primary-foreground/75 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
