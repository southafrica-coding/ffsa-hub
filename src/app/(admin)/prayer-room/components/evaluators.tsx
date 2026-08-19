"use client";

/**
 * The evaluators' portal — design frames 12a and 12b.
 *
 * Its own tab, which only appears if your hub profile carries the evaluator
 * permission. Previously this was a "Seat evaluations" block bolted on top of
 * the applications list inside the Evaluations tab; 12a makes it the screen.
 *
 * People ask to be evaluated for a seat; the queue shows what they have
 * actually done so far, so the call is not made blind. Sign off on the spot
 * (13a's two-note form) or book a session to watch them.
 *
 * The applications pipeline — "should this person join the room at all" —
 * stays below the fold: it is a different question from "may they hold this
 * seat", and it is live.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Drawer,
  Initials,
  NeedsYou,
  SectionBar,
  StatusPill,
  type Tone,
} from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import PrayerRoomChrome, { type TabDef, type TabKey } from "./chrome";
import EvaluationForm from "./evaluation-form";
import PersonProfile from "./person-profile";
import BandCuration from "./band-curation";
import Evaluations from "./evaluations";
import { fullName, type Person } from "./helpers";

type SeatType = { id: string; label: string; category: string; is_lead: boolean; sort_order: number };

type QueueRow = {
  id: string;
  user_id: string;
  seat_type_id: string;
  state: "waiting" | "booked";
  note: string | null;
  scheduled_at: string | null;
  created_at: string;
  user: Person;
  evaluator: Person;
  /** Filled seats held all time — "what they've actually done so far". */
  load: number;
  holds: string[];
};

type EvaluatorRow = { user_id: string; user: Person; scope: string | null };

const SCOPE_LABEL: Record<string, string> = {
  all: "All seats",
  lead: "Lead seats",
  worship: "Worship seats",
  intercession: "Intercession seats",
  tech: "Sound",
};

function waitingDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function askedLabel(iso: string): string {
  const d = waitingDays(iso);
  if (d === 0) return "Asked today";
  if (d === 1) return "Asked yesterday";
  return `Asked ${d} days ago`;
}

/**
 * The three states in 12a, derived rather than stored:
 *   READY           — a session is booked, so there is something to watch.
 *   TOO EARLY       — they have never held a seat; there is nothing to judge.
 *   NEEDS A SESSION — they have served, and nobody has arranged to watch them.
 */
function queueState(r: QueueRow): { label: string; tone: Tone } {
  if (r.state === "booked") return { label: "Ready", tone: "good" };
  if (r.load === 0) return { label: "Too early", tone: "quiet" };
  return { label: "Needs a session", tone: "warn" };
}

