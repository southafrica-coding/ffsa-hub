import type { ReactNode } from "react";
import pw from "@/components/song-library/pw.module.css";
import { fmtDays, statusLabel, weekdayUnit } from "./format";
import pm from "./pm.module.css";
import type { LeaveStatus } from "./types";

export function SectionBar({ title, meta, flush }: { title: string; meta?: ReactNode; flush?: boolean }) {
  return (
    <div className={`${pw.sectionBar} ${flush ? pw.flush : ""}`}>
      <h2 className={pw.sectionTitle}>{title}</h2>
      {meta !== undefined && meta !== null ? <span className={pw.sectionMeta}>{meta}</span> : null}
    </div>
  );
}

export function StatusTag({ status }: { status: LeaveStatus }) {
  return <span className={`${pm.status} ${pm[`status_${status}`]}`}>{statusLabel(status)}</span>;
}

export function BlockTag() {
  return <span className={`${pm.status} ${pm.status_block}`}>Unavailable</span>;
}

export function DaysBox({ days }: { days: number }) {
  return (
    <div className={pm.days}>
      {fmtDays(days)}
      <small>{weekdayUnit(days)}</small>
    </div>
  );
}

const pct = (n: number) => `${Math.max(0, Math.min(100, n)).toFixed(2)}%`;

/**
 * Used (solid) + pending or this request (hatched) against the yearly
 * guideline (yellow tick). Anything past the guideline is red. No guideline:
 * the label line only.
 */
export function UsageBar({
  label,
  used,
  extra,
  guideline,
  legend,
  extraLabel,
}: {
  label: ReactNode;
  used: number;
  /** Pending days, or the request being asked for. */
  extra: number;
  guideline: number | null;
  legend?: ReactNode;
  extraLabel?: string;
}) {
  const total = used + extra;
  const overBy = guideline === null ? 0 : Math.max(total - guideline, 0);
  const right =
    guideline === null ? (
      <span>
        <b>{fmtDays(total)}</b> · no guideline
      </span>
    ) : (
      <span>
        <b>
          {fmtDays(total)} of {fmtDays(guideline)}
        </b>
        {overBy > 0 ? <span className={pm.bad}> +{fmtDays(overBy)} over</span> : null}
      </span>
    );
  if (guideline === null) {
    return (
      <div className={pm.ub}>
        <div className={pm.ubLab}>
          <span>{label}</span>
          {right}
        </div>
        {legend ? <div className={pm.ubLeg}>{legend}</div> : null}
      </div>
    );
  }
  const scale = Math.max(total, guideline, 1);
  const usedPct = (used / scale) * 100;
  const extraPct = (extra / scale) * 100;
  const gPct = (guideline / scale) * 100;
  return (
    <div className={pm.ub}>
      <div className={pm.ubLab}>
        <span>{label}</span>
        {right}
      </div>
      <div
        className={pm.track}
        role="img"
        aria-label={`${fmtDays(used)} used${extra ? `, ${fmtDays(extra)} ${extraLabel ?? "pending"}` : ""}, guideline ${fmtDays(guideline)}`}
      >
        <span className={pm.trackU} style={{ width: pct(usedPct) }} />
        {extra > 0 ? <span className={pm.trackP} style={{ left: pct(usedPct), width: pct(extraPct) }} /> : null}
        {overBy > 0 ? <span className={pm.trackO} style={{ left: pct(gPct), width: pct(100 - gPct) }} /> : null}
        <span className={pm.trackG} style={{ left: `calc(${pct(gPct)} - 1px)` }} />
      </div>
      {legend ? <div className={pm.ubLeg}>{legend}</div> : null}
    </div>
  );
}

export function Loading({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <p className={pm.loading} role="status">
      {children}
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={pw.empty}>
      <div className={pw.emptyTitle}>{title}</div>
      {children ? <p className={pw.emptyText}>{children}</p> : null}
    </div>
  );
}

export function Avatar({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`${pw.avatar} ${className ?? ""}`} aria-hidden="true">
      {text}
    </span>
  );
}
