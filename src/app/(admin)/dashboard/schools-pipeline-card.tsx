"use client";

import Link from "next/link";
import { useSchoolsAnalytics, type ProgramAnalytics } from "./use-schools-analytics";
import { WidgetShell } from "./widget-shell";

// Where students fall out between applying and arriving.
//
// The funnel bars are scaled against APPLICATIONS for that program, so the
// visual width is the real drop-off — not each stage normalised to full width,
// which would make every school look identical.
export function SchoolsPipelineCard() {
  const state = useSchoolsAnalytics();

  if (state.status !== "ready") return null;
  const { programs, totals } = state.data;
  if (programs.length === 0) return null;

  // Nothing to show a funnel for until at least one application exists.
  const withApplications = programs.filter((p) => p.applications > 0);
  if (withApplications.length === 0) return null;

  return (
    <WidgetShell title="Pipeline and conversion" href="/schools">
      {totals && (
        <div
          className="grid grid-cols-2"
          style={{
            padding: "1rem 1.5rem",
            borderBottom: "1px solid var(--rule)",
            background: "var(--surface-2)",
            gap: "1rem",
          }}
        >
          <RateCell
            label="Acceptance rate"
            value={totals.acceptanceRate}
            hint="of decided applications"
          />
          <RateCell
            label="Accepted → arrived"
            value={totals.arrivalRate}
            hint="of accepted students"
          />
        </div>
      )}

      <div>
        {withApplications.map((p) => (
          <Link
            key={p.id}
            href={`/schools/${p.id}`}
            className="block transition-colors duration-150 hover:bg-[color:var(--surface-2)]"
            style={{
              padding: "0.9rem 1.5rem",
              borderBottom: "1px solid var(--surface-2)",
            }}
          >
            <div className="flex items-baseline justify-between" style={{ gap: "1rem" }}>
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
                  whiteSpace: "nowrap",
                  letterSpacing: "0.05em",
                }}
              >
                {p.acceptanceRate === null ? "—" : `${p.acceptanceRate}% accepted`}
                {" · "}
                {p.arrivalRate === null ? "—" : `${p.arrivalRate}% arrived`}
              </p>
            </div>

            <Funnel program={p} />
          </Link>
        ))}
      </div>
    </WidgetShell>
  );
}

function Funnel({ program: p }: { program: ProgramAnalytics }) {
  const stages = [
    { label: "Applied", value: p.applications, color: "var(--text-tertiary)" },
    { label: "Accepted", value: p.accepted, color: "var(--ink)" },
    { label: "Enrolled", value: p.enrolled, color: "hsl(160 50% 42%)" },
    { label: "Arrived", value: p.arrived, color: "hsl(160 60% 55%)" },
  ];
  const max = Math.max(p.applications, 1);

  return (
    <div style={{ marginTop: "0.6rem", display: "grid", gap: "4px" }}>
      {stages.map((s) => (
        <div
          key={s.label}
          className="flex items-center"
          style={{ gap: "0.6rem" }}
        >
          <span
            style={{
              fontSize: "8px",
              letterSpacing: "0.14em",
              fontWeight: 700,
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              width: "52px",
              flexShrink: 0,
            }}
          >
            {s.label}
          </span>
          <div
            style={{
              flex: 1,
              height: "6px",
              background: "var(--rule)",
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${(s.value / max) * 100}%`,
                height: "100%",
                background: s.color,
                borderRadius: "3px",
              }}
            />
          </div>
          <span
            style={{
              fontSize: "11px",
              color: "var(--text-primary)",
              width: "34px",
              textAlign: "right",
              flexShrink: 0,
            }}
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function RateCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint: string;
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
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
          fontSize: "1.9rem",
          lineHeight: 1,
          color: "var(--ink)",
        }}
      >
        {value === null ? "—" : `${value}`}
        {value !== null && <span style={{ fontSize: "1rem" }}>%</span>}
      </p>
      <p style={{ fontSize: "9px", color: "var(--text-tertiary)", marginTop: "3px" }}>
        {hint}
      </p>
    </div>
  );
}
