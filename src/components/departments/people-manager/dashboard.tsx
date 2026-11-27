"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import pw from "@/components/song-library/pw.module.css";
import { addDays } from "@/lib/people-manager/days";
import { errorCopy, pmApi, pmPaths, type PmApi } from "./client";
import { firstName, fmtDays, joinNames, mondayOf, rangeLabel, shortName, shortTypeLabel, weekHead } from "./format";
import pm from "./pm.module.css";
import { RequestCard } from "./request-card";
import { RequestDetail } from "./request-detail";
import type { PmAway, PmAwayDay, PmAwayRow, PmOverview, PmRequest, PmRequestDetail, PmRequestList, PmUsagePerson, PmUsageResponse } from "./types";
import { Empty, Loading, SectionBar } from "./ui";
import { useJson } from "./use-json";

const WEEKS = 4;

export function Dashboard({ slug, focusRequestId }: { slug: string; focusRequestId?: string | null }) {
  const api = useMemo(() => pmApi(slug), [slug]);
  const paths = pmPaths(slug);
  const overview = useJson<PmOverview>(api.urls.overview());
  const pending = useJson<PmRequestList>(api.urls.requests({ scope: "pending" }));
  const year = overview.data?.year;
  const usage = useJson<PmUsageResponse>(year ? api.urls.usage({ year }) : null);

  if (!overview.data) {
    if (overview.loading) return <Loading />;
    return <p className={pm.formError}>{errorCopy(overview.code)}</p>;
  }
  const { me, today, department } = overview.data;
  if (!me.can_see_department) {
    return (
      <Empty title="Leaders only">
        The People Manager is for {department.name} leaders and Hub admins. <Link href={paths.mine}>Open my time off</Link>.
      </Empty>
    );
  }
  const people = usage.data?.people ?? [];
  const refresh = () => {
    pending.reload();
    usage.reload();
    overview.reload();
  };
  const queue = pending.data?.requests ?? [];

  return (
    <>
      {focusRequestId ? <RequestDetail slug={slug} requestId={focusRequestId} viewerId={me.user_id} onChanged={refresh} /> : null}
      <SectionBar title="Waiting on you" meta={`${queue.length} pending`} />
      {pending.data ? (
        queue.length ? (
          queue.map((r) => <PendingCard key={r.id} request={r} api={api} people={people} onChanged={refresh} />)
        ) : (
          <p className={pm.loading}>Nothing is waiting on a decision.</p>
        )
      ) : pending.loading ? (
        <Loading />
      ) : (
        <p className={pm.formError}>{errorCopy(pending.code)}</p>
      )}

      <AwayTimeline api={api} today={today} people={people} />

      <UsageTable year={overview.data.year} usage={usage.data} loading={usage.loading} code={usage.code} slug={slug} />

      <Link className={pw.more} href={paths.settings}>
        <span>Leave types and guidelines</span>
        <span aria-hidden="true">→</span>
      </Link>
      <Link className={pw.more} href={paths.dmPreview}>
        <span>Preview the Slack messages</span>
        <span aria-hidden="true">→</span>
      </Link>
    </>
  );
}

/** A queue card with its context: usage with this request, cover, others away, a leader's request. */
function PendingCard({ request, api, people, onChanged }: { request: PmRequest; api: PmApi; people: PmUsagePerson[]; onChanged: () => void }) {
  const detail = useJson<PmRequestDetail>(api.urls.request(request.id));
  const role = people.find((p) => p.user_id === request.requester_id)?.role ?? null;
  const pills = pendingPills(request, detail.data, role);
  const aside =
    role === "leader" ? (
      <p className={pm.reqInfo}>
        {firstName(request.requester.name)} is a leader, so only another leader can decide this one.{request.can_decide ? " That means you." : ""}
      </p>
    ) : null;
  return (
    <RequestCard
      request={detail.data?.request ?? request}
      api={api}
      view="leader"
      pills={pills}
      aside={aside}
      onChanged={() => {
        detail.reload();
        onChanged();
      }}
    />
  );
}

export function pendingPills(request: PmRequest, detail: PmRequestDetail | null, role: string | null) {
  const out: { text: string; tone: "red" | "amber" | "ink" | null }[] = [];
  if (role === "leader") out.push({ text: "Leader", tone: "ink" });
  const startYear = Number(request.start_date.slice(0, 4));
  const u = detail?.usage.find((x) => x.year === startYear)?.type ?? detail?.usage[0]?.type ?? null;
  if (u) {
    // The request is pending, so it's inside `pending`: show approved + this request.
    const total = u.used + (request.days_by_year?.[String(startYear)] ?? request.days_count);
    const short = shortTypeLabel(u.label);
    if (u.guideline === null) out.push({ text: `${short} ${fmtDays(total)} days`, tone: null });
    else {
      const over = total - u.guideline;
      out.push({ text: `${short} ${fmtDays(total)} of ${fmtDays(u.guideline)}${over > 0 ? ` · +${fmtDays(over)} over` : ""}`, tone: over > 0 ? "red" : null });
    }
  }
  const cover = request.covering?.name ?? request.covering_note;
  if (cover) out.push({ text: `Covering: ${cover}`, tone: null });
  const others = new Set((detail?.also_away ?? []).map((a) => a.user_id)).size;
  if (others > 0) out.push({ text: `${others} other${others === 1 ? "" : "s"} away`, tone: "amber" });
  return (
    <>
      {out.map((p) => (
        <span
          key={p.text}
          className={`${pm.pill} ${p.tone === "red" ? pm.pillRed : p.tone === "amber" ? pm.pillAmber : p.tone === "ink" ? pm.pillInk : ""}`}
        >
          {p.text}
        </span>
      ))}
    </>
  );
}

