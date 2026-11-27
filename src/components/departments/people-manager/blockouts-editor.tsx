"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import pw from "@/components/song-library/pw.module.css";
import { addDays, daysBetween, saHolidayName } from "@/lib/people-manager/days";
import { errorCopy, pmApi, pmPaths } from "./client";
import { dayLabel, isWeekend, monthTitle, rangeLabel } from "./format";
import pm from "./pm.module.css";
import type { PmAway, PmBlockout, PmOverview, PmRequestList } from "./types";
import { BlockTag, Loading, SectionBar } from "./ui";
import { useJson } from "./use-json";

type Sel = { start: string; end: string };

const pad = (n: number) => String(n).padStart(2, "0");
const monthStart = (y: number, m: number) => `${y}-${pad(m + 1)}-01`;
const monthEnd = (y: number, m: number) => addDays(monthStart(m === 11 ? y + 1 : y, (m + 1) % 12), -1);

/** Next selection after tapping a day: first tap starts a range, the second ends it. */
export function nextSelection(sel: Sel | null, awaitingEnd: boolean, day: string): { sel: Sel; awaitingEnd: boolean } {
  if (sel && awaitingEnd) {
    return day >= sel.start ? { sel: { start: sel.start, end: day }, awaitingEnd: false } : { sel: { start: day, end: sel.start }, awaitingEnd: false };
  }
  return { sel: { start: day, end: day }, awaitingEnd: true };
}

