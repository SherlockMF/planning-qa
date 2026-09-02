const DEDICATED_SHELL_ROOTS = ["/qa", "/lab"] as const;

export function usesDedicatedRouteShell(pathname: string): boolean {
  return DEDICATED_SHELL_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`)
  );
}
