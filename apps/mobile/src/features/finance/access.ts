// Finance wording gates on top of the shell's shared Me (useMe() from
// "@/features/shell"). UX only: it decides wording, never access. RLS and
// the API decide that.

import type { Me } from "@/lib/api";

const FINANCE_STAFF_ROLES = new Set(["super_admin", "admin", "finance_admin"]);
const FINANCE_STAFF_PERMS = new Set(["finance.view", "finance.edit"]);

/** Finance office / admins: they see every team on the website, not just their own. */
export function isFinanceStaff(me: Me | null): boolean {
  if (!me) return false;
  return me.roles.some((r) => FINANCE_STAFF_ROLES.has(r.name)) || me.permissions.some((p) => FINANCE_STAFF_PERMS.has(p.key));
}