// ── who's away ─────────────────────────────────────────────

export type CrowdedRun = { start: string; end: string; userIds: string[]; pending: boolean };

/** Runs of consecutive listed weekdays where `away >= warnAt`. */
export function crowdedRuns(days: readonly PmAwayDay[], rows: readonly PmAwayRow[], warnAt: number): CrowdedRun[] {
  const runs: CrowdedRun[] = [];
  let cur: CrowdedRun | null = null;
  for (const d of days) {
    if (d.away >= warnAt) {
      const pendingToday = rows.some((r) => r.status === "pending" && r.start_date <= d.day && r.end_date >= d.day);
      if (cur) {
        cur.end = d.day;
        cur.userIds = [...new Set([...cur.userIds, ...d.user_ids])];
        cur.pending = cur.pending || pendingToday;
      } else cur = { start: d.day, end: d.day, userIds: [...d.user_ids], pending: pendingToday };
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

function AwayTimeline({ api, today, people }: { api: PmApi; today: string; people: PmUsagePerson[] }) {
  const [from, setFrom] = useState(() => mondayOf(today));
  const to = addDays(from, WEEKS * 7 - 3);
  const away = useJson<PmAway>(api.urls.away(from, to));
  const data = away.data && away.data.from === from ? away.data : null;

  const nameOf = new Map<string, string>();
  for (const p of people) nameOf.set(p.user_id, p.name ?? "Someone");
  for (const r of data?.rows ?? []) if (!nameOf.has(r.user_id)) nameOf.set(r.user_id, r.name ?? "Someone");
  const leaders = new Set(people.filter((p) => p.role === "leader").map((p) => p.user_id));
  const rowIds = [...people.map((p) => p.user_id), ...[...nameOf.keys()].filter((id) => !people.some((p) => p.user_id === id))];
  const days = data?.days ?? [];
  const cols = days.length;
  const colOf = new Map(days.map((d, i) => [d.day, i + 2]));
  const runs = data ? crowdedRuns(days, data.rows, data.warn_at) : [];
  const maxAway = Math.max(1, ...days.map((d) => d.away));

  return (
    <>
      <SectionBar title="Who's away" meta="approved · pending · block-outs" />
      <div className={pm.gnav}>
        <span className={pm.gnavT}>{rangeLabel(from, to)} · weekdays</span>
        <span className={pm.navBtns}>
          <button type="button" aria-label="Earlier" onClick={() => setFrom(addDays(from, -WEEKS * 7))}>
            ‹
          </button>
          <button type="button" aria-label="Later" onClick={() => setFrom(addDays(from, WEEKS * 7))}>
            ›
          </button>
        </span>
      </div>
      {!data ? (
        away.loading ? (
          <Loading />
        ) : (
          <p className={pm.formError}>{errorCopy(away.code)}</p>
        )
      ) : (
        <div className={pm.gwrap}>
          <div
            className={pm.gantt}
            style={{ gridTemplateColumns: `62px repeat(${cols}, minmax(0, 1fr))` }}
            role="img"
            aria-label={`Team timeline, ${rangeLabel(from, to)}`}
          >
            {days.map((d, i) =>
              i % 5 === 0 ? (
                <span key={`wk-${d.day}`} className={pm.gWk} style={{ gridColumn: `${i + 2} / span 5` }}>
                  {weekHead(d.day)}
                </span>
              ) : null
            )}
            {rowIds.map((id, ri) => {
              const row = ri + 2;
              const bars = data.rows.filter((r) => r.user_id === id);
              return (
                <TimelineRow
                  key={id}
                  row={row}
                  name={nameOf.get(id) ?? "Someone"}
                  leader={leaders.has(id)}
                  days={days}
                  today={today}
                  bars={bars}
                  colOf={colOf}
                />
              );
            })}
            <span className={pm.gCntL} style={{ gridRow: rowIds.length + 2 }}>
              Away
            </span>
            {days.map((d, i) => (
              <span
                key={`c-${d.day}`}
                className={`${pm.gCnt} ${d.away >= data.warn_at ? pm.gCntHi : ""}`}
                style={{ gridRow: rowIds.length + 2, gridColumn: i + 2 }}
              >
                <i style={{ height: `${Math.round((d.away / maxAway) * 21)}px` }} />
                {d.away || ""}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className={pm.legend} style={{ paddingTop: 8 }}>
        <span>
          <i className={pm.lgAp} />
          Approved
        </span>
        <span>
          <i className={pm.lgPe} />
          Pending
        </span>
        <span>
          <i className={pm.lgBo} />
          Block-out
        </span>
        <span>
          <i className={pm.lgHol} />
          Public holiday
        </span>
      </div>
      {data && runs.length > 0 ? (
        <div className={`${pm.flag} ${pm.flagRed} ${pm.flagInset}`} role="status">
          <span className={pm.flagI}>{data.warn_at}+ AWAY</span>
          <span>
            {runs.map((run, i) => (
              <span key={run.start}>
                {i > 0 ? " " : null}
                <b>{rangeLabel(run.start, run.end)}</b>: {joinNames(run.userIds.map((id) => firstName(nameOf.get(id))))}
                {run.pending ? ", if the pending requests are approved" : ""}.
              </span>
            ))}
          </span>
        </div>
      ) : null}
    </>
  );
}

function TimelineRow({
  row,
  name,
  leader,
  days,
  today,
  bars,
  colOf,
}: {
  row: number;
  name: string;
  leader: boolean;
  days: PmAwayDay[];
  today: string;
  bars: PmAwayRow[];
  colOf: Map<string, number>;
}) {
  const first = days[0]?.day;
  const last = days[days.length - 1]?.day;
  return (
    <>
      <span className={`${pm.gNm} ${leader ? pm.gNmLd : ""}`} style={{ gridRow: row }} title={name}>
        <span>{shortName(name)}</span>
      </span>
      {days.map((d, i) => (
        <span
          key={d.day}
          className={[pm.gCell, i % 5 === 0 ? pm.gCellWk0 : "", d.holiday ? pm.gCellHol : "", d.day === today ? pm.gCellToday : ""].filter(Boolean).join(" ")}
          style={{ gridRow: row, gridColumn: i + 2 }}
        />
      ))}
      {first && last
        ? bars.map((b, i) => {
            if (b.end_date < first || b.start_date > last) return null;
            const inside = days.filter((d) => d.day >= b.start_date && d.day <= b.end_date);
            if (!inside.length) return null;
            const a = colOf.get(inside[0].day)!;
            const z = colOf.get(inside[inside.length - 1].day)! + 1;
            const cls = b.source === "blockout" ? pm.gBarBo : b.status === "approved" ? pm.gBarAp : pm.gBarPe;
            return <span key={`${b.start_date}-${i}`} className={`${pm.gBar} ${cls}`} style={{ gridRow: row, gridColumn: `${a} / ${z}` }} />;
          })
        : null}
    </>
  );
}

// ── days used ──────────────────────────────────────────────

function UsageTable({
  year,
  usage,
  loading,
  code,
  slug,
}: {
  year: number;
  usage: PmUsageResponse | null;
  loading: boolean;
  code: string | null;
  slug: string;
}) {
  const paths = pmPaths(slug);
  if (!usage) {
    return (
      <>
        <SectionBar title={`Days used · ${year}`} meta="approved · vs guideline" />
        {loading ? <Loading /> : <p className={pm.formError}>{errorCopy(code)}</p>}
      </>
    );
  }
  const cols = usage.types.filter((t) => t.annual_allowance_days !== null);
  const noGuideline = usage.types.filter((t) => t.annual_allowance_days === null).map((t) => t.label);
  return (
    <>
      <SectionBar title={`Days used · ${usage.year}`} meta="approved · vs guideline" />
      <table className={pm.ut}>
        <caption className={pw.srOnly}>Leave days used per person in {usage.year}</caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            {cols.map((t) => (
              <th key={t.id} scope="col" title={t.label}>
                {shortTypeLabel(t.label)}
                <br />
                {fmtDays(t.annual_allowance_days ?? 0)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {usage.people.map((p) => (
            <tr key={p.user_id}>
              <td>
                <Link href={paths.person(p.user_id)}>
                  <span className={pm.utNm}>{p.name ?? "Someone"}</span>
                  <span className={pm.utSub}>{p.role === "leader" ? "Leader" : "Staff"}</span>
                </Link>
              </td>
              {cols.map((t) => {
                const u = p.usage.find((x) => x.slug === t.slug);
                const used = u?.used ?? 0;
                const pend = u?.pending ?? 0;
                const g = u?.guideline ?? t.annual_allowance_days ?? 0;
                const over = (u?.over ?? 0) > 0;
                return (
                  <td key={t.id} className={over ? pm.utOv : undefined}>
                    <span className={pm.utV}>
                      {fmtDays(used)}
                      {pend > 0 ? <small>+{fmtDays(pend)}</small> : null}
                    </span>
                    <div className={pm.utMb}>
                      <i style={{ width: `${g > 0 ? Math.min(100, Math.round((used / g) * 100)) : used > 0 ? 100 : 0}%` }} />
                    </div>
                    {over ? <span className={pm.utO}>+{fmtDays(u?.over ?? 0)} over</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={pw.hint}>
        Small amber number = pending.
        {noGuideline.length ? ` ${joinNames(noGuideline)} ${noGuideline.length === 1 ? "has" : "have"} no guideline, so ${noGuideline.length === 1 ? "it's" : "they're"} on each person's page.` : ""} Tap a name for
        their year.
      </p>
    </>
  );
}
