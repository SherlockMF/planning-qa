# Route Shell Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate navigation and footers from `/qa` and `/lab` while preserving the existing v0 product shell and the dedicated Lab shell.

**Architecture:** A pure route classifier identifies paths that already own a nested shell. A small client `RootRouteShell` uses `usePathname()` to bypass the legacy root chrome for those paths and otherwise renders the existing v0 `SiteNav`, content container, and footer. Route-specific layouts retain responsibility for `/qa` and `/lab`.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Node.js test runner, Tailwind CSS.

## Global Constraints

- Preserve all existing URLs and public behavior.
- Do not add dependencies or change API, permission, or data behavior.
- `/qa` must match the current v0 product visual system.
- `/lab` must use the same design tokens while retaining its dark Lab navigation.
- Do not commit pre-existing untracked or modified user files as part of the implementation.

## File Structure

- Create `lib/knowledge/routeShell.ts`: pure dedicated-shell route classifier.
- Create `components/RootRouteShell.tsx`: pathname-aware root chrome boundary.
- Create `tests/routeShell.test.ts`: route classification regression coverage.
- Modify `tests/index.ts`: register the new regression test.
- Modify `app/layout.tsx`: delegate page chrome to `RootRouteShell`.
- Modify `app/qa/layout.tsx`: align the QA shell with current v0 spacing and footer classes.
- Modify `app/qa/page.tsx` and `app/qa/documents/page.tsx`: align typography with the current v0 pages.
- Modify `app/(lab)/lab/layout.tsx`, `app/(lab)/lab/chunks/page.tsx`, and `app/(lab)/lab/evaluation/page.tsx`: preserve the Lab shell and use shared design tokens.

---

### Task 1: Dedicated shell route classifier

**Files:**
- Create: `tests/routeShell.test.ts`
- Modify: `tests/index.ts`
- Create: `lib/knowledge/routeShell.ts`

**Interfaces:**
- Produces: `usesDedicatedRouteShell(pathname: string): boolean`
- Consumes: no application state or browser APIs.

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { usesDedicatedRouteShell } from "../lib/knowledge/routeShell.ts";

test("dedicated route shells match only qa and lab route segments", () => {
  for (const pathname of ["/qa", "/qa/documents", "/lab", "/lab/evaluation"]) {
    assert.equal(usesDedicatedRouteShell(pathname), true, pathname);
  }
  for (const pathname of ["/", "/documents", "/quality", "/laboratory"]) {
    assert.equal(usesDedicatedRouteShell(pathname), false, pathname);
  }
});
```

Append `import "./routeShell.test.ts";` to `tests/index.ts`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --experimental-strip-types tests/routeShell.test.ts
```

Expected: exit code is non-zero because `lib/knowledge/routeShell.ts` does not exist.

- [ ] **Step 3: Implement the minimal classifier**

```ts
const DEDICATED_SHELL_ROOTS = ["/qa", "/lab"] as const;

export function usesDedicatedRouteShell(pathname: string): boolean {
  return DEDICATED_SHELL_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`)
  );
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
node --experimental-strip-types tests/routeShell.test.ts
```

Expected: one passing test, zero failures.

---

### Task 2: Root shell boundary and visual alignment

**Files:**
- Create: `components/RootRouteShell.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/qa/layout.tsx`
- Modify: `app/qa/page.tsx`
- Modify: `app/qa/documents/page.tsx`
- Modify: `app/(lab)/lab/layout.tsx`
- Modify: `app/(lab)/lab/chunks/page.tsx`
- Modify: `app/(lab)/lab/evaluation/page.tsx`

**Interfaces:**
- Consumes: `usesDedicatedRouteShell(pathname: string): boolean` and `usePathname()`.
- Produces: `RootRouteShell({ children }: { children: React.ReactNode })`.

- [ ] **Step 1: Confirm the existing browser regression**

For both `http://localhost:3100/qa` and `http://localhost:3100/lab`, count `header` and `footer` elements.

Expected before implementation: two headers and two footers on each route.

- [ ] **Step 2: Create the pathname-aware root shell**

```tsx
"use client";

import { usePathname } from "next/navigation";

import { SiteNav } from "@/components/SiteNav";
import { usesDedicatedRouteShell } from "@/lib/knowledge/routeShell";

export function RootRouteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (usesDedicatedRouteShell(pathname)) return children;

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
```

Update `app/layout.tsx` so `KnowledgeUserProvider` renders only `<RootRouteShell>{children}</RootRouteShell>`.

- [ ] **Step 3: Align route-specific shell styles**

In `app/qa/layout.tsx`, use the same root v0 classes:

```tsx
<main className="mx-auto w-full max-w-[1800px] flex-1 px-4 py-8 md:py-10">
```

and:

```tsx
<footer className="border-t border-border/60 bg-muted/30">
  <div className="mx-auto max-w-[1800px] px-4 py-5 text-xs leading-relaxed text-muted-foreground">
```

In QA pages, match existing v0 typography with `space-y-8`, `space-y-2`, `text-2xl font-bold tracking-tight text-foreground md:text-3xl`, and `text-base leading-relaxed text-muted-foreground`.

In the Lab layout, add `flex-1` to the `main` container. In Lab page headings, replace hard-coded `text-slate-800` with `text-foreground`; retain the dark `LabNav` classes.

- [ ] **Step 4: Run TypeScript production compilation**

Run:

```powershell
npm run build
```

Expected: Next.js production build exits with code 0.

---

### Task 3: Regression verification

**Files:**
- Verify: `tests/routeShell.test.ts`
- Verify: all files changed in Tasks 1 and 2.

**Interfaces:**
- Consumes: completed root and route-specific shell implementation.
- Produces: test and browser evidence for the fixed behavior.

- [ ] **Step 1: Run the complete automated test suite**

Run:

```powershell
npm test
```

Expected: zero failing tests.

- [ ] **Step 2: Verify rendered shell counts**

Open `/`, `/qa`, and `/lab` in the local browser and count rendered `header` and `footer` elements.

Expected for every route: exactly one header and one footer.

- [ ] **Step 3: Verify visual responsibilities**

- `/` and `/qa`: blue v0 `SiteNav`, v0 typography, spacing, and footer.
- `/lab`: one dark `LabNav`, shared design tokens, and no outer `SiteNav`.

- [ ] **Step 4: Inspect the final diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intended implementation files plus pre-existing user changes are present.

If the user explicitly requests a commit, stage only the intended files listed in this plan and exclude all unrelated pre-existing untracked files.
