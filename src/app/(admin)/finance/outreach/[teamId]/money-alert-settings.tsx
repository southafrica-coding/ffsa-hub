"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";

type Person = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
};

function personName(p: Person) {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unnamed";
}

/**
 * When the money still with the team drops to these levels, the school
 * leader named here — and nobody else — gets a Slack DM
 * (lib/outreach/cash-alerts, migration 261). Once per level; sending more
 * money resets it.
 */
export function MoneyAlertSettings({
  teamId,
  lowPct: initialLow,
  criticalPct: initialCritical,
  recipientId: initialRecipientId,
  recipient,
  people,
}: {
  teamId: string;
  lowPct: number;
  criticalPct: number;
  recipientId: string | null;
  /** The saved recipient as stored, for the Slack-linked check. */
  recipient: { name: string; slackLinked: boolean } | null;
  people: Person[];
}) {
  const router = useRouter();
  const [low, setLow] = useState(String(initialLow));
  const [critical, setCritical] = useState(String(initialCritical));
  const [recipientId, setRecipientId] = useState(initialRecipientId ?? "");
  const [saving, setSaving] = useState(false);

  const l = Number(low);
  const c = Number(critical);
  const valid = Number.isInteger(l) && Number.isInteger(c) && c >= 0 && l <= 100 && c <= l;
  const dirty = l !== initialLow || c !== initialCritical || recipientId !== (initialRecipientId ?? "");

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/finance/outreach/teams", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: teamId,
          cash_alert_low_pct: l,
          cash_alert_critical_pct: c,
          cash_alert_user_id: recipientId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Couldn't save the alert settings");
        return;
      }
      toast.success("Alert settings saved");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 border border-ink px-4 py-4">
      <div>
        <h3 className="font-medium">Money alerts</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          When the money still with the team drops to these levels (of what was sent), the school leader named here gets a
          Slack message so base can send more in time. Nobody else gets these alerts.
        </p>
      </div>

      <div className="max-w-md">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-[#55524A]">School leader</span>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchableSelect
              value={recipientId}
              onChange={setRecipientId}
              placeholder={`Choose from ${people.length} people…`}
              options={[...people]
                .sort((a, b) => personName(a).localeCompare(personName(b)))
                .map((p) => ({
                  value: p.id,
                  label: p.email ? `${personName(p)} — ${p.email}` : personName(p),
                }))}
            />
          </div>
          {recipientId && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRecipientId("")}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-[#55524A]">Running low at</span>
          <div className="flex items-center gap-1.5">
            <Input type="number" min={0} max={100} value={low} onChange={(e) => setLow(e.target.value)} className="h-9 w-20 text-right font-mono" />
            <span className="text-sm">% left</span>
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-[#55524A]">Urgent at</span>
          <div className="flex items-center gap-1.5">
            <Input type="number" min={0} max={100} value={critical} onChange={(e) => setCritical(e.target.value)} className="h-9 w-20 text-right font-mono" />
            <span className="text-sm">% left</span>
          </div>
        </label>
        <Button size="sm" onClick={save} disabled={!dirty || !valid || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {!valid && <p className="text-xs text-destructive">Urgent must be the same as or lower than running low, between 0 and 100.</p>}

      <p className="text-sm">
        {!initialRecipientId ? (
          <span className="text-amber">No school leader named yet, so nobody gets these alerts.</span>
        ) : recipient && !recipient.slackLinked ? (
          <span className="text-amber">
            {recipient.name} hasn&apos;t linked Slack on their Hub profile, so the alerts can&apos;t reach them yet.
          </span>
        ) : recipient ? (
          <>
            <span className="text-muted-foreground">Alerts go to </span>
            {recipient.name}
          </>
        ) : null}
      </p>
    </div>
  );
}
