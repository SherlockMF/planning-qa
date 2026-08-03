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
  const selectableUsers = getSelectableKnowledgeUsers();

  return (
    <header className="sticky top-0 z-40 border-b border-primary/20 bg-gradient-primary text-primary-foreground shadow-elevated backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg transition-smooth hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/50"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-foreground/20 shadow-card ring-1 ring-inset ring-primary-foreground/30 transition-smooth hover:bg-primary-foreground/25">
            <Scale className="h-5 w-5" />
          </span>
          <span className="text-base font-bold tracking-tight md:text-lg">
            DesignBase AI
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
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/50",
                  active
                    ? "bg-primary-foreground/20 text-primary-foreground shadow-card ring-1 ring-inset ring-primary-foreground/30"
                    : "text-primary-foreground/75 hover:bg-primary-foreground/15 hover:text-primary-foreground hover:shadow-card"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
          </nav>
          <div className="flex items-center gap-2.5 rounded-lg bg-primary-foreground/15 px-3 py-2 shadow-card ring-1 ring-inset ring-primary-foreground/25 transition-smooth hover:bg-primary-foreground/20">
            <UserRound className="h-4 w-4 shrink-0 text-primary-foreground/80" />
            <Select
              value={currentUser.id}
              onChange={(e) => setCurrentUserId(e.target.value)}
              className="h-8 w-[240px] border-transparent bg-transparent text-primary-foreground shadow-none hover:border-primary-foreground/30 focus-visible:ring-primary-foreground/50 [&>option]:text-foreground"
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
