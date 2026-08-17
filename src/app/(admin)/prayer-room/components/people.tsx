"use client";

/**
 * The People tab — design frame 10a.
 *
 * A third tab beside the week and the day: everyone who has been evaluated,
 * what they are signed off for, how much they are carrying and where they are
 * next. This is the list every seat-filling picker draws from, which is why it
 * shows qualification state rather than the old directory's contact cards.
 *
 * Replaces `directory.tsx`, which was a grid of bordered cards keyed on skill
 * labels and had no notion of sign-off, load or what someone is on next.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { NeedsYou, Initials, StatusPill, MastheadButton, type Tone } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import PrayerRoomChrome, { type TabDef, type TabKey } from "./chrome";
import PersonProfile from "./person-profile";
import JoinRequests from "./join-requests";
import { fullName, formatDateLabel, formatTime } from "./helpers";

type SeatType = { id: string; label: string; category: string; is_lead: boolean; sort_order: number };

type RosterRow = {
  user_id: string;
  user: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
  member_status: string;
  is_coordinator: boolean;
  signed_off: string[];
  in_training: string[];
  sets: number;
  next: { set_id: string; set_date: string; start_time: string; title: string | null; seat: string | null } | null;
};

/**
 * The chips in 10a are seat CATEGORIES, not seats — "worship" covers keys,
 * vocals and the rest without listing ten of them across the rule.
 */
const CATEGORY_LABEL: Record<string, string> = {
  lead: "Leads",
  worship: "Worship",
  intercession: "Intercession",
  tech: "Sound",
};

function rowState(r: RosterRow): { label: string; tone: Tone } {
  if (r.member_status === "on_break") return { label: "On a break", tone: "quiet" };
  if (r.member_status === "archived") return { label: "Archived", tone: "quiet" };
  if (r.signed_off.length > 0) return { label: "Approved", tone: "good" };
  if (r.in_training.length > 0) return { label: "In training", tone: "warn" };
  return { label: "Not evaluated", tone: "quiet" };
}