/** Whole days only: block-outs have no part of the day (contract). */
export function BlockoutsEditor({ slug }: { slug: string }) {
  const api = useMemo(() => pmApi(slug), [slug]);
  const paths = pmPaths(slug);
  const overview = useJson<PmOverview>(api.urls.overview());
  const today = overview.data?.today ?? null;
  const [ym, setYm] = useState<{ y: number; m: number } | null>(null);
  useEffect(() => {
    if (today && !ym) setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 });
  }, [today, ym]);

  const from = ym ? monthStart(ym.y, ym.m) : null;
  const to = ym ? monthEnd(ym.y, ym.m) : null;
  const blockouts = useJson<{ blockouts: PmBlockout[] }>(overview.data ? api.urls.blockouts() : null);
  const requests = useJson<PmRequestList>(overview.data ? api.urls.requests({ scope: "mine" }) : null);
  const away = useJson<PmAway>(from && to && (overview.data?.me.is_member || overview.data?.me.is_admin) ? api.urls.away(from, to) : null);

  const [sel, setSel] = useState<Sel | null>(null);
  const [awaitingEnd, setAwaitingEnd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const reasonId = useId();

  if (!overview.data || !ym || !from || !to) {
    if (overview.loading || (overview.data && !ym)) return <Loading />;
    return <p className={pm.formError}>{errorCopy(overview.code)}</p>;
  }

  const list = blockouts.data?.blockouts ?? [];
  const leave = (requests.data?.requests ?? []).filter((r) => r.status === "pending" || r.status === "approved");
  const declared = new Map((away.data?.holidays ?? []).map((h) => [h.day, h.name]));
  const holidayOf = (d: string) => declared.get(d) ?? saHolidayName(d);
  const savedOn = (d: string) => list.find((b) => b.start_date <= d && b.end_date >= d) ?? null;
  const leaveOn = (d: string) => leave.find((r) => r.start_date <= d && r.end_date >= d) ?? null;
  const inSel = (d: string) => !!sel && d >= sel.start && d <= sel.end;
  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const selDays = sel ? daysBetween(sel.start, sel.end) + 1 : 0;

  function clear() {
    setSel(null);
    setAwaitingEnd(false);
    setEditingId(null);
    setReason("");
    setCode(null);
  }

  function edit(b: PmBlockout) {
    setEditingId(b.id);
    setSel({ start: b.start_date, end: b.end_date });
    setAwaitingEnd(false);
    setReason(b.reason ?? "");
    setCode(null);
    setSaved(null);
  }

  function tap(day: string) {
    setSaved(null);
    setCode(null);
    if (!sel && !editingId) {
      const existing = savedOn(day);
      if (existing) {
        edit(existing);
        return;
      }
    }
    const next = nextSelection(sel, awaitingEnd, day);
    setSel(next.sel);
    setAwaitingEnd(next.awaitingEnd);
  }

  function shift(delta: number) {
    setYm((cur) => {
      if (!cur) return cur;
      const total = cur.y * 12 + cur.m + delta;
      return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
    });
  }

  async function save() {
    if (!sel) return;
    setBusy(true);
    setCode(null);
    const body = { start_date: sel.start, end_date: sel.end, reason: reason.trim() || null };
    const result = editingId ? await api.updateBlockout(editingId, body) : await api.createBlockout(body);
    setBusy(false);
    if (!result.ok) {
      setCode(result.code);
      return;
    }
    setSaved(editingId ? "Block-out updated." : `Blocked out ${rangeLabel(sel.start, sel.end)}.`);
    clear();
    blockouts.reload();
  }

  async function remove() {
    if (!editingId) return;
    setBusy(true);
    setCode(null);
    const result = await api.deleteBlockout(editingId);
    setBusy(false);
    if (!result.ok) {
      setCode(result.code);
      return;
    }
    setSaved("Block-out removed.");
    clear();
    blockouts.reload();
  }

  const upcoming = list.filter((b) => b.end_date >= overview.data!.today);

  return (
    <>
      <SectionBar title="Block out dates" meta="just for you" />
      <p className={pw.hint}>
        Mark days you can&apos;t serve or work. Block-outs don&apos;t use leave days and don&apos;t need approval. Your leaders see them on the team
        calendar. Whole days only: tap the first day, then the last.
      </p>
      <div className={pm.calhead}>
        <span className={pm.calTitle}>{monthTitle(ym.y, ym.m)}</span>
        <span className={pm.navBtns}>
          <button type="button" aria-label="Previous month" onClick={() => shift(-1)}>
            ‹
          </button>
          <button type="button" aria-label="Next month" onClick={() => shift(1)}>
            ›
          </button>
        </span>
      </div>
      <div className={pm.cal} role="group" aria-label={monthTitle(ym.y, ym.m)}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className={pm.dow} aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} className={`${pm.day} ${pm.dayBlank}`} aria-hidden="true" />
        ))}
        {days.map((d) => {
          const hol = holidayOf(d);
          const lv = leaveOn(d);
          const savedB = savedOn(d);
          const selected = inSel(d);
          const cls = [
            pm.day,
            isWeekend(d) ? pm.dayWe : "",
            savedB && !selected && savedB.id !== editingId ? pm.daySaved : "",
            selected ? pm.daySel : "",
            hol ? pm.dayHol : "",
            lv ? (lv.status === "approved" ? `${pm.dayLeave} ${pm.dayLeaveOk}` : pm.dayLeave) : "",
            d === overview.data!.today ? pm.dayToday : "",
          ]
            .filter(Boolean)
            .join(" ");
          const label = [dayLabel(d), savedB ? "blocked out" : null, lv ? `leave ${lv.status}` : null, hol ? hol : null, selected ? "selected" : null]
            .filter(Boolean)
            .join(", ");
          return (
            <button key={d} type="button" className={cls} aria-pressed={selected || !!savedB} aria-label={label} onClick={() => tap(d)}>
              {Number(d.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <div className={pm.legend}>
        <span>
          <i className={pm.lgSel} />
          Adding now
        </span>
        <span>
          <i className={pm.lgSaved} />
          Saved
        </span>
        <span>
          <i className={pm.lgLv} />
          Leave pending
        </span>
        <span>
          <i className={pm.lgLvOk} />
          Leave approved
        </span>
        <span>
          <i className={pm.lgHol} />
          Public holiday
        </span>
      </div>

      <div style={{ borderTop: "1px solid var(--rule)" }}>
        <div className={pw.field}>
          <span className={pw.label}>{editingId ? "Editing block-out" : "Selected"}</span>
          <div style={{ fontWeight: 700, fontSize: 16 }} aria-live="polite">
            {sel ? `${rangeLabel(sel.start, sel.end)} · ${selDays} ${selDays === 1 ? "day" : "days"}` : "Tap a day on the calendar"}
          </div>
          {sel && awaitingEnd ? <p className={pm.fieldNote}>Tap another day to make it a range, or save this one day.</p> : null}
        </div>
        <div className={pw.field}>
          <label className={pw.label} htmlFor={reasonId}>
            Reason (optional · leaders can see it)
          </label>
          <input id={reasonId} className={pw.input} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} disabled={!sel} />
        </div>
        {editingId ? (
          <div className={pw.pad}>
            <button type="button" className={`${pw.btn} ${pw.block} ${pm.declineBtn}`} onClick={() => void remove()} disabled={busy}>
              Delete this block-out
            </button>
          </div>
        ) : null}
      </div>
      {code ? (
        <p className={pm.formError} role="alert">
          {errorCopy(code)}
        </p>
      ) : null}
      {saved ? (
        <p className={pm.loading} role="status">
          {saved}
        </p>
      ) : null}

      <SectionBar title="Coming up" meta={`${upcoming.length} block-out${upcoming.length === 1 ? "" : "s"}`} />
      {upcoming.length ? (
        upcoming.map((b) => (
          <button key={b.id} type="button" className={pm.rowBtn} aria-pressed={b.id === editingId} onClick={() => edit(b)}>
            <div className={pm.reqTop}>
              <div className={pm.reqWhat}>
                <div className={pm.reqK}>{rangeLabel(b.start_date, b.end_date)}</div>
                <div className={pm.reqS}>{b.reason ?? "No reason given"}</div>
              </div>
              <BlockTag />
            </div>
          </button>
        ))
      ) : blockouts.loading ? (
        <Loading />
      ) : (
        <p className={pm.loading}>Nothing blocked out yet.</p>
      )}

      <div className={pw.savebar}>
        {sel ? (
          <button type="button" className={pw.btn} onClick={clear} disabled={busy}>
            Cancel
          </button>
        ) : (
          <Link className={pw.btn} href={paths.mine}>
            Done
          </Link>
        )}
        <button type="button" className={`${pw.btn} ${pw.primary}`} onClick={() => void save()} disabled={!sel || busy} aria-disabled={!sel || busy}>
          {editingId ? "Save changes" : sel ? `Save ${selDays} ${selDays === 1 ? "day" : "days"}` : "Save"}
        </button>
      </div>
    </>
  );
}
