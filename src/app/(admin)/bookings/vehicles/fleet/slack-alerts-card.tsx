"use client";

/** Who gets the vehicle coordinator's Slack DMs (requests, sign-outs/ins, 07:00 summary). */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Candidate = { id: string; name: string; slackLinked: boolean; chosen: boolean };

export function SlackAlertsCard() {
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/vehicles/slack-alerts")
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((d: { candidates: Candidate[] }) => {
        setPeople(d.candidates);
        setPicked(new Set(d.candidates.filter((c) => c.chosen).map((c) => c.id)));
      })
      .catch(() => setPeople([]));
  }, []);

  if (!people) return null;
  const chosen = people.filter((p) => p.chosen);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/vehicles/slack-alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...picked] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const ids = new Set<string>(data.userIds);
      setPeople(people!.map((p) => ({ ...p, chosen: ids.has(p.id) })));
      setEditing(false);
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-rule p-4 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">Slack alerts</div>
          <div className="text-[color:var(--text-secondary)]">
            New requests (approve / deny / assign from Slack), sign-outs and sign-ins, payments, and a 07:00 summary go
            to: {chosen.length ? chosen.map((p) => p.name + (p.slackLinked ? "" : " (Slack not linked)")).join(", ") : "nobody"}
          </div>
        </div>
        {!editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </div>
      {editing && (
        <div className="mt-3 space-y-2">
          {people.length === 0 && <p className="text-[color:var(--text-secondary)]">No vehicle approvers or managers yet.</p>}
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setPicked(next);
                  }}
                />
                {p.name}
                {!p.slackLinked && <span className="text-[color:var(--text-secondary)]">(Slack not linked)</span>}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
