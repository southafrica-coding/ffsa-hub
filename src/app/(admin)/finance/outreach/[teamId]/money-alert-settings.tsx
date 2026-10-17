"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * When the money still with the team drops to these levels, the team's
 * school leaders get a Slack DM (lib/outreach/cash-alerts). Once per level;
 * sending more money resets it.
 */
export function MoneyAlertSettings({
  teamId,
  lowPct: initialLow,
  criticalPct: initialCritical,
  schoolLeaders,
}: {
  teamId: string;
  lowPct: number;
  criticalPct: number;
  schoolLeaders: { name: string; slackLinked: boolean }[];
}) {
  const router = useRouter();
  const [low, setLow] = useState(String(initialLow));
  const [critical, setCritical] = useState(String(initialCritical));
  const [saving, setSaving] = useState(false);

  const l = Number(low);
  const c = Number(critical);
  const valid = Number.isInteger(l) && Number.isInteger(c) && c >= 0 && l <= 100 && c <= l;
  const dirty = l !== initialLow || c !== initialCritical;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/finance/outreach/teams", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: teamId, cash_alert_low_pct: l, cash_alert_critical_pct: c }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Couldn't save the alert levels");
        return;
      }
      toast.success("Alert levels saved");
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  const reachable = schoolLeaders.filter((s) => s.slackLinked);
  const unreachable = schoolLeaders.filter((s) => !s.slackLinked);

  return (
    <div className="space-y-3 border border-ink px-4 py-4">
      <div>
        <h3 className="font-medium">Money alerts</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          When the money still with the team drops to these levels (of what was sent), the team&apos;s school leaders get a
          Slack message so base can send more in time.
        </p>
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
        {schoolLeaders.length === 0 ? (
          <span className="text-amber">
            No school leader on this team yet — add one above (role <strong>School Leader</strong>) to get these alerts.
          </span>
        ) : (
          <>
            <span className="text-muted-foreground">Alerts go to </span>
            {reachable.length ? reachable.map((s) => s.name).join(", ") : <span className="text-amber">nobody yet</span>}
            {unreachable.length > 0 && (
              <span className="text-amber">
                {" "}
                · {unreachable.map((s) => s.name).join(", ")} {unreachable.length === 1 ? "hasn't" : "haven't"} linked
                Slack on their Hub profile
              </span>
            )}
          </>
        )}
      </p>
    </div>
  );
}
