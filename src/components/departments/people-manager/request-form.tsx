"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import pw from "@/components/song-library/pw.module.css";
import { isIsoDate } from "@/lib/people-manager/days";
import { errorCopy, pmApi, pmPaths } from "./client";
import {
  awayLine,
  calendarCopy,
  firstName,
  fmtDays,
  goesToWords,
  holidayCopy,
  initials,
  projectionCopy,
  shortRange,
  weekdayUnit,
} from "./format";
import pm from "./pm.module.css";
import type { DayPart, PmCreateBody, PmOverview, PmPerson, PmPreview, PmUsageResponse } from "./types";
import { Avatar, Empty, Loading, SectionBar, UsageBar } from "./ui";
import { useJson } from "./use-json";

/** The body sent to /preview and /requests from the form's state. */
export function draftBody(d: {
  typeId: string;
  start: string;
  end: string;
  startPart: DayPart;
  endPart: DayPart;
  notes: string;
  coverId: string;
  coverNote: string;
}): PmCreateBody {
  const oneDay = d.start === d.end;
  return {
    leave_type_id: d.typeId,
    start_date: d.start,
    end_date: d.end,
    // 421's parts rule: one day uses one part; several days may start pm and end am.
    start_part: oneDay ? d.startPart : d.startPart === "pm" ? "pm" : "full",
    end_part: oneDay ? d.startPart : d.endPart === "am" ? "am" : "full",
    notes: d.notes.trim() || null,
    covering_user_id: d.coverId || null,
    covering_note: d.coverNote.trim() || null,
  };
}

