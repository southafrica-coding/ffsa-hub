"use client";

import { usePathname, useRouter } from "next/navigation";
import { ADMIN_MODULES, SYSTEM_MODULES, PORTAL_TABS } from "@/config/modules";

/**
 * Top-level (sidebar-root) routes. On these the back arrow is hidden — they're
 * reached from the sidebar, so "back" would leave the hub. Derived from the
 * module config so it stays in sync as modules are added.
 */
const ROOT_ROUTES = new Set<string>([
  ...ADMIN_MODULES.map((m) => m.href),
  ...SYSTEM_MODULES.map((m) => m.href),
  ...PORTAL_TABS.map((t) => t.href),
]);

/**
 * Generic "← Back" control shown in the top-left of every nested hub page.
 * Rendered once in the (admin) and (portal) layouts; self-hides on root routes.
 */
export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();

  if (!pathname || ROOT_ROUTES.has(pathname)) return null;

  function handleBack() {
    // Prefer real browser history; fall back to the parent path on a direct load
    // (no in-app history) so the button never dead-ends.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    const parent = pathname!.replace(/\/[^/]+\/?$/, "") || "/dashboard";
    router.push(parent);
  }

  return (
    <div className="px-4 pt-3 md:px-6 md:pt-6">
      <button
        type="button"
        onClick={handleBack}
        className="flex min-h-11 items-center text-xs uppercase text-muted-foreground hover:text-foreground"
        style={{ letterSpacing: "0.15em" }}
      >
        ← Back
      </button>
    </div>
  );
}
