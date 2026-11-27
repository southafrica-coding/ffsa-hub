"use client";

import { useMemo } from "react";
import pw from "@/components/song-library/pw.module.css";
import { errorCopy, pmApi } from "./client";
import { fmtDays } from "./format";
import pm from "./pm.module.css";
import type { PmOverview } from "./types";
import { Loading, SectionBar } from "./ui";
import { useJson } from "./use-json";

/**
 * Leave types and yearly guidelines, read only. The API has no write
 * route for them yet (contract gap), so there are no steppers or save bar.
 */
export function SettingsView({ slug }: { slug: string }) {
  const api = useMemo(() => pmApi(slug), [slug]);
  const overview = useJson<PmOverview>(api.urls.overview());
  if (!overview.data) {
    if (overview.loading) return <Loading />;
    return <p className={pm.formError}>{errorCopy(overview.code)}</p>;
  }
  const { types, department } = overview.data;
  return (
    <>
      <div className={pm.svcline}>
        <span className={pm.tag}>READ ONLY</span>
        <span>
          What {department.name}&apos;s form offers. Changing a type or a guideline isn&apos;t in the Hub yet; ask a Hub admin.
        </span>
      </div>
      <SectionBar title="Leave types" meta="days per year" />
      {types.length ? (
        types.map((t) => (
          <div key={t.id} className={pm.lt}>
            <div className={pm.ltWhat}>
              <div className={pm.ltK}>{t.label}</div>
              <div className={pm.ltS}>
                {t.annual_allowance_days === null ? "No guideline · still counted" : "Guideline per year"}
                {t.is_override ? ` · set for ${department.name}` : ""}
              </div>
            </div>
            <span className={pm.stepVal} aria-label={t.annual_allowance_days === null ? "No guideline" : `${t.annual_allowance_days} days`}>
              {t.annual_allowance_days === null ? <span className={pm.stepNone}>NONE</span> : fmtDays(t.annual_allowance_days)}
            </span>
          </div>
        ))
      ) : (
        <p className={pm.loading}>No leave types are offered here.</p>
      )}

      <SectionBar title="Counting" meta="applies to all requests" />
      <div className={pm.setrow}>
        <div className={pm.ltWhat}>
          <div className={pm.setrowK}>Weekdays only</div>
          <div className={pm.setrowS}>Saturdays and Sundays are never counted.</div>
        </div>
      </div>
      <div className={pm.setrow}>
        <div className={pm.ltWhat}>
          <div className={pm.setrowK}>Public holidays</div>
          <div className={pm.setrowS}>
            Never counted as leave. A holiday inside your dates is part of the calendar span, not a leave day.
          </div>
        </div>
      </div>
      <div className={pm.setrow}>
        <div className={pm.ltWhat}>
          <div className={pm.setrowK}>Leave year</div>
          <div className={pm.setrowS}>The calendar year. Totals start again on 1 January.</div>
        </div>
      </div>
      <div className={pm.setrow}>
        <div className={pm.ltWhat}>
          <div className={pm.setrowK}>Guidelines</div>
          <div className={pm.setrowS}>Guidance only. Nothing stops someone asking for more; leaders see the totals.</div>
        </div>
      </div>

      <SectionBar title="Approvals" meta="fixed rule" />
      <p className={pw.hint}>
        Staff: any leader of their department can approve. Leaders: another leader of the same department. One decision is enough. Admins can
        always step in. Nobody decides their own leave.
      </p>
    </>
  );
}
