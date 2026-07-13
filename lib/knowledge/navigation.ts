import type { KnowledgeUser } from "@/lib/types";

export interface KnowledgeNavItem {
  href: string;
  label: string;
  kind: "primary" | "developer";
}

export const KNOWLEDGE_NAV_ITEMS: KnowledgeNavItem[] = [
  { href: "/", label: "问答", kind: "primary" },
  { href: "/documents", label: "文档管理", kind: "primary" },
  { href: "/chunks", label: "切分查看", kind: "developer" },
  { href: "/debug", label: "解释台", kind: "developer" },
  { href: "/evaluation", label: "质量控制", kind: "developer" },
];

export function canUseDeveloperTools(user: KnowledgeUser): boolean {
  return user.role === "admin" || user.role === "developer";
}

export function visibleNavItemsForUser(
  user: KnowledgeUser
): KnowledgeNavItem[] {
  return KNOWLEDGE_NAV_ITEMS.filter(
    (item) => item.kind === "primary" || canUseDeveloperTools(user)
  );
}
