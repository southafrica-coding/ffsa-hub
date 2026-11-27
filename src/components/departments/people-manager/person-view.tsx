"use client";

import { useMemo, useState } from "react";
import pw from "@/components/song-library/pw.module.css";
import { addDays, saHolidayName } from "@/lib/people-manager/days";
import { errorCopy, pmApi } from "./client";
import { fmtDays, initials, isWeekend, monthInitial } from "./format";
import { BlockoutRow, newestFirst } from "./my-time-off";
import pm from "./pm.module.css";
import { RequestCard } from "./request-card";
import type { PmBlockout, PmOverview, PmRequest, PmRequestList, PmUsageResponse } from "./types";
import { Avatar, Loading, SectionBar, UsageBar } from "./ui";
import { useJson } from "./use-json";

export type MonthBar = { other: number; sick: number; pending: number };

/**
 * Weekdays away per month of one year, from requests: approved split into
 * sick and everything else, pending on its own. Weekends and rule-based
 * public holidays never count; half days count 0.5.
 */
export function monthlyDays(requests: readonly Pick<PmRequest, "start_date" | "end_date" | "start_part" | "end_part" | "status" | "type">[], year: number): MonthBar[] {
  const out: MonthBar[] = Array.from({ length: 12 }, () => ({ other: 0, sick: 0, pending: 0 }));
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  for (const r of requests) {
    if (r.status !== "approved" && r.status !== "pending") continue;
    const from = r.start_date > first ? r.start_date : first;
    const to = r.end_date < last ? r.end_date : last;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (isWeekend(d) || saHolidayName(d)) continue;
      const half = (d === r.start_date && r.start_part !== "full") || (d === r.end_date && r.end_part !== "full");
      const n = half ? 0.5 : 1;
      const m = Number(d.slice(5, 7)) - 1;
      if (r.status === "pending") out[m].pending += n;
      else if (r.type.slug === "sick") out[m].sick += n;
      else out[m].other += n;
    }
  }
  return out;
}

const SHOW = 5;

export function PersonView({ slug, userId }: { slug: string; userId: string }) {
  const api = useMemo(() => pmApi(slug), [slug]);
  const overview = useJson<PmOverview>(api.urls.overview());
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const year = pickedYear ?? overview.data?.year ?? null;
  const me = overview.data?.me;
  const self = me?.user_id === userId;
  const ready = !!overview.data && year !== null;
  const usage = useJson<PmUsageResponse>(ready ? api.urls.usage({ year: year!, person: userId }) : null);
  const requests = useJson<PmRequestList>(
    ready ? api.urls.requests(self ? { scope: "mine", year } : { scope: "department", person: userId, year }) : null
  );
  const blockouts = useJson<{ blockouts: PmBlockout[] }>(
    ready ? api.urls.blockouts({ person: userId, from: `${year}-01-01`, to: `${year}-12-31` }) : null
  );

  if (!overview.data || year === null) {
    if (overview.loading) return <Loading />;
    return <p className={pm.formError}>{errorCopy(overview.code)}</p>;
  }
  if (!self && !overview.data.me.can_see_department) {
    return <p className={pm.formError}>{errorCopy("forbidden")}</p>;
  }
  const thisYear = Number(overview.data.today.slice(0, 4));
  const person = usage.data?.people[0] ?? null;
  const list = newestFirst(requests.data?.requests ?? []);
  const shown = showAll ? list : list.slice(0, SHOW);
  const months = monthlyDays(list, year);
  const maxMonth = Math.max(1, ...months.map((m) => m.other + m.sick + m.pending));
  const perDay = Math.min(14, 90 / maxMonth);
  const nowMonth = year === thisYear ? Number(overview.data.today.slice(5, 7)) - 1 : -1;
  const refresh = () => {
    requests.reload();
    usage.reload();
  };

  return (
    <>
      <div className={pm.phead}>
        <Avatar text={initials(person?.name)} className={pm.pheadAv} />
        <div style={{ minWidth: 0 }}>
          <div className={pm.pheadK}>{person?.name ?? (usage.loading ? "…" : "Someone")}</div>
          <div className={pm.pheadS}>
            {person?.role === "leader" ? "Leader" : person?.role ? "Staff" : "Not a member"} · {overview.data.department.name} · {year}
          </div>
        </div>
      </div>
      <div className={pm.selectrow}>
        <label className={pm.selectLb} htmlFor="pm-year">
          Year
        </label>
        <select id="pm-year" className={`${pm.select} ${pm.selectSm}`} value={year} onChange={(e) => setPickedYear(Number(e.target.value))}>
          {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <SectionBar title="By type" meta="approved + pending" />
      {person ? (
        person.usage.map((u) => (
          <div className={pm.typecard} key={u.leave_type_id}>
            <UsageBar
              label={u.label}
              used={u.used}
              extra={u.pending}
              guideline={u.guideline}
              legend={u.pending > 0 ? `${fmtDays(u.used)} approved · ${fmtDays(u.pending)} pending` : undefined}
            />
          </div>
        ))
      ) : usage.loading ? (
        <Loading />
      ) : (
        <p className={pm.formError}>{errorCopy(usage.code)}</p>
      )}

      <SectionBar title="Month by month" meta="weekdays" />
      <div className={pm.yr} role="img" aria-label="Weekdays away by month">
        {months.map((m, i) => (
          <div key={i}>
            {m.pending > 0 ? <i className={pm.yrPe} style={{ height: `${m.pending * perDay}px` }} /> : null}
            {m.sick > 0 ? <i className={pm.yrSk} style={{ height: `${m.sick * perDay}px` }} /> : null}
            {m.other > 0 ? <i style={{ height: `${m.other * perDay}px` }} /> : null}
          </div>
        ))}
      </div>
      <div className={pm.yrl} aria-hidden="true">
        {months.map((_, i) => (
          <span key={i} className={i === nowMonth ? pm.yrlNow : undefined}>
            {monthInitial(i)}
          </span>
        ))}
      </div>
      <div className={pm.legend} style={{ paddingTop: 10 }}>
        <span>
          <i className={pm.lgAp} />
          Annual / other
        </span>
        <span>
          <i className={pm.lgSick} />
          Sick
        </span>
        <span>
          <i className={pm.lgPe} />
          Pending
        </span>
      </div>

      <SectionBar title="Requests" meta={`${list.length} this year`} />
      {requests.data ? (
        list.length ? (
          <>
            {shown.map((r) => (
              <RequestCard key={r.id} request={r} api={api} view={self ? "mine" : "person"} onChanged={refresh} />
            ))}
            {list.length > SHOW && !showAll ? (
              <button type="button" className={`${pw.more} ${pm.moreBtn}`} onClick={() => setShowAll(true)}>
                <span>{list.length - SHOW} more</span>
                <span aria-hidden="true">→</span>
              </button>
            ) : null}
          </>
        ) : (
          <p className={pm.loading}>No requests in {year}.</p>
        )
      ) : requests.loading ? (
        <Loading />
      ) : (
        <p className={pm.formError}>{errorCopy(requests.code)}</p>
      )}

      <SectionBar title="Block-outs" meta={`${blockouts.data?.blockouts.length ?? 0} this year`} />
      {blockouts.data ? (
        blockouts.data.blockouts.length ? (
          blockouts.data.blockouts.map((b) => <BlockoutRow key={b.id} b={b} />)
        ) : (
          <p className={pm.loading}>No block-outs in {year}.</p>
        )
      ) : blockouts.loading ? (
        <Loading />
      ) : (
        <p className={pm.formError}>{errorCopy(blockouts.code)}</p>
      )}
    </>
  );
}
