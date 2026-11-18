"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { canAccessMissio } from "./access";
import { clearFfsaRoleCache, loadFfsaRoleNames } from "./ffsa-roles";
import { clearMissioMeCache, loadMissioMe, subscribeMissioSignOut } from "./me-cache";
import { missioOrgHeader, needsPlatformRoleLookup } from "./org-header";
import type { MissioMe } from "./types-shim";
import { OrgSwitcher } from "./org-switcher";
import type { OrgSwitcherOrg } from "./use-org-switcher";

/** FFSA shell slot. Shown when the viewer can open both FFSA and Missio. */
export function OrgSwitcherMount({
  compact = false,
  loadMe = loadMissioMe,
  loadFfsaRoles = loadFfsaRoleNames,
}: {
  compact?: boolean;
  loadMe?: () => Promise<MissioMe | null>;
  loadFfsaRoles?: () => Promise<readonly string[] | null>;
}) {
  const pathname = usePathname();
  const [me, setMe] = useState<MissioMe | null>(null);
  const [switcherOrgs, setSwitcherOrgs] = useState<OrgSwitcherOrg[] | null>(null);

  useEffect(() => {
    function onSubmit(event: Event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.getAttribute("action")?.includes("/auth/sign-out")) return;
      clearMissioMeCache();
      clearFfsaRoleCache();
      setMe(null);
      setSwitcherOrgs(null);
    }
    document.addEventListener("submit", onSubmit, true);
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeMissioSignOut(createClient().auth, () => {
        clearMissioMeCache();
        clearFfsaRoleCache();
        setMe(null);
        setSwitcherOrgs(null);
      });
    } catch {
      // The browser client isn't available. The sign-out form above still clears the cache.
    }
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadMe()
      .then(async (next) => {
        if (!active) return;
        setMe(next);
        if (!next) {
          setSwitcherOrgs(null);
          return;
        }
        const missioAccess = canAccessMissio(next);
        const roles =
          needsPlatformRoleLookup(next.orgs) && missioAccess ? await loadFfsaRoles() : [];
        if (!active) return;
        const header = missioOrgHeader({
          orgs: next.orgs,
          ffsaRoleNames: roles ? [...roles] : null,
          allowPlatformFfsa: missioAccess,
        });
        setSwitcherOrgs(header.kind === "switcher" ? header.orgs : null);
      })
      .catch(() => {
        if (!active) return;
        setMe(null);
        setSwitcherOrgs(null);
      });
    return () => {
      active = false;
    };
  }, [loadMe, loadFfsaRoles]);

  if (!me || !switcherOrgs) return null;

  const currentOrg = pathname.startsWith("/missio") ? "missio" : "ffsa";
  return <OrgSwitcher compact={compact} currentOrg={currentOrg} orgs={switcherOrgs} />;
}
