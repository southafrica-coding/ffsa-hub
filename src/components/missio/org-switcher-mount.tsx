"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { orgHref, shouldShowOrgSwitcher } from "./access";
import { MissioApiError, missioClient } from "./api";
import type { MissioMe } from "./types-shim";
import { OrgSwitcher } from "./org-switcher";

let cached: Promise<MissioMe | null> | null = null;

function loadMe(): Promise<MissioMe | null> {
  if (!cached) {
    cached = missioClient.getMe().catch((error: unknown) => {
      if (error instanceof MissioApiError) return null;
      return null;
    });
  }
  return cached;
}

/** FFSA shell slot. Hides itself unless /api/missio/me lists more than one org. */
export function OrgSwitcherMount({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const [me, setMe] = useState<MissioMe | null>(null);

  useEffect(() => {
    let active = true;
    loadMe().then((next) => {
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
