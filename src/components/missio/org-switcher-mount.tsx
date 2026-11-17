"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { orgHref, shouldShowOrgSwitcher } from "./access";
import { clearMissioMeCache, loadMissioMe } from "./me-cache";
import type { MissioMe } from "./types-shim";
import { OrgSwitcher } from "./org-switcher";

/** FFSA shell slot. Hides itself unless /api/missio/me lists more than one org. */
export function OrgSwitcherMount({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const [me, setMe] = useState<MissioMe | null>(null);

  useEffect(() => {
    function onSubmit(event: Event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.getAttribute("action")?.includes("/auth/sign-out")) return;
      clearMissioMeCache();
      setMe(null);
    }
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  useEffect(() => {
    let active = true;
    loadMissioMe().then((next) => {
      if (active) setMe(next);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!me || !shouldShowOrgSwitcher(me.orgs.length)) return null;

  const currentOrg = pathname.startsWith("/missio") ? "missio" : "ffsa";
  return (
    <OrgSwitcher
      compact={compact}
      currentOrg={currentOrg}
      orgs={me.orgs.map((org) => ({
        id: org.id,
        slug: org.slug,
        name: org.name,
        href: orgHref(org.slug),
      }))}
    />
  );
}
