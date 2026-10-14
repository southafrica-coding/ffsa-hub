"use client";

/**
 * Manage → Block-out: Space Bookings of the prayer room that land on devo sets.
 *
 * Each card is one booking (or one weekly series) pre-filled from Space
 * Bookings — the manager only answers "where do the sets go?" and clicks once.
 * Below them, block-outs applied from a booking that has since been cancelled
 * or moved, so a change on the bookings side never drifts silently.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CalendarClock, X } from "lucide-react";
import { dateRangeLabel, timeRangeLabel } from "@/lib/bookings/dates";

export type SuggestionOccurrence = {
  bookingId: string;
  date: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
};
export type BookingSuggestion = {
  key: string;
  title: string;
  description: string | null;
  bookedBy: string | null;
  pointPerson: string | null;
  ministry: string | null;
  occurrences: SuggestionOccurrence[];
  affected: { id: string; title: string; date: string; startTime: string; endTime: string; owner: string | null }[];
};
export type ChangedBlockout = {
  blockout: { id: string; block_date: string; end_date: string; start_time: string | null; end_time: string | null };
  bookingTitle: string;
  change: "cancelled" | "moved";
  now: { date: string; endDate: string; startTime: string | null; endTime: string | null } | null;
};
export type SuggestionsPayload = { suggestions: BookingSuggestion[]; changed: ChangedBlockout[]; venues: string[] };

type SlackOutcome = { ok?: boolean; skipped?: string; error?: string; debug?: { channelLen: number; team: string | null } };

/** One toast for every block-out path — says exactly why Slack did / didn't post. */
export function blockoutToast(moved: string, slack: SlackOutcome | undefined) {
  const diag = slack?.debug ? ` [channel value: ${slack.debug.channelLen} chars; bot workspace: ${slack.debug.team ?? "unknown"}]` : "";
  if (slack?.ok) toast.success(`${moved}. Team notified on Slack.`);
  else if (slack?.skipped) toast.warning(`${moved}. Slack not posted — SLACK_PRAYER_ROOM_CHANNEL_ID isn't set on this deployment yet.`);
  else if (slack?.error === "not_in_channel")
    toast.warning(`${moved}. Slack post failed — invite the bot to the channel (type /invite @FFSA Hub Activity there).${diag}`);
  else if (slack?.error) toast.warning(`${moved}. Slack post failed: ${slack.error}.${diag}`);
  else toast.success(moved);
}

const slotLabel = (o: { date: string; endDate: string; startTime: string | null; endTime: string | null }) =>
  `${dateRangeLabel(o.date, o.endDate === o.date ? null : o.endDate)} · ${
    o.startTime && o.endTime ? timeRangeLabel(o.startTime, o.endTime) : "All day"
  }`;

export default function BookingSuggestions({
  data,
  onChanged,
}: {
  data: SuggestionsPayload;
  onChanged: () => void;
}) {
  if (data.suggestions.length === 0 && data.changed.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          From Space Bookings · {data.suggestions.length + data.changed.length} to action
        </h3>
        <p className="text-xs text-muted-foreground">
          The prayer room was booked over these devo sets. Pick where the sets move to and block it out in one click —
          the team is told on Slack like any other block-out.
        </p>
      </div>
      {data.suggestions.map((s) => (
        <SuggestionCard key={s.key} s={s} venues={data.venues} onDone={onChanged} />
      ))}
      {data.changed.map((c) => (
        <ChangedCard key={c.blockout.id} c={c} onDone={onChanged} />
      ))}
    </section>
  );
}

function SuggestionCard({ s, venues, onDone }: { s: BookingSuggestion; venues: string[]; onDone: () => void }) {
  const [reloc, setReloc] = useState("");
  const [busy, setBusy] = useState<"apply" | "dismiss" | null>(null);
  const bookingIds = s.occurrences.map((o) => o.bookingId);

  async function act(action: "apply" | "dismiss") {
    if (action === "apply" && !reloc.trim()) {
      toast.error("Say where the devo sets are moving to");
      return;
    }
    setBusy(action);
    try {
      const res = await fetch("/api/prayer-room/booking-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, bookingIds, relocation_note: reloc.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      if (action === "apply") {
        blockoutToast(
          `Blocked out — ${data.affected} set${data.affected === 1 ? "" : "s"} moved to ${reloc.trim()}`,
          data.slack
        );
      } else {
        toast.success("Dismissed — it'll come back only if the booking's date or time changes");
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const shown = s.occurrences.slice(0, 4);
  return (
    <div className="rounded-lg border border-amber-500/60 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="text-sm font-semibold">{s.title}</div>
            <div className="text-xs text-muted-foreground">
              {[s.bookedBy && `Booked by ${s.bookedBy}`, s.ministry, s.pointPerson && `Point person: ${s.pointPerson}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>

          <div className="text-sm">
            {shown.map((o) => (
              <div key={o.bookingId}>{slotLabel(o)}</div>
            ))}
            {s.occurrences.length > shown.length && (
              <div className="text-xs text-muted-foreground">+ {s.occurrences.length - shown.length} more weekly dates</div>
            )}
          </div>

          <div className="text-xs">
            <div className="font-medium text-amber-600 dark:text-amber-400">
              {s.affected.length} devo set{s.affected.length === 1 ? "" : "s"} affected
            </div>
            <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
              {s.affected.slice(0, 6).map((a) => (
                <li key={a.id}>
                  {dateRangeLabel(a.date, null)} · {timeRangeLabel(a.startTime, a.endTime)} — {a.title}
                  {a.owner ? ` (${a.owner})` : ""}
                </li>
              ))}
              {s.affected.length > 6 && <li>+ {s.affected.length - 6} more</li>}
            </ul>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Devo sets move to</Label>
            {venues.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {venues.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setReloc(v)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      reloc === v ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
            <Input
              value={reloc}
              onChange={(e) => setReloc(e.target.value)}
              placeholder="Or type a location, e.g. Office 2 — look for the sign"
              className="max-w-md"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" disabled={busy !== null} onClick={() => act("apply")}>
              {busy === "apply" ? "Blocking out…" : "Block out & notify"}
            </Button>
            <Button size="sm" variant="ghost" className="gap-1" disabled={busy !== null} onClick={() => act("dismiss")}>
              <X className="h-3.5 w-3.5" /> Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChangedCard({ c, onDone }: { c: ChangedBlockout; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const b = c.blockout;
  const was = slotLabel({ date: b.block_date, endDate: b.end_date, startTime: b.start_time, endTime: b.end_time });

  async function run(kind: "keep" | "remove") {
    setBusy(true);
    try {
      const res =
        kind === "keep"
          ? await fetch("/api/prayer-room/booking-suggestions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "keep", blockoutId: b.id }),
            })
          : await fetch(`/api/prayer-room/blockouts?id=${b.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      toast.success(kind === "keep" ? "Block-out kept" : "Block-out removed");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-red-500/50 bg-red-500/5 p-4 text-sm">
      <div className="font-semibold">
        “{c.bookingTitle}” was {c.change === "cancelled" ? "cancelled" : "moved"} in Space Bookings
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Block-out: {was}
        {c.now && <> · booking is now {slotLabel(c.now)}</>}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {c.change === "cancelled"
          ? "The room may be free again. Removing the block-out doesn't move sets back — tell the leaders if they can return."
          : "Keep it if the room is still out then; any new clashes show up as their own card above."}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run("remove")}>
          Remove block-out
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("keep")}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