/** Other people in the department, by name. */
export function coverChoices(usage: PmUsageResponse | null, viewerId: string): PmPerson[] {
  return (usage?.people ?? [])
    .filter((p) => p.user_id !== viewerId && p.name)
    .map((p) => ({ user_id: p.user_id, name: p.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function RequestForm({ slug }: { slug: string }) {
  const api = useMemo(() => pmApi(slug), [slug]);
  const paths = pmPaths(slug);
  const router = useRouter();
  const overview = useJson<PmOverview>(api.urls.overview());
  // Cover candidates: GET /usage lists the department's people for leaders
  // and admins; a member gets only themselves back, so members name their
  // cover in the note (contract gap: no member-list endpoint).
  const roster = useJson<PmUsageResponse>(overview.data ? api.urls.usage({ year: overview.data.year }) : null);

  const [typeId, setTypeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [startPart, setStartPart] = useState<DayPart>("full");
  const [endPart, setEndPart] = useState<DayPart>("full");
  const [notes, setNotes] = useState("");
  const [coverId, setCoverId] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [preview, setPreview] = useState<PmPreview | null>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendCode, setSendCode] = useState<string | null>(null);
  const ids = { type: useId(), notes: useId(), cover: useId(), coverNote: useId(), start: useId(), end: useId() };

  const types = useMemo(() => overview.data?.types ?? [], [overview.data]);
  useEffect(() => {
    if (!typeId && types.length) setTypeId(types[0].id);
  }, [typeId, types]);

  const datesOk = isIsoDate(start) && isIsoDate(end) && end >= start;
  const oneDay = datesOk && start === end;
  const body = datesOk ? draftBody({ typeId, start, end, startPart, endPart, notes: "", coverId, coverNote: "" }) : null;
  const bodyKey = body ? JSON.stringify({ ...body, leave_type_id: body.leave_type_id || null }) : null;

  useEffect(() => {
    if (!bodyKey) {
      setPreview(null);
      setPreviewCode(null);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      const b = JSON.parse(bodyKey) as PmCreateBody;
      void api.preview({ ...b, leave_type_id: b.leave_type_id || undefined }, ac.signal).then((r) => {
        if (ac.signal.aborted) return;
        if (r.ok) {
          setPreview(r.data);
          setPreviewCode(null);
        } else {
          setPreview(null);
          setPreviewCode(r.code ?? "error");
        }
      });
    }, 250);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [api, bodyKey]);

  if (!overview.data) {
    if (overview.loading) return <Loading />;
    return <p className={pm.formError}>{errorCopy(overview.code)}</p>;
  }
  const { me, department, usage, goes_to, year } = overview.data;
  if (!me.can_request) {
    return (
      <Empty title="Not a member here">
        Only members of {department.name} can ask for time off here.{" "}
        <Link href={paths.blockouts}>You can still block out dates.</Link>
      </Empty>
    );
  }

  const coverCandidates = coverChoices(roster.data, me.user_id);
  const type = types.find((t) => t.id === typeId) ?? null;
  const projections = preview?.usage ?? [];
  const baseUsage = usage.find((u) => u.leave_type_id === typeId || (type && u.slug === type.slug)) ?? null;
  const cover = coverCandidates.find((p) => p.user_id === coverId) ?? null;
  const goes = goesToWords(preview?.goes_to ?? goes_to, department.name);
  const noDays = preview?.no_working_days === true;
  const canSend = !!type && datesOk && !noDays && !sending;

  function changeStart(v: string) {
    setStart(v);
    if (v && (!end || end < v)) setEnd(v);
  }

  async function submit() {
    if (!canSend || !type) return;
    setSending(true);
    setSendCode(null);
    const result = await api.create(draftBody({ typeId: type.id, start, end, startPart, endPart, notes, coverId, coverNote }));
    if (result.ok) {
      router.push(paths.mineFocus(result.data.request.id));
      router.refresh();
      return;
    }
    setSending(false);
    setSendCode(result.code);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <SectionBar title="Request time off" meta={`goes to a ${department.name} leader`} />
      <div className={pw.field}>
        <label className={pw.label} htmlFor={ids.type}>
          Type
        </label>
        <select id={ids.type} className={pm.select} value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <div className={pm.typeList}>{types.map((t) => t.label).join(" · ")}</div>
      </div>

      <div className={pw.field}>
        <span className={pw.label}>Dates</span>
        <div className={pm.dates}>
          <label className={pm.dateBox} htmlFor={ids.start}>
            <span>FROM</span>
            <input id={ids.start} type="date" value={start} onChange={(e) => changeStart(e.target.value)} required />
          </label>
          <label className={pm.dateBox} htmlFor={ids.end}>
            <span>TO</span>
            <input id={ids.end} type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} required />
          </label>
        </div>
        {datesOk ? (
          oneDay ? (
            <div className={pm.part} role="group" aria-label="Part of the day" style={{ marginTop: 8 }}>
              {(
                [
                  ["full", "Whole day"],
                  ["am", "Morning"],
                  ["pm", "Afternoon"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={startPart === value} onClick={() => setStartPart(value)}>
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <div className={pm.part} role="group" aria-label="Half days" style={{ marginTop: 8 }}>
              <button type="button" aria-pressed={startPart === "pm"} onClick={() => setStartPart(startPart === "pm" ? "full" : "pm")}>
                First day from the afternoon
              </button>
              <button type="button" aria-pressed={endPart === "am"} onClick={() => setEndPart(endPart === "am" ? "full" : "am")}>
                Last day until lunch
              </button>
            </div>
          )
        ) : null}
        {preview ? <PreviewCount preview={preview} /> : null}
        {previewCode && datesOk ? <p className={pm.reqMsg}>{errorCopy(previewCode)}</p> : null}
      </div>

      {type ? (
        <div className={pw.field}>
          <span className={pw.label}>
            {type.label} this year
          </span>
          {projections.length > 0 ? (
            projections.map((p) => (
              <div key={p.year}>
                <UsageBar
                  label={`${fmtDays(p.used)} used + ${fmtDays(p.this_request)} this request`}
                  used={p.used}
                  extra={p.this_request}
                  extraLabel="this request"
                  guideline={p.guideline}
                  legend={p.guideline === null ? `No guideline · ${p.year}` : `Guideline ${fmtDays(p.guideline)} days · ${p.year}`}
                />
                <p className={pm.fieldNote} style={(p.over ?? 0) > 0 ? { color: "var(--destructive)" } : undefined}>
                  {projectionCopy(p)}
                </p>
              </div>
            ))
          ) : (
            <UsageBar
              label={`${fmtDays(baseUsage?.used ?? 0)} used`}
              used={baseUsage?.used ?? 0}
              extra={0}
              guideline={baseUsage?.guideline ?? type.annual_allowance_days}
              legend={
                (baseUsage?.guideline ?? type.annual_allowance_days) === null
                  ? `No guideline · ${year}`
                  : `Guideline ${fmtDays((baseUsage?.guideline ?? type.annual_allowance_days) as number)} days · ${year}`
              }
            />
          )}
        </div>
      ) : null}

      <div className={pw.field}>
        <label className={pw.label} htmlFor={ids.notes}>
          Notes · reasoning or details
        </label>
        <textarea id={ids.notes} className={pw.input} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className={pw.field}>
        <label className={pw.label} htmlFor={ids.cover}>
          Who&apos;s covering? (optional)
        </label>
        {cover ? (
          <div className={pm.pick}>
            <Avatar text={initials(cover.name)} />
            <div className={pm.pickWhat}>
              <div className={pm.pickK}>{cover.name}</div>
              <div className={pm.pickS}>{department.name}</div>
            </div>
            <button type="button" className={pm.pickX} aria-label={`Remove ${cover.name}`} onClick={() => setCoverId("")}>
              ×
            </button>
          </div>
        ) : coverCandidates.length > 0 ? (
          <select id={ids.cover} className={`${pm.select} ${pm.selectSm}`} value="" onChange={(e) => setCoverId(e.target.value)} style={{ marginBottom: 8 }}>
            <option value="">Pick someone from {department.name}</option>
            {coverCandidates.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
        {cover && preview && preview.cover_conflicts.length > 0 ? (
          <div className={`${pm.flag} ${pm.flagRed}`} role="alert" style={{ marginBottom: 8 }}>
            <span className={pm.flagI}>HEADS UP</span>
            <span>
              {firstName(cover.name)} is away{" "}
              <b>{preview.cover_conflicts.map((c) => shortRange(c.start_date, c.end_date)).join(", ")}</b>
              {preview.cover_conflicts.every((c) => c.source === "blockout")
                ? " (blocked out)"
                : preview.cover_conflicts.some((c) => c.status === "pending")
                  ? " (some still pending)"
                  : ""}
              . Add a second person for those days, or note who.
            </span>
          </div>
        ) : null}
        <input
          id={ids.coverNote}
          className={pw.input}
          value={coverNote}
          maxLength={500}
          onChange={(e) => setCoverNote(e.target.value)}
          placeholder="Not on the Hub? Type a name or note"
          aria-label="Covering note"
        />
      </div>

      {preview ? (
        <div className={pw.field}>
          <span className={pw.label}>Also away then</span>
          <div className={pm.fieldNote} style={{ marginTop: 0 }}>
            {preview.also_away.length ? (
              preview.also_away.map((row, i) => <div key={`${row.user_id}-${row.start_date}-${i}`}>{awayLine(row)}</div>)
            ) : (
              <div>Nobody else in {department.name} is away or blocked out then.</div>
            )}
          </div>
        </div>
      ) : null}

      <div className={pm.notice}>
        <span className={pm.noticeI}>GOES TO</span>
        <span>
          {goes.lead}
          {goes.names.map((n, i) => (
            <span key={`${n}-${i}`}>
              {i > 0 ? (i === goes.names.length - 1 ? " or " : ", ") : null}
              <b>{n}</b>
            </span>
          ))}
          {goes.tail}
        </span>
      </div>

      {sendCode ? (
        <p className={pm.formError} role="alert">
          {errorCopy(sendCode)}
        </p>
      ) : null}
      <div className={pw.savebar}>
        <Link className={pw.btn} href={paths.mine}>
          Cancel
        </Link>
        <button type="submit" className={`${pw.btn} ${pw.primary}`} disabled={!canSend} aria-disabled={!canSend}>
          {sending ? "Sending…" : "Send request"}
        </button>
      </div>
    </form>
  );
}

/** "7 weekdays · 9 calendar days. Sat 12 and Sun 13 aren't counted." plus the holiday flag. */
export function PreviewCount({ preview }: { preview: PmPreview }) {
  const holiday = holidayCopy(preview.holidays);
  return (
    <>
      <div className={pm.count} aria-live="polite">
        <span className={pm.countN}>{fmtDays(preview.days)}</span>
        <div>
          <div className={pm.countK}>{weekdayUnit(preview.days)}</div>
          <div className={pm.countS}>{calendarCopy(preview)}</div>
        </div>
      </div>
      {holiday ? (
        <div className={pm.flag}>
          <span className={pm.flagI}>PUBLIC HOLIDAY</span>
          <span>{holiday}</span>
        </div>
      ) : null}
      {preview.no_working_days ? (
        <div className={`${pm.flag} ${pm.flagRed}`} role="alert">
          <span className={pm.flagI}>NO DAYS</span>
          <span>{errorCopy("leave_request_no_working_days")}</span>
        </div>
      ) : null}
    </>
  );
}
