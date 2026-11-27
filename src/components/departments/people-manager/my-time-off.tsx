"use client";

import Link from "next/link";
import { useMemo } from "react";
import pw from "@/components/song-library/pw.module.css";
import { errorCopy, pmApi, pmPaths } from "./client";
import { blockoutReasonLabel, fmtDays, rangeLabel, shortTypeLabel } from "./format";
import pm from "./pm.module.css";
import { RequestCard } from "./request-card";
import { RequestDetail } from "./request-detail";
import type { PmBlockout, PmOverview, PmRequestList, PmUsage } from "./types";
import { BlockTag, Empty, Loading, SectionBar } from "./ui";
import { useJson } from "./use-json";

/** Newest first by first day, then by when it was sent. */
export function newestFirst<T extends { start_date: string; created_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.start_date.localeCompare(a.start_date) || b.created_at.localeCompare(a.created_at));
}

export function YearTotals({ usage }: { usage: PmUsage[] }) {
  const shown = usage.filter((u) => u.guideline !== null);
  if (!shown.length) return null;
  return (
    <div className={pm.typetot}>
      {shown.map((u) => (
        <div key={u.leave_type_id} className={(u.over ?? 0) > 0 ? pm.typetotOver : undefined}>
          <div className={pm.typetotN}>
            {fmtDays(u.used)}
            <small>/{fmtDays(u.guideline ?? 0)}</small>
          </div>
          <div className={pm.typetotL} title={u.label}>
            {shortTypeLabel(u.label)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function BlockoutRow({
  b,
  own,
}: {
  b: Pick<PmBlockout, "start_date" | "end_date" | "reason">;
  /** The viewer's own block-out (empty reason may say "No reason given"). */
  own: boolean;
}) {
  const reason = blockoutReasonLabel(b.reason, own);
  return (
    <div className={pm.req}>
      <div className={pm.reqTop}>
        <div className={pm.reqWhat}>
          <div className={pm.reqK}>{rangeLabel(b.start_date, b.end_date)}</div>
          {reason ? <div className={pm.reqS}>{reason}</div> : null}
        </div>
        <BlockTag />
      </div>
    </div>
  );
}

export function MyTimeOff({ slug, focusRequestId }: { slug: string; focusRequestId?: string | null }) {
  const api = useMemo(() => pmApi(slug), [slug]);
  const paths = pmPaths(slug);
  const overview = useJson<PmOverview>(api.urls.overview());
  const requests = useJson<PmRequestList>(api.urls.requests({ scope: "mine" }));
  const today = overview.data?.today ?? null;
  const blockouts = useJson<{ blockouts: PmBlockout[] }>(today ? api.urls.blockouts({ from: today }) : null);

  if (!overview.data) {
    if (overview.loading) return <Loading />;
    return <p className={pm.formError}>{errorCopy(overview.code)}</p>;
  }
  const { me, year, usage, department } = overview.data;
  const list = newestFirst(requests.data?.requests ?? []);
  const refresh = () => {
    requests.reload();
    overview.reload();
  };

  return (
    <>
      {focusRequestId ? <RequestDetail slug={slug} requestId={focusRequestId} viewerId={me.user_id} onChanged={refresh} /> : null}
      <div className={`${pw.pad} ${pw.btnrow}`} style={{ paddingBottom: 0 }}>
        {me.can_request ? (
          <Link className={`${pw.btn} ${pw.primary} ${pw.grow}`} href={paths.request}>
            + Request time off
          </Link>
        ) : null}
        <Link className={`${pw.btn} ${pw.grow}`} href={paths.blockouts}>
          + Block out dates
        </Link>
      </div>

      {me.can_request ? (
        <>
          <SectionBar title={`${year} so far`} meta="approved · vs guideline" />
          <YearTotals usage={usage} />
        </>
      ) : null}

      <SectionBar title="Requests" meta="newest first" />
      {requests.data ? (
        list.length ? (
          list.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              api={api}
              view="mine"
              focused={r.id === focusRequestId}
              onChanged={refresh}
            />
          ))
        ) : (
          <Empty title="No requests yet">
            {me.can_request ? `When you ask ${department.name} for time off, it shows up here.` : `Only members of ${department.name} ask for time off here.`}
          </Empty>
        )
      ) : requests.loading ? (
        <Loading />
      ) : (
        <p className={pm.formError}>{errorCopy(requests.code)}</p>
      )}

      <SectionBar title="My block-outs" meta="not leave · no approval" />
      {blockouts.data ? (
        blockouts.data.blockouts.length ? (
          blockouts.data.blockouts.map((b) => <BlockoutRow key={b.id} b={b} own />)
        ) : (
          <p className={pm.loading}>No block-outs coming up.</p>
        )
      ) : blockouts.loading ? (
        <Loading />
      ) : blockouts.code ? (
        <p className={pm.formError}>{errorCopy(blockouts.code)}</p>
      ) : null}
      <Link className={pw.more} href={paths.blockouts}>
        <span>Edit block-outs</span>
        <span aria-hidden="true">→</span>
      </Link>
    </>
  );
}
