"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { useKnowledgeUser } from "@/components/KnowledgeUserProvider";
import {
  getSelectableKnowledgeUsers,
  KNOWLEDGE_ROLES,
} from "@/lib/knowledge/permissions";
import { visibleLabNavItemsForUser } from "@/lib/knowledge/navigation";
import {
  ArrowLeft,
  ClipboardCheck,
  FlaskConical,
  Layers,
  LayoutDashboard,
  SearchCode,
  UserRound,
} from "lucide-react";

const ICONS: Record<string, typeof FlaskConical> = {
  "/lab": LayoutDashboard,
  "/lab/evaluation": ClipboardCheck,
  "/lab/audit": SearchCode,
  "/lab/chunks": Layers,
};

export function LabNav() {
  const pathname = usePathname();
  const { currentUser, setCurrentUserId } = useKnowledgeUser();
  const navItems = visibleLabNavItemsForUser(currentUser);
  const selectableUsers = getSelectableKnowledgeUsers();

  return (
    <header className="sticky top-0 z-40 border-b bg-slate-900 text-slate-50 shadow-sm">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/lab" className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            <span className="text-sm font-semibold tracking-tight md:text-base">
              DesignBase 测试台
            </span>
          </Link>
          <Link
            href="/"
            className="hidden items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white sm:flex"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回问答
          </Link>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <nav className="flex flex-wrap items-center gap-1">
            {navItems.map((item) => {
              const active =
                item.href === "/lab"
                  ? pathname === "/lab"
                  : pathname.startsWith(item.href);
              const Icon = ICONS[item.href] ?? FlaskConical;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-white/15 text-white"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white sm:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              返回问答
            </Link>
          </nav>
          <div className="flex items-center gap-2 rounded-md bg-white/10 px-2 py-1">
            <UserRound className="h-4 w-4 text-slate-300" />
            <Select
              value={currentUser.id}
              onChange={(e) => setCurrentUserId(e.target.value)}
              className="h-8 w-[240px] border-white/20 bg-slate-900 text-slate-50 shadow-none"
            >
              {selectableUsers.map((u) => (
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
