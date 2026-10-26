"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * "Outreach: own teams only" (migration 274). Admins switch it per person.
 * It never changes the person's Finance grants — it only stops finance.view
 * / finance.edit opening every outreach team.
 */
export function OutreachRestriction({
  userId,
  personName,
  limited,
  hasFinanceGrant,
}: {
  userId: string;
  personName: string;
  limited: boolean;
  /** Holds finance.view or finance.edit, so the flag changes something today. */
  hasFinanceGrant: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(limited);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  async function toggle(next: boolean) {
    setSaving(true);
    setChecked(next);
    try {
      const res = await fetch("/api/admin/outreach-restriction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, limited_to_own_teams: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setChecked(!next);
        toast.error(data.error || "Could not update outreach access.");
        return;
      }
      toast.success(
        next
          ? `${personName} now sees only their own outreach teams.`
          : `${personName}'s Finance access covers every outreach team again.`
      );
      startTransition(() => router.refresh());
    } catch {
      setChecked(!next);
      toast.error("Could not update outreach access.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid var(--rule)", padding: "20px" }}>
      <p
        style={{
          fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
          fontSize: "1rem",
          letterSpacing: "0.07em",
          color: "var(--text-primary)",
          marginBottom: "4px",
        }}
      >
        Outreach access
      </p>
      <p style={{ fontSize: "13px", color: "#55524A", marginBottom: "14px" }}>
        Finance view or edit access normally opens every outreach team. Limit it here
        without touching the rest of their Finance access.
      </p>

      <label className="flex items-start gap-3" style={{ cursor: saving ? "wait" : "pointer" }}>
        <Checkbox
          checked={checked}
          disabled={saving}
          onCheckedChange={(v) => toggle(v === true)}
          aria-describedby="outreach-restriction-help"
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium text-ink">Outreach: own teams only</span>
          <span id="outreach-restriction-help" className="block text-[13px]" style={{ color: "#55524A" }}>
            {personName} sees only the outreach teams they are on (owner, co-leader or member)
            and the teams in outreach groups they manage. Their other Finance access stays
            as it is. Admins and Finance Admins see every team regardless.
          </span>
          {!hasFinanceGrant && (
            <span className="mono-label mt-2 block">
              No finance view or edit access at the moment — this changes nothing until they have it.
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
