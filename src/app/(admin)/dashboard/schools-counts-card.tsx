"use client";

import Link from "next/link";
import { useSchoolsAnalytics } from "./use-schools-analytics";
import { WidgetShell, WidgetEmpty } from "./widget-shell";

// "How many students have applied to each school, and how many got in."
// Self-hides for anyone the analytics endpoint refuses — the same belt-and-
// braces the other permission-scoped cards use.
export function SchoolsCountsCard() {
  const state = useSchoolsAnalytics();

  if (state.status !== "ready") return null;
  const { programs, totals } = state.data;
  if (programs.length === 0) return null;

  return (
    <WidgetShell title="Applications and enrolment" href="/schools">
      {/* Aggregate strip — only present for viewers scoped to every school. */}
      {totals && (
        <div
          className="grid grid-cols-3"
          style={{
            padding: "1rem 1.5rem",
            borderBottom: "1px solid var(--rule)",
            background: "var(--surface-2)",
          }}
        >
          <TotalCell label="Applications" value={totals.applications} />
          <TotalCell label="Accepted" value={totals.accepted} accent />
          <TotalCell label="Enrolled" value={totals.enrolled} />
        </div>
      )}

      <div>
        {programs.map((p) => (
          <Link
            key={p.id}
            href={`/schools/${p.id}`}
            className="grid items-center transition-colors duration-150 hover:bg-[color:var(--surface-2)]"
            style={{
              gridTemplateColumns: "1fr auto auto auto",
              gap: "1rem",
              padding: "0.85rem 1.5rem",
              borderBottom: "1px solid var(--surface-2)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <p
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.name}
              </p>
              <p
                style={{
                  fontSize: "10px",
                  color: "var(--text-tertiary)",
                  marginTop: "2px",
                  letterSpacing: "0.08em",
                }}
              >
                {p.code}
                {p.inFlight > 0 && (
                  <span style={{ color: "var(--ink)" }}>
                    {" · "}
                    {p.inFlight} awaiting decision
                  </span>
                )}
              </p>
            </div>
            <Count label="Applied" value={p.applications} />
            <Count label="Accepted" value={p.accepted} accent />
            <Count label="Enrolled" value={p.enrolled} />
          </Link>
        ))}
      </div>

      {programs.length === 0 && <WidgetEmpty>No schools are active.</WidgetEmpty>}
    </WidgetShell>
  );
}

function Count({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div style={{ textAlign: "right", minWidth: "62px" }}>
      <p
        style={{
          fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
          fontSize: "1.35rem",
          lineHeight: 1,
          color: accent ? "var(--ink)" : "var(--text-primary)",
        }}
      >
        {value}
      </p>
      <p
        style={{
          fontSize: "8px",
          letterSpacing: "0.16em",
          fontWeight: 700,
          color: "var(--text-tertiary)",
          textTransform: "uppercase",
          marginTop: "3px",
        }}
      >
        {label}
      </p>
    </div>
  );
}

function TotalCell({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div>
      <p
        style={{
          fontSize: "9px",
          letterSpacing: "0.18em",
          fontWeight: 700,
          color: "var(--text-tertiary)",
          textTransform: "uppercase",
          marginBottom: "3px",
        }}
      >
        All schools · {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
          fontSize: "1.9rem",
          lineHeight: 1,
          color: accent ? "var(--ink)" : "var(--text-primary)",
        }}
      >
        {value}
      </p>
    </div>
  );
}
