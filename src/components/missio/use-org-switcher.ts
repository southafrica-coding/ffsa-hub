"use client";

import { useMemo, useState } from "react";
import { shouldShowOrgSwitcher, skinForOrg, sortOrgs, type OrgSkin } from "./access";

export interface OrgSwitcherOrg {
  id: string;
  slug: string;
  name: string;
  href: string;
}

/** Narrow on purpose: this control moves into the Departments shell later. */
export interface OrgSwitcherProps {
  orgs: OrgSwitcherOrg[];
  currentOrg: string;
  onSwitch?: (slug: string) => void;
}

export function useOrgSwitcher({ orgs, currentOrg, onSwitch }: OrgSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ordered = useMemo(() => sortOrgs(orgs), [orgs]);
  const visible = shouldShowOrgSwitcher(ordered.length);
  const skin: OrgSkin = skinForOrg(currentOrg);
  const current = ordered.find((org) => org.slug === currentOrg) ?? null;

  function choose(slug: string) {
    onSwitch?.(slug);
    setOpen(false);
  }

  return { open, setOpen, ordered, visible, skin, current, choose };
}
