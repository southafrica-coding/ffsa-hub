"use client";

import { useStudentDemographics } from "./use-student-demographics";
import { WidgetShell, WidgetEmpty } from "./widget-shell";
import { StackedBar, Legend, TIER_COLORS } from "./demographics-controls";

// Country fee-tier mix per school, for accepted and enrolled students. Tiers
// are A/B/C to match the billing screens (A = full price, B = reduced,
// C = heavily reduced).
export function StudentsByTierCard() {
  const state = useStudentDemographics();

  if (state.status !== "ready") return null;
  const data = state.data.population;
  if (!data || data.perProgram.length === 0) return null;

  const withPeople = data.perProgram.filter((p) => p.total > 0);

  return (
    <WidgetShell title="ABC Country" href="/schools">
      <div
        className="flex items-center justify-between"
        style={{
          padding: "0.75rem 1.5rem",
          borderBottom: "1px solid hsl(22 8% 13%)",
          gap: "1rem",
        }}
      >
        <Legend
          items={[
            { label: "Tier A — Full", value: data.overall.tiers.A, color: TIER_COLORS.A },
            { label: "Tier B — Reduced", value: data.overall.tiers.B, color: TIER_COLORS.B },
            { label: "Tier C — Heavily reduced", value: data.overall.tiers.C, color: TIER_COLORS.C },
            { label: "Unknown", value: data.overall.tiers.unknown, color: TIER_COLORS.unknown },
          ]}
        />
      </div>

      {withPeople.length === 0 ? (
        <WidgetEmpty>No students yet</WidgetEmpty>
      ) : (
        <div>
          {withPeople.map((p) => (
            <div
              key={p.id}
              style={{
                padding: "0.8rem 1.5rem",
                borderBottom: "1px solid hsl(22 8% 11%)",
              }}
            >
              <div
                className="flex items-baseline justify-between"
                style={{ gap: "1rem", marginBottom: "6px" }}
              >
                <p
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#F0EBE3",
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
                    color: "hsl(30 8% 45%)",
                    whiteSpace: "nowrap",
                  }}
                >
                  A {p.tiers.A} · B {p.tiers.B} · C {p.tiers.C}
                  {p.tiers.unknown > 0 && ` · ? ${p.tiers.unknown}`}
                </p>
              </div>
              <StackedBar
                total={p.total}
                segments={[
                  { label: "Tier A", value: p.tiers.A, color: TIER_COLORS.A },
                  { label: "Tier B", value: p.tiers.B, color: TIER_COLORS.B },
                  { label: "Tier C", value: p.tiers.C, color: TIER_COLORS.C },
                  { label: "Unknown", value: p.tiers.unknown, color: TIER_COLORS.unknown },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
