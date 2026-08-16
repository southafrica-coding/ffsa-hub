"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { toast } from "sonner";
import SetDetail from "./set-detail";
import MySeats from "./my-seats";
import { roleLabel, fullName, formatDateLabel, formatTimeRange, type Person } from "./helpers";

interface InviteRow {
  id: string;
  role: string;
  status: string;
  required_label: { id: string; name: string } | null;
  set: {
    id: string;
    set_date: string;
    start_time: string;
    end_time: string;
    title: string | null;
    theme: string | null;
    owner: Person;
  } | null;
}
interface OwnedRow {
  id: string;
  set_date: string;
  start_time: string;
  end_time: string;
  title: string | null;
  theme: string | null;
  status: string;
}
interface RosterRow {
  id: string;
  role: string;
  status: string;
  set: { id: string; set_date: string; start_time: string; end_time: string; title: string | null; status: string; owner: Person } | null;
}

export default function MySets({ userId, isStaff }: { userId: string; isStaff: boolean }) {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [owned, setOwned] = useState<OwnedRow[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, o, r] = await Promise.all([
        fetch("/api/prayer-room/sets?scope=invites").then((x) => (x.ok ? x.json() : [])),
        fetch("/api/prayer-room/sets?scope=owned").then((x) => (x.ok ? x.json() : [])),
        fetch("/api/prayer-room/sets?scope=roster").then((x) => (x.ok ? x.json() : [])),
      ]);
      setInvites(i);
      setOwned(o);
      setRoster(r);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(slotId: string, action: "accept" | "decline") {
    setBusy(slotId);
    try {
      const res = await fetch(`/api/prayer-room/slots/${slotId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success(action === "accept" ? "You're in!" : "Declined");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="py-12 text-center text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-8">
      {/* Where you stand per seat, and the feedback written for you. */}
      <MySeats />

      {/* Invitations */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Invitations {invites.length > 0 && <span className="text-primary">({invites.length})</span>}
        </h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending invitations.</p>
        ) : (
          <div className="space-y-2">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {roleLabel(inv.role)}
                    {inv.set && <span className="text-muted-foreground"> · {inv.set.title || "Devo set"}</span>}
                  </div>
                  {inv.set && (
                    <div className="text-xs text-muted-foreground">
                      {formatDateLabel(inv.set.set_date)} · {formatTimeRange(inv.set.start_time, inv.set.end_time)}
                      {inv.set.owner && <> · {fullName(inv.set.owner)}</>}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" className="h-8 gap-1" disabled={busy === inv.id} onClick={() => respond(inv.id, "accept")}>
                    <Check className="h-3.5 w-3.5" /> Accept
                  </Button>
                  <Button size="sm" variant="outline" className="h-8" disabled={busy === inv.id} onClick={() => respond(inv.id, "decline")}>
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sets I own */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sets I lead</h2>
        {owned.length === 0 ? (
          <p className="text-sm text-muted-foreground">You don&apos;t lead any sets yet. Create one from the Schedule tab.</p>
        ) : (
          <div className="space-y-2">
            {owned.map((s) => (
              <SetRowButton
                key={s.id}
                title={s.title || s.theme || "Devo set"}
                when={`${formatDateLabel(s.set_date)} · ${formatTimeRange(s.start_time, s.end_time)}`}
                status={s.status}
                onClick={() => setSelectedId(s.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Sets I'm playing in */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sets I&apos;m serving in</h2>
        {roster.filter((r) => r.set).length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming sets you&apos;re rostered into.</p>
        ) : (
          <div className="space-y-2">
            {roster
              .filter((r) => r.set)
              .map((r) => (
                <SetRowButton
                  key={r.id}
                  title={`${r.set!.title || "Devo set"} — ${roleLabel(r.role)}`}
                  when={`${formatDateLabel(r.set!.set_date)} · ${formatTimeRange(r.set!.start_time, r.set!.end_time)}`}
                  status={r.set!.status}
                  onClick={() => setSelectedId(r.set!.id)}
                />
              ))}
          </div>
        )}
      </section>

      <SetDetail
        setId={selectedId}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        userId={userId}
        isStaff={isStaff}
        onChanged={load}
      />
    </div>
  );
}

function SetRowButton({ title, when, status, onClick }: { title: string; when: string; status: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:border-primary/50 hover:bg-accent"
    >
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{when}</div>
      </div>
      {status !== "scheduled" && (
        <Badge variant="secondary" className="capitalize">
          {status}
        </Badge>
      )}
    </button>
  );
}
