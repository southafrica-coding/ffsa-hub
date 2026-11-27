"use client";

import { useMemo } from "react";
import { errorCopy, pmApi } from "./client";
import { awayLine, fmtDays } from "./format";
import pm from "./pm.module.css";
import { RequestCard } from "./request-card";
import type { PmRequest, PmRequestDetail } from "./types";
import { Loading, SectionBar, UsageBar } from "./ui";
import { useJson } from "./use-json";

/**
 * One request from a deep link (?request=<id>, /requests/<id>, a Slack
 * "Open in Hub"): the card with its actions, the year's usage for that
 * type, and who else is away then.
 */
export function RequestDetail({
  slug,
  requestId,
  viewerId,
  onChanged,
}: {
  slug: string;
  requestId: string;
  viewerId?: string | null;
  onChanged?: (updated?: PmRequest) => void;
}) {
  const api = useMemo(() => pmApi(slug), [slug]);
  const detail = useJson<PmRequestDetail>(api.urls.request(requestId));

  if (!detail.data) {
    if (detail.loading) return <Loading>Opening the request…</Loading>;
    return (
      <>
        <SectionBar title="Request" flush />
        <p className={pm.formError} role="alert">
          {detail.code === "not_found" ? "That request isn't there, or you can't see it." : errorCopy(detail.code)}
        </p>
      </>
    );
  }
  const { request, usage, also_away } = detail.data;
  const mine = !!viewerId && request.requester_id === viewerId;
  const changed = (updated?: PmRequest) => {
    detail.reload();
    onChanged?.(updated);
  };

  return (
    <section aria-label="Request">
      <SectionBar title="Request" meta={request.status === "pending" ? "waiting on a decision" : undefined} flush />
      <RequestCard request={request} api={api} view={mine ? "mine" : "leader"} focused onChanged={changed} />
      {usage.map((u) =>
        u.type ? (
          <div className={pm.typecard} key={u.year}>
            <UsageBar
              label={`${u.type.label} · ${u.year}`}
              used={u.type.used}
              extra={u.type.pending}
              guideline={u.type.guideline}
              legend={`${fmtDays(u.type.used)} approved · ${fmtDays(u.type.pending)} pending${request.status === "pending" ? ", this one included" : ""}`}
            />
          </div>
        ) : null
      )}
      {also_away.length > 0 ? (
        <div className={pm.typecard}>
          <div className={pm.ubLeg} style={{ marginTop: 0, marginBottom: 6 }}>
            Also away then
          </div>
          <div className={pm.fieldNote} style={{ marginTop: 0 }}>
            {also_away.map((row, i) => (
              <div key={`${row.user_id}-${row.start_date}-${i}`}>{awayLine(row)}</div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