export default function EvaluatorsPortal({
  tabs,
  active,
  onChange,
  userId,
  myName,
}: {
  tabs: TabDef[];
  active: TabKey;
  onChange: (key: TabKey) => void;
  userId: string;
  /** Whose name a sign-off is recorded under. */
  myName: string;
}) {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [booked, setBooked] = useState<QueueRow[]>([]);
  const [evaluators, setEvaluators] = useState<EvaluatorRow[]>([]);
  const [seatTypes, setSeatTypes] = useState<SeatType[]>([]);
  const [me, setMe] = useState<{ staff: boolean; evaluator: boolean; scope: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState<QueueRow | null>(null);
  const [booking, setBooking] = useState<QueueRow | null>(null);
  const [when, setWhen] = useState("");
  // Members carrying no signed-off seat at all. Migration 181 made a seat the
  // thing that lets someone put a set on the wall, so everyone who joined
  // before it has to be signed off by hand — this is where that happens.
  const [unsigned, setUnsigned] = useState<{ user_id: string; name: string }[]>([]);
  const [signingOff, setSigningOff] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prayer-room/evaluators");
      const d = res.ok ? await res.json() : {};
      setQueue(d.queue ?? []);
      setBooked(d.booked ?? []);
      setEvaluators(d.evaluators ?? []);
      setSeatTypes(d.seatTypes ?? []);
      setMe(d.me ?? null);

      const peopleRes = await fetch("/api/prayer-room/people");
      const people = peopleRes.ok ? await peopleRes.json() : { roster: [] };
      setUnsigned(
        (people.roster ?? [])
          .filter((r: { signed_off: string[] }) => (r.signed_off ?? []).length === 0)
          .map((r: { user_id: string; user: Person }) => ({ user_id: r.user_id, name: fullName(r.user) }))
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const seatLabel = useMemo(() => new Map(seatTypes.map((s) => [s.id, s.label])), [seatTypes]);
  const label = (id: string) => seatLabel.get(id) ?? id;

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    try {
      const res = await fetch("/api/prayer-room/requests?kind=eval", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Could not update");
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  }

  // The longest-waiting ask, which is what the yellow band is for.
  const oldest = queue.filter((r) => r.state === "waiting").sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  const context = [
    `${queue.length} waiting`,
    `${booked.length} sessions booked`,
    `${evaluators.length} evaluators`,
  ]
    .join(" · ")
    .toUpperCase();

  if (signingOff) {
    return (
      <PersonProfile
        userId={signingOff}
        onBack={() => {
          setSigningOff(null);
          load();
        }}
        canEvaluate
        isStaff={!!me?.staff}
        evaluatorName={myName}
        onChanged={load}
      />
    );
  }

  return (
    <>
      <PrayerRoomChrome
        context={context}
        tabs={tabs}
        active={active}
        onChange={onChange}
        actions={
          me && (
            <span className="flex items-center gap-2 border border-ink bg-bone px-3 py-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink">
              <span className="h-2.5 w-2.5 bg-ink" />
              {me.staff && !me.evaluator ? "Prayer room staff" : "You're an evaluator"} ·{" "}
              {SCOPE_LABEL[me.scope ?? "all"] ?? me.scope}
            </span>
          )
        }
      />

      <div className="grid xl:grid-cols-[1fr_400px]">
        {/* ── the queue ─────────────────────────────── */}
        <div className="flex flex-col xl:border-r xl:border-ink">
          <SectionBar title="Asking to be evaluated" meta="Oldest first" />

          {loading ? (
            <p className="mono-label py-16 text-center">Loading…</p>
          ) : queue.length === 0 ? (
            <p className="mono-label py-16 text-center">Nobody is waiting</p>
          ) : (
            queue.map((r) => {
              const state = queueState(r);
              return (
                <div key={r.id} className="border-b border-surface-4 px-5 py-4 md:px-7">
                  <div className="flex items-center gap-3.5">
                    <Initials name={fullName(r.user)} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-[15px] font-bold text-ink">{fullName(r.user)}</span>
                        <span className="border border-rule bg-surface-3 px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
                          {label(r.seat_type_id)}
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[color:var(--text-quiet)]">
                        {askedLabel(r.created_at)} · {r.load} {r.load === 1 ? "set" : "sets"}
                        {r.holds.length > 0 && ` · ${r.holds.map(label).join(", ")}`}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <StatusPill tone={state.tone}>{state.label}</StatusPill>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2.5 md:pl-[47px]">
                    <span className="min-w-0 flex-1 text-[13px] text-[color:var(--text-secondary)]">
                      {r.note || "No note."}
                    </span>
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => setEvaluating(r)}
                      className="shrink-0 bg-ink px-2.5 py-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-white"
                    >
                      Evaluate
                    </button>
                    {r.state === "waiting" && (
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => {
                          setBooking(r);
                          setWhen("");
                        }}
                        className="shrink-0 border border-rule-strong px-2.5 py-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-secondary)]"
                      >
                        Book a session
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}

          <div className="flex-1" />

          {/* The screen's ONE yellow band. */}
          {oldest && waitingDays(oldest.created_at) >= 7 && (
            <NeedsYou
              action={
                <button
                  type="button"
                  onClick={() => {
                    setBooking(oldest);
                    setWhen("");
                  }}
                  className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink"
                >
                  Book them in →
                </button>
              }
            >
              {fullName(oldest.user)} has been waiting {waitingDays(oldest.created_at)} days for a{" "}
              {label(oldest.seat_type_id).toLowerCase()} evaluation.
            </NeedsYou>
          )}
        </div>

        {/* ── sessions + who can evaluate ───────────── */}
        <div className="flex flex-col border-t border-ink xl:border-t-0">
          <SectionBar title="Sessions booked" meta={`${booked.length}`} />
          {booked.length === 0 ? (
            <p className="mono-label px-5 py-8 text-center">Nothing booked</p>
          ) : (
            booked.map((b) => (
              <div key={b.id} className="border-b border-surface-4 px-5 py-3.5">
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink">
                    {b.scheduled_at
                      ? new Date(b.scheduled_at).toLocaleString("en-GB", {
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Time to be set"}
                  </span>
                  <span className="shrink-0 border border-rule-strong px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
                    {label(b.seat_type_id)}
                  </span>
                </div>
                <div className="mt-1 text-[14px] font-bold text-ink">{fullName(b.user)}</div>
                <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[color:var(--text-quiet)]">
                  Watched by {fullName(b.evaluator) === "Unknown" ? "an evaluator" : fullName(b.evaluator)}
                </div>
              </div>
            ))
          )}

          <SectionBar title="Who can evaluate" meta={`${evaluators.length}`} />
          {evaluators.map((e) => (
            <div key={e.user_id} className="flex items-center gap-2.5 border-b border-surface-4 px-5 py-2.5">
              <Initials name={fullName(e.user)} size={28} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">
                {fullName(e.user)}
                {e.user_id === userId && (
                  <span className="ml-1.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-[color:var(--text-quiet)]">
                    you
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
                {SCOPE_LABEL[e.scope ?? "all"] ?? e.scope}
              </span>
            </div>
          ))}

          <div className="flex flex-1 flex-col justify-end bg-bone px-5 py-5">
            <div className="mono-label mb-2">How someone becomes one</div>
            <p className="text-[13px] leading-[1.55] text-ink">
              The evaluator permission is granted on a person&apos;s hub profile under Users &amp; Roles,
              and can be scoped to worship seats, intercession seats or everything. Evaluators also
              curate the three bands.
            </p>
            {me?.staff && (
              <Link
                href="/users"
                className="mt-3.5 self-start border border-ink px-3 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink hover:bg-white"
              >
                Open users &amp; roles →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Everyone who is a member but signed off for nothing. Until an
          evaluator records what they can do, they cannot put a set on the
          wall — so this list is the queue that clears that. */}
      {unsigned.length > 0 && (
        <div className="border-t border-ink">
          <SectionBar
            title="Nobody has signed these people off"
            meta={`${unsigned.length} waiting on you`}
          />
          <p className="border-b border-surface-4 px-5 py-3.5 text-[13px] leading-[1.55] text-[color:var(--text-secondary)] md:px-7">
            They are members, but carry no signed-off seat — so they cannot put a set on the wall
            yet. Open one and record what they are approved for.
          </p>
          {unsigned.map((u) => (
            <div
              key={u.user_id}
              className="flex items-center gap-3 border-b border-surface-4 px-5 py-2.5 md:px-7"
            >
              <Initials name={u.name} size={28} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{u.name}</span>
              <button
                type="button"
                onClick={() => setSigningOff(u.user_id)}
                className="shrink-0 bg-ink px-2.5 py-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-white"
              >
                Sign off →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── 12b: curating the bands, and who sees a note ── */}
      <div className="grid gap-6 border-t border-ink px-5 py-7 md:px-8 xl:grid-cols-[1fr_470px]">
        <BandCuration canCreate={!!me?.staff} />
        <NotePrivacy />
      </div>

      {/* ── the join-the-room pipeline, unchanged in substance ── */}
      <div className="border-t border-ink px-5 py-7 md:px-8">
        <div className="mono-label mb-4">Joining the room at all</div>
        <Evaluations userId={userId} />
      </div>

      {/* two-note form (13a) */}
      <Drawer open={!!evaluating} onClose={() => setEvaluating(null)} label="Record an evaluation">
        {evaluating && (
          <div className="px-6 py-6">
            <EvaluationForm
              userId={evaluating.user_id}
              personName={fullName(evaluating.user)}
              seatTypeId={evaluating.seat_type_id}
              seatLabel={label(evaluating.seat_type_id)}
              onCancel={() => setEvaluating(null)}
              onSaved={async () => {
                // The ask is answered once the evaluation exists.
                await patch(evaluating.id, { state: "done" });
                setEvaluating(null);
              }}
            />
          </div>
        )}
      </Drawer>

      {/* book a session to watch them */}
      <Drawer open={!!booking} onClose={() => setBooking(null)} label="Book a session">
        {booking && (
          <>
            <div className="flex-1 space-y-4 px-6 py-6">
              <div>
                <div className="mono-label">Watching</div>
                <div className="font-display text-[26px] font-black uppercase leading-none text-ink">
                  {fullName(booking.user)}
                </div>
                <div className="mono-label mt-1.5">{label(booking.seat_type_id)}</div>
              </div>
              <div>
                <label htmlFor="pr-when" className="mono-label mb-1.5 block">
                  When
                </label>
                <input
                  id="pr-when"
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="w-full border border-rule-strong px-3 py-2.5 text-[14px]"
                />
              </div>
              <p className="text-[12.5px] leading-[1.5] text-[color:var(--text-tertiary)]">
                Booking a session does not sign anyone off. It says an evaluator has arranged to watch
                them, and moves the ask out of the waiting queue.
              </p>
            </div>
            <div className="border-t border-surface-4 px-6 py-4">
              <button
                type="button"
                disabled={!when || busy === booking.id}
                onClick={async () => {
                  const ok = await patch(booking.id, {
                    state: "booked",
                    scheduled_at: new Date(when).toISOString(),
                  });
                  if (ok) {
                    toast.success("Session booked");
                    setBooking(null);
                  }
                }}
                className="w-full bg-ink px-4 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white disabled:opacity-40"
              >
                Book the session →
              </button>
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}

/**
 * Frame 12b, right column — the same seat rendered for three readers, so the
 * privacy rule is visible to evaluators rather than assumed by them.
 *
 * It is a statement of the rule, not a live record: the rule itself is enforced
 * by RLS and the `prayer_room_my_evaluations` view (migration 169).
 */
function NotePrivacy() {
  const rows: { who: string; badge: string; body: React.ReactNode; muted?: boolean }[] = [
    {
      who: "What an evaluator sees",
      badge: "Full record",
      body: (
        <div className="border-l-2 border-yellow pl-3">
          <p className="text-[13.5px] leading-[1.5] text-ink">
            The state, the feedback written for the person, and the evaluators-only note.
          </p>
        </div>
      ),
    },
    {
      who: "What they see on themselves",
      badge: "Full record",
      body: (
        <>
          <div className="border-l-2 border-yellow pl-3">
            <p className="text-[13.5px] leading-[1.5] text-ink">
              The state and the feedback written for them.
            </p>
          </div>
          <p className="mt-3 text-[12.5px] text-[color:var(--text-tertiary)]">
            They can read everything written to them. Nobody else can, apart from evaluators.
          </p>
        </>
      ),
    },
    {
      who: "What a set lead sees",
      badge: "State only",
      muted: true,
      body: (
        <div className="border border-dashed border-rule p-3 text-[12.5px] text-[color:var(--text-quiet)]">
          Evaluation notes are private to evaluators and to the person they are about.
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {rows.map((r) => (
        <div key={r.who} className="border border-ink bg-white">
          <div className="flex items-center justify-between bg-ink px-5 py-2.5">
            <span
              className={cn(
                "font-mono text-[9px] font-bold uppercase tracking-[0.18em]",
                r.muted ? "text-[#C5C2AE]" : "text-yellow"
              )}
            >
              {r.who}
            </span>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-[#8E8A7C]">
              {r.badge}
            </span>
          </div>
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center gap-3">
              <span className="min-w-[104px] font-display text-[22px] font-black uppercase leading-none text-ink">
                Prayer lead
              </span>
              <StatusPill tone="warn">In training</StatusPill>
            </div>
            {r.body}
          </div>
        </div>
      ))}
    </div>
  );
}
