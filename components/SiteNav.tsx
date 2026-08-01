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
    <header className="sticky top-0 z-40 border-b border-primary/40 bg-primary text-primary-foreground shadow-sm">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/50"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-foreground/15 ring-1 ring-inset ring-primary-foreground/20">
            <Scale className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight md:text-base">
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
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/50",
                  active
                    ? "bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20"
                    : "text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
          </nav>
          <div className="flex items-center gap-2 rounded-md bg-primary-foreground/10 px-2 py-1 ring-1 ring-inset ring-primary-foreground/15">
            <UserRound className="h-4 w-4 shrink-0 text-primary-foreground/70" />
            <Select
              value={currentUser.id}
              onChange={(e) => setCurrentUserId(e.target.value)}
              className="h-8 w-[240px] border-transparent bg-transparent text-primary-foreground shadow-none hover:border-primary-foreground/25 focus-visible:ring-primary-foreground/40 [&>option]:text-foreground"
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
