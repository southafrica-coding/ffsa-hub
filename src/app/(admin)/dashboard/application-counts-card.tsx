"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, ChevronDown, ArrowUpRight } from "lucide-react";

type CountLevel = "view" | "manage";

type ProgramCount = {
  programId: string;
  name: string;
  code: string;
  applications: number;
  accepted: number;
  enrolled: number;
  level: CountLevel;
  breakdown?: Record<string, number>;
};

type Payload = {
  programs: ProgramCount[];
  global: boolean;
};

// Human labels for the raw application statuses.
const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  waiting_for_references: "Awaiting refs",
  references_received: "Refs received",
  interview_scheduled: "Interview",
  accepted: "Accepted",
  rejected: "Rejected",
  waitlisted: "Waitlisted",
};

const STATUS_ORDER = [
  "submitted",
  "waiting_for_references",
  "references_received",
  "interview_scheduled",
  "waitlisted",
  "accepted",
  "rejected",
];

function humanStatus(s: string) {
  return STATUS_LABELS[s] ?? s.replace(/_/g, " ");
}

export function ApplicationCountsCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [openProgram, setOpenProgram] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/schools/application-counts", {
          cache: "no-store",
        });
        if (res.ok) setData((await res.json()) as Payload);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Self-hide while loading and for anyone with no schools visibility.
  if (loading || !data || data.programs.length === 0) return null;

  const { programs, global } = data;
  const showAggregate = global && programs.length > 1;
  const totals = programs.reduce(
    (acc, p) => {
      acc.applications += p.applications;
      acc.accepted += p.accepted;
      acc.enrolled += p.enrolled;
      return acc;
    },
    { applications: 0, accepted: 0, enrolled: 0 }
  );

  return (
    <div
      style={{
        background: "hsl(22 10% 8%)",
        border: "1px solid hsl(22 8% 14%)",
        borderRadius: "14px",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid hsl(22 8% 13%)" }}
      >
        <div className="flex items-center gap-3">
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              background: "hsl(42 95% 55% / 0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "hsl(42 95% 55%)",
            }}
          >
            <ClipboardList className="h-4 w-4" />
          </div>
          <div>
            <p
              style={{
                fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
                fontSize: "1.15rem",
                letterSpacing: "0.07em",
                color: "#F0EBE3",
              }}
            >
              School Applications
            </p>
            <p style={{ fontSize: "11px", color: "hsl(30 8% 42%)", marginTop: "1px" }}>
              {global
                ? "All programs"
                : `${programs.length} program${programs.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
      </div>

      {/* Aggregate strip for users who see everything */}
      {showAggregate && (
        <div
          className="grid grid-cols-3"
          style={{ borderBottom: "1px solid hsl(22 8% 13%)", background: "hsl(22 8% 6%)" }}
        >
          <TotalCell label="Applications" value={totals.applications} accent />
          <TotalCell label="Accepted" value={totals.accepted} />
          <TotalCell label="Enrolled" value={totals.enrolled} />
        </div>
      )}

      {/* Per-program rows */}
      <div>
        {programs.map((p) => {
          const canExpand = p.level === "manage" && !!p.breakdown;
          const isOpen = openProgram === p.programId;
          return (
            <div key={p.programId} style={{ borderBottom: "1px solid hsl(22 8% 11%)" }}>
              <div
                className="flex items-center justify-between gap-3"
                style={{ padding: "0.9rem 1.5rem" }}
              >
                {/* Program name (+ jump to program) */}
                <Link
                  href={`/schools/${p.programId}`}
                  className="flex items-center gap-1.5 transition-colors duration-150 hover:text-[#F0EBE3]"
                  style={{ minWidth: 0 }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: "13px",
                        fontWeight: 500,
                        color: "#F0EBE3",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {p.name}
                    </p>
                    <p style={{ fontSize: "10px", color: "hsl(30 8% 42%)", letterSpacing: "0.05em" }}>
                      {p.code}
                    </p>
                  </div>
                  <ArrowUpRight className="h-3 w-3 shrink-0" style={{ color: "hsl(30 8% 40%)" }} />
                </Link>

                {/* The three numbers */}
                <div className="flex items-center gap-4 shrink-0">
                  <Metric label="Apps" value={p.applications} accent />
                  <Metric label="Accepted" value={p.accepted} />
                  <Metric label="Enrolled" value={p.enrolled} />
                  {canExpand && (
                    <button
                      onClick={() => setOpenProgram(isOpen ? null : p.programId)}
                      aria-label={isOpen ? "Hide breakdown" : "Show breakdown"}
                      style={{
                        color: "hsl(30 8% 45%)",
                        transition: "transform 150ms",
                        transform: isOpen ? "rotate(180deg)" : "none",
                      }}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Manager-only status breakdown */}
              {canExpand && isOpen && (
                <div
                  className="flex flex-wrap gap-2"
                  style={{ padding: "0 1.5rem 1rem", background: "hsl(22 8% 6%)" }}
                >
                  {STATUS_ORDER.filter((s) => (p.breakdown?.[s] ?? 0) > 0).map((s) => (
                    <span
                      key={s}
                      style={{
                        fontSize: "11px",
                        color: "hsl(30 8% 60%)",
                        background: "hsl(22 8% 12%)",
                        border: "1px solid hsl(22 8% 16%)",
                        borderRadius: "999px",
                        padding: "3px 10px",
                      }}
                    >
                      {humanStatus(s)}{" "}
                      <span style={{ color: "#F0EBE3", fontWeight: 600 }}>{p.breakdown?.[s]}</span>
                    </span>
                  ))}
                  {Object.keys(p.breakdown ?? {}).length === 0 && (
                    <span style={{ fontSize: "11px", color: "hsl(30 8% 35%)" }}>No applications yet.</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={{ textAlign: "right", minWidth: "44px" }}>
      <p
        style={{
          fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
          fontSize: "1.5rem",
          lineHeight: 1,
          color: accent ? "hsl(42 95% 58%)" : "#F0EBE3",
        }}
      >
        {value}
      </p>
      <p
        style={{
          fontSize: "8px",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          fontWeight: 700,
          color: "hsl(30 8% 42%)",
          marginTop: "3px",
        }}
      >
        {label}
      </p>
    </div>
  );
}

function TotalCell({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={{ padding: "1rem 1.5rem", borderRight: "1px solid hsl(22 8% 13%)" }}>
      <p
        style={{
          fontSize: "9px",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          fontWeight: 700,
          color: accent ? "hsl(42 95% 65%)" : "hsl(30 8% 42%)",
          marginBottom: "4px",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
          fontSize: "2.25rem",
          lineHeight: 1,
          color: accent ? "hsl(42 95% 58%)" : "#F0EBE3",
        }}
      >
        {value}
      </p>
    </div>
  );
}
