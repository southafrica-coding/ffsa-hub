// A tiny local stand-in for the shell's useMe()/useCan() (slice 1, not on
// this branch yet): swap the import for "@/features/shell" once it lands.
// UX only: it decides wording, never access. RLS and the API decide that.

import { useEffect, useState } from "react";

import { getMe, type Me } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getMe(apiFetch, { signal: controller.signal }).then(
      (m) => setMe(m),
      () => {
        // Wording falls back to the plain version; nothing is gated on this.
      },
    );
    return () => controller.abort();
  }, []);
  return me;
}

const FINANCE_STAFF_ROLES = new Set(["super_admin", "admin", "finance_admin"]);
const FINANCE_STAFF_PERMS = new Set(["finance.view", "finance.edit"]);

/** Finance office / admins: they see every team on the website, not just their own. */
export function isFinanceStaff(me: Me | null): boolean {
  if (!me) return false;
  return me.roles.some((r) => FINANCE_STAFF_ROLES.has(r.name)) || me.permissions.some((p) => FINANCE_STAFF_PERMS.has(p.key));
}