export default function People({
  tabs,
  active,
  onChange,
  isEvaluator,
  isStaff,
  myName,
}: {
  tabs: TabDef[];
  active: TabKey;
  onChange: (key: TabKey) => void;
  isEvaluator: boolean;
  isStaff: boolean;
  /** Whose name a sign-off is recorded under, on the person screen. */
  myName: string;
}) {
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [seatTypes, setSeatTypes] = useState<SeatType[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [showRequests, setShowRequests] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [peopleRes, reqRes] = await Promise.all([
        fetch("/api/prayer-room/people"),
        fetch("/api/prayer-room/requests?kind=seat&state=pending"),
      ]);
      const data = peopleRes.ok ? await peopleRes.json() : { roster: [], seatTypes: [] };
      setRoster(data.roster ?? []);
      setSeatTypes(data.seatTypes ?? []);
      const reqs = reqRes.ok ? await reqRes.json() : [];
      setPending(Array.isArray(reqs) ? reqs.length : 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const seatLabel = useMemo(() => new Map(seatTypes.map((s) => [s.id, s.label])), [seatTypes]);
  const seatCategory = useMemo(() => new Map(seatTypes.map((s) => [s.id, s.category])), [seatTypes]);

  const categories = useMemo(() => {
    const seen = new Set(seatTypes.map((s) => s.category));
    return ["lead", "worship", "intercession", "tech"].filter((c) => seen.has(c));
  }, [seatTypes]);

  const approved = roster.filter((r) => r.signed_off.length > 0).length;
  const training = roster.filter((r) => r.signed_off.length === 0 && r.in_training.length > 0).length;

  const rows = roster
    .filter((r) => (search ? fullName(r.user).toLowerCase().includes(search.toLowerCase()) : true))
    .filter((r) =>
      category === "all"
        ? true
        : [...r.signed_off, ...r.in_training].some((id) => seatCategory.get(id) === category)
    );

  const context = [
    `${approved} approved`,
    `${training} in training`,
    `${pending} ${pending === 1 ? "request" : "requests"} waiting`,
  ]
    .join(" · ")
    .toUpperCase();

  // 11a is its own screen, with a breadcrumb where the tabs were — so it
  // replaces the roster rather than floating over it.
  if (openPerson) {
    return (
      <PersonProfile
        userId={openPerson}
        onBack={() => setOpenPerson(null)}
        canEvaluate={isEvaluator || isStaff}
        isStaff={isStaff}
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
          <>
            <MastheadButton tone="outline" onClick={() => searchRef.current?.focus()}>
              Find someone
            </MastheadButton>
            {isStaff && <MastheadButton onClick={() => onChange("manage")}>+ Approve someone</MastheadButton>}
          </>
        }
      />

      {/* Seat-category filters. 10a hangs these off the tab rule; the system's
          established filter row is the bone strip, and it survives a phone. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-bone px-5 py-3 md:px-8">
        <div className="flex flex-wrap gap-1.5">
          {["all", ...categories].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "px-2.5 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em]",
                category === c ? "bg-ink text-white" : "border border-rule-strong text-[color:var(--text-secondary)]"
              )}
            >
              {c === "all" ? "All seats" : CATEGORY_LABEL[c] ?? c}
            </button>
          ))}
        </div>
        <div className="ml-auto w-full max-w-xs">
          <Input
            ref={searchRef}
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
      </div>

      <div className="border-b border-ink">
        {/* Column header — the black rule from 10a. Hidden on phones, where the
            row collapses to name + state and a header would label nothing. */}
        <div className="hidden bg-ink px-8 py-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#C5C2AE] lg:grid lg:grid-cols-[minmax(210px,1.1fr)_minmax(200px,1.3fr)_64px_minmax(170px,1.2fr)_118px] lg:gap-4">
          <span>Person</span>
          <span>Signed off for</span>
          <span className="text-right">Sets</span>
          <span>Next on</span>
          <span className="text-right">State</span>
        </div>

        {loading ? (
          <p className="mono-label py-16 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mono-label py-16 text-center">Nobody matches</p>
        ) : (
          rows.map((r) => {
            const state = rowState(r);
            return (
              <button
                key={r.user_id}
                type="button"
                onClick={() => setOpenPerson(r.user_id)}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-surface-4 px-5 py-3 text-left hover:bg-[#F7F5EE] md:px-8 lg:grid-cols-[minmax(210px,1.1fr)_minmax(200px,1.3fr)_64px_minmax(170px,1.2fr)_118px] lg:gap-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Initials name={fullName(r.user)} size={32} />
                  <span className="truncate text-[14.5px] font-bold text-ink">{fullName(r.user)}</span>
                </div>

                <div className="col-span-2 flex flex-wrap gap-1 lg:col-span-1 lg:order-none">
                  {r.signed_off.length === 0 ? (
                    <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-[color:var(--text-quiet)]">
                      Nothing signed off
                    </span>
                  ) : (
                    r.signed_off.map((id) => (
                      <span
                        key={id}
                        className="border border-rule bg-surface-3 px-1.5 py-1 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-secondary)]"
                      >
                        {seatLabel.get(id) ?? id}
                      </span>
                    ))
                  )}
                </div>

                <div className="hidden text-right lg:block">
                  <span className="numeral text-[19px]">{r.sets}</span>
                </div>

                <div
                  className={cn(
                    "hidden truncate text-[13px] lg:block",
                    r.next ? "text-ink" : "text-[color:var(--text-quiet)]"
                  )}
                >
                  {r.next
                    ? `${formatDateLabel(r.next.set_date)} ${formatTime(r.next.start_time)} · ${r.next.title || "Devo set"}`
                    : "Nothing booked"}
                </div>

                <div className="text-right">
                  <StatusPill tone={state.tone}>{state.label}</StatusPill>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* The page's ONE yellow band. */}
      {pending > 0 && (
        <NeedsYou
          action={
            <button
              type="button"
              onClick={() => setShowRequests(true)}
              className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink"
            >
              Review requests →
            </button>
          }
        >
          {pending === 1
            ? "1 person has asked to join a set you lead."
            : `${pending} people have asked to join a set you lead.`}
        </NeedsYou>
      )}

      <JoinRequests
        open={showRequests}
        onClose={() => setShowRequests(false)}
        seatLabel={(id) => seatLabel.get(id) ?? id}
        onDecided={load}
      />
    </>
  );
}
