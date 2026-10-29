import { cn } from "@/lib/utils/cn";

/**
 * Marks a Super Admin account wherever someone could act on it (Users list,
 * profile/permissions header). Black, not yellow — it is a fact about the
 * account, not something that needs you.
 */
export function SuperAdminBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap border border-ink bg-ink px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-white",
        className
      )}
      title="Only a Super Admin can change this account's status, titles or admin access."
    >
      Super Admin
    </span>
  );
}

/** Shown in place of a control a General Admin can't use on a Super Admin. */
export const SUPER_ADMIN_LOCKED_NOTE =
  "Super Admin account. Only a Super Admin can change its status, titles or admin access.";
