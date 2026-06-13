"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { useKnowledgeUser } from "@/components/KnowledgeUserProvider";
import {
  KNOWLEDGE_ROLES,
  KNOWLEDGE_USERS,
} from "@/lib/knowledge/permissions";
import { visibleNavItemsForUser } from "@/lib/knowledge/navigation";
import {
  Scale,
  FileText,
  SearchCode,
  ClipboardCheck,
  Layers,
  UserRound,
} from "lucide-react";

const ICONS: Record<string, typeof Scale> = {
  "/": Scale,
  "/documents": FileText,
  "/chunks": Layers,
  "/debug": SearchCode,
  "/evaluation": ClipboardCheck,
};

export function SiteNav() {
  const pathname = usePathname();
  const { currentUser, setCurrentUserId } = useKnowledgeUser();
  const navItems = visibleNavItemsForUser(currentUser);

  return (
    <header className="sticky top-0 z-40 border-b bg-primary text-primary-foreground shadow-sm">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          <span className="text-sm font-semibold tracking-tight md:text-base">
            规划设计院知识库
          </span>
        </Link>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <nav className="flex flex-wrap items-center gap-1">
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = ICONS[item.href] ?? FileText;
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
          <div className="flex items-center gap-2 rounded-md bg-primary-foreground/10 px-2 py-1">
            <UserRound className="h-4 w-4 text-primary-foreground/80" />
            <Select
              value={currentUser.id}
              onChange={(e) => setCurrentUserId(e.target.value)}
              className="h-8 w-[240px] border-primary-foreground/20 bg-primary text-primary-foreground shadow-none"
            >
              {KNOWLEDGE_USERS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {KNOWLEDGE_ROLES[u.role].label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>
    </header>
  );
}
