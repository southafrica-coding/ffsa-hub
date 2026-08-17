"use client";

/**
 * A person, and how they get signed off — design frame 11a.
 *
 * Opens from any name in the roster and replaces it, which is why it carries a
 * breadcrumb rather than the module tabs: 11a is its own screen.
 *
 * Qualification is per seat and always carries who signed it off, when, and
 * what they said — approval is a record with a name on it, not a checkbox. In
 * training is a first-class state, not the absence of one.
 *
 * What comes back in `record` is decided by the policies from migration 169,
 * not by this component. A set lead sees the states and no notes, which is
 * frame 12b's third card; an evaluator and the subject see the note.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SectionBar, KpiStrip, Kpi, StatusPill, MastheadButton, type Tone } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import { fullName, formatDateLabel, formatTimeRange } from "./helpers";

type QualState = "not_evaluated" | "in_training" | "signed_off";

type SeatRecord = {
  seat_type_id: string;
  label: string;
  category: string;
  is_lead: boolean;
  state: QualState;
  record: { by: string | null; on: string; feedback: string | null } | null;
};

type Profile = {
  user: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
  member: { status: string; created_at: string | null; evaluator_scope: string | null } | null;
  seats: SeatRecord[];
  kpis: {
    sets: number;
    minutes_this_month: number;
    signed_off: number;
    seat_count: number;
    last: { set_date: string; title: string | null; seat: string | null } | null;
  };
  upcoming: {
    set_id: string;
    set_date: string;
    start_time: string;
    end_time: string;
    title: string | null;
    seat: string | null;
  }[];
};

const STATE_LABEL: Record<QualState, string> = {
  signed_off: "Signed off",
  in_training: "In training",
  not_evaluated: "Not evaluated",
};
const STATE_TONE: Record<QualState, Tone> = {
  signed_off: "good",
  in_training: "warn",
  not_evaluated: "quiet",
};

const MEMBER_LABEL: Record<string, string> = {
  active: "Approved",
  on_break: "On a break",
  archived: "Archived",
};

export default function PersonProfile({
  userId,
  onBack,
  canEvaluate,
  isStaff,
  evaluatorName,
  onChanged,
}: {
  userId: string;
  onBack: () => void;
  canEvaluate: boolean;
  isStaff: boolean;
  /** Whose name the sign-off is recorded under — 11a prints it under the button. */
  evaluatorName: string;
  onChanged?: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // sign-off panel
  const [seat, setSeat] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"in_training" | "signed_off">("signed_off");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prayer-room/people/${userId}`);
      setProfile(res.ok ? await res.json() : null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const name = fullName(profile?.user ?? null);
  const seats = profile?.seats ?? [];
  const openSeats = seats.filter((s) => s.state !== "signed_off");
  const heldSeats = seats.filter((s) => s.state === "signed_off");

  // Default the panel to the first seat that is not already signed off.
  useEffect(() => {
    if (seat === null && openSeats.length > 0) setSeat(openSeats[0].seat_type_id);
  }, [seat, openSeats]);

  async function saveSignOff() {
    if (!seat) return;
    setBusy("signoff");
    try {
      const res = await fetch("/api/prayer-room/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          seat_type_id: seat,
          outcome,
          feedback: feedback.trim() || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Could not record the sign-off");
        return;
      }
      toast.success(outcome === "signed_off" ? "Signed off" : "Marked in training");
      setFeedback("");
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  async function setMemberStatus(status: string) {
    setBusy("status");
    try {
      const res = await fetch("/api/prayer-room/members", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, action: "status", value: status }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Could not update");
        return;
      }
      toast.success(status === "on_break" ? "Paused from sets" : "Back on sets");
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  async function message() {
    setBusy("message");
    try {
      const res = await fetch(`/api/prayer-room/members?contactFor=${userId}`);
      const c = res.ok ? await res.json() : null;
      if (c?.email) window.location.href = `mailto:${c.email}`;
      else toast.error("No email on file");
    } finally {
      setBusy(null);
    }
  }

  const memberStatus = profile?.member?.status ?? "active";
  const seatOnPanel = seats.find((s) => s.seat_type_id === seat) ?? null;

  return (
    <div>
      {/* breadcrumb — 11a's replacement for the tab strip */}
      <div className="border-b border-surface-4 px-5 py-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--text-tertiary)] md:px-8">
        Prayer room /{" "}
        <button type="button" onClick={onBack} className="hover:text-ink">
          People
        </button>{" "}
        / <span className="font-bold text-ink">{name}</span>
      </div>

      {/* identity */}
      <div className="flex flex-col gap-4 border-b border-ink px-5 py-6 md:flex-row md:items-start md:justify-between md:px-8">
        <div className="flex items-center gap-[18px]">
          <span
            className="avatar-square shrink-0"
            style={{ width: 76, height: 76, fontSize: 28 }}
          >
            {name
              .split(" ")
              .map((w) => w[0])
              .slice(0, 3)
              .join("")}
          </span>
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
              <StatusPill tone={memberStatus === "active" ? "good" : "quiet"}>
                {MEMBER_LABEL[memberStatus] ?? memberStatus}
              </StatusPill>
              {profile?.member?.created_at && (
                <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">
                  Joined{" "}
                  {new Date(profile.member.created_at).toLocaleDateString("en-GB", {
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>
            <h1 className="masthead-title">{loading ? "Loading…" : name}</h1>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          {isStaff && (
            <MastheadButton
              tone="outline"
              onClick={() => setMemberStatus(memberStatus === "on_break" ? "active" : "on_break")}
            >
              {busy === "status"
                ? "Saving…"
                : memberStatus === "on_break"
                  ? "Return to sets"
                  : "Pause from sets"}
            </MastheadButton>
          )}
          <MastheadButton tone="outline" onClick={message}>
            Message
          </MastheadButton>
        </div>
      </div>

      {/* the four figures */}
      <KpiStrip>
        <Kpi label="Sets served" value={String(profile?.kpis.sets ?? 0)} lead />
        <Kpi
          label="Hours this month"
          value={String(Math.round((profile?.kpis.minutes_this_month ?? 0) / 60))}
          tick={false}
        />
        <Kpi
          label="Seats signed off"
          value={`${profile?.kpis.signed_off ?? 0}`}
          foot={`of ${profile?.kpis.seat_count ?? 0} seats`}
          tick={false}
          bar={{
            pct: profile?.kpis.seat_count
              ? (profile.kpis.signed_off / profile.kpis.seat_count) * 100
              : 0,
            tone: "#3E7F2B",
          }}
        />
        <Kpi
          label="Last served"
          value={profile?.kpis.last ? formatDateLabel(profile.kpis.last.set_date) : "—"}
          foot={
            profile?.kpis.last
              ? [profile.kpis.last.title, profile.kpis.last.seat].filter(Boolean).join(" · ").toUpperCase()
              : "Nothing yet"
          }
          size={30}
          tick={false}
        />
      </KpiStrip>

      <div className={cn("grid", canEvaluate && "xl:grid-cols-[1fr_420px]")}>
        {/* seats + coming up */}
        <div className={cn(canEvaluate && "xl:border-r xl:border-ink")}>
          <SectionBar
            title="Seats"
            meta={`${heldSeats.length} signed off · ${seats.filter((s) => s.state === "in_training").length} in training`}
          />
          {seats.length === 0 ? (
            <p className="mono-label px-5 py-10 text-center md:px-8">
              {loading ? "Loading…" : "No seat vocabulary yet"}
            </p>
          ) : (
            seats.map((s) => (
              <div key={s.seat_type_id} className="border-b border-surface-4 px-5 py-3.5 md:px-8">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-[120px] font-display text-[24px] font-black uppercase leading-none text-ink">
                    {s.label}
                  </span>
                  <StatusPill tone={STATE_TONE[s.state]}>{STATE_LABEL[s.state]}</StatusPill>
                  <span className="flex-1" />
                  {s.record ? (
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-[color:var(--text-tertiary)]">
                      {s.record.by ?? "An evaluator"} ·{" "}
                      {new Date(s.record.on).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                  ) : canEvaluate && s.state === "not_evaluated" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSeat(s.seat_type_id);
                        setOutcome("in_training");
                      }}
                      className="border border-ink px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-ink"
                    >
                      Start training
                    </button>
                  ) : null}
                </div>
                {s.record?.feedback && (
                  <p className="mt-2 max-w-[640px] text-[13.5px] leading-[1.5] text-[color:var(--text-secondary)] md:pl-[132px]">
                    {s.record.feedback}
                  </p>
                )}
              </div>
            ))
          )}

          <div className="border-b border-surface-4 bg-bone px-5 py-[18px] md:px-8">
            <div className="mono-label mb-2">Signing off a seat</div>
            <p className="max-w-[640px] text-[13.5px] leading-[1.55] text-ink">
              Worship lead and prayer lead are separate sign-offs — holding one says nothing about the
              other. Only evaluators can grant either, and only within the scope on their hub profile.
            </p>
          </div>

          <SectionBar title="Coming up" meta={`${profile?.upcoming.length ?? 0}`} />
          {(profile?.upcoming.length ?? 0) === 0 ? (
            <p className="mono-label px-5 py-8 text-center md:px-8">Nothing booked</p>
          ) : (
            profile!.upcoming.map((u) => (
              <div
                key={u.set_id + u.seat}
                className="flex flex-wrap items-center gap-4 border-b border-surface-4 px-5 py-3 md:px-8"
              >
                <span className="w-[88px] shrink-0 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-tertiary)]">
                  {formatDateLabel(u.set_date)}
                </span>
                <span className="w-[106px] shrink-0 font-mono text-[11px] font-bold text-ink">
                  {formatTimeRange(u.start_time, u.end_time)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">
                  {u.title || "Devo set"}
                </span>
                {u.seat && (
                  <span className="border border-rule-strong px-1.5 py-1 font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
                    {seats.find((s) => s.seat_type_id === u.seat)?.label ?? u.seat}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* sign-off panel */}
        {canEvaluate && (
          <div className="flex flex-col">
            <div className="border-b border-ink bg-yellow px-5 py-[18px] md:px-6">
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-ink">
                Sign off a seat
              </div>
              <div className="mt-1.5 font-display text-[26px] font-black uppercase leading-[1.02] text-ink">
                You&apos;re vouching
                <br />
                for them
              </div>
            </div>

            <div className="border-b border-surface-4 px-5 py-[18px] md:px-6">
              <div className="mono-label mb-2.5">Which seat</div>
              <div className="flex flex-wrap gap-1.5">
                {openSeats.length === 0 ? (
                  <span className="text-[13px] text-[color:var(--text-tertiary)]">
                    Every seat is already signed off.
                  </span>
                ) : (
                  openSeats.map((s) => (
                    <button
                      key={s.seat_type_id}
                      type="button"
                      onClick={() => setSeat(s.seat_type_id)}
                      className={cn(
                        "px-2.5 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em]",
                        seat === s.seat_type_id
                          ? "bg-ink text-white"
                          : "border border-rule-strong text-[color:var(--text-secondary)]"
                      )}
                    >
                      {s.label}
                    </button>
                  ))
                )}
              </div>
              {heldSeats.length > 0 && (
                <div className="mt-2.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[color:var(--text-quiet)]">
                  {heldSeats.map((s) => s.label).join(", ")}{" "}
                  {heldSeats.length === 1 ? "is" : "are"} already signed off
                </div>
              )}
            </div>

            <div className="border-b border-surface-4 px-5 py-[18px] md:px-6">
              <div className="mono-label mb-2.5">Where they&apos;re at</div>
              <div className="flex gap-1.5">
                {(["in_training", "signed_off"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOutcome(o)}
                    className={cn(
                      "flex-1 px-2 py-2.5 text-center font-mono text-[10px] font-bold uppercase tracking-[0.08em]",
                      outcome === o
                        ? "bg-ink text-white"
                        : "border border-rule-strong text-[color:var(--text-secondary)]"
                    )}
                  >
                    {o === "in_training" ? "In training" : "Signed off"}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-b border-surface-4 px-5 py-[18px] md:px-6">
              <div className="mono-label mb-2">What you&apos;ve seen</div>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                placeholder="Co-led two morning sets and held the room well when the band dropped out."
                className="w-full border border-rule-strong px-3 py-3 text-[14px] leading-[1.5] text-[color:var(--text-secondary)]"
              />
              <p className="mt-2 text-[12px] text-[color:var(--text-tertiary)]">
                This shows on their profile and to any lead filling a {seatOnPanel?.label.toLowerCase() ?? "seat"} seat.
              </p>
            </div>

            <div className="flex-1" />

            <div className="border-t border-surface-4 px-5 py-[18px] md:px-6">
              <button
                type="button"
                disabled={!seat || busy === "signoff"}
                onClick={saveSignOff}
                className="w-full bg-ink px-4 py-4 text-center font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white disabled:opacity-40"
              >
                {busy === "signoff"
                  ? "Recording…"
                  : outcome === "signed_off"
                    ? `Sign off for ${seatOnPanel?.label ?? "this seat"} →`
                    : `Mark in training for ${seatOnPanel?.label ?? "this seat"} →`}
              </button>
              <p className="mt-2.5 text-center text-[12px] text-[color:var(--text-tertiary)]">
                Recorded as {evaluatorName} ·{" "}
                {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
