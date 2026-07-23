"use client";

import { useState } from "react";
import { useStudentDemographics, type Scope } from "./use-student-demographics";
import { WidgetShell, WidgetEmpty } from "./widget-shell";
import {
  ScopeToggle,
  StackedBar,
  Legend,
  GENDER_COLORS,
  genderLabel,
} from "./demographics-controls";

// Order the known values first, then anything legacy, then "not recorded" last
// so the unknown bucket never leads the legend.
function orderedKeys(genders: Record<string, number>): string[] {
  const known = ["male", "female", "prefer_not_to_say"];
  const extras = Object.keys(genders)
    .filter((k) => !known.includes(k) && k !== "unknown")
    .sort();
  return [...known, ...extras, "unknown"].filter((k) => (genders[k] ?? 0) > 0);
}

function colorFor(key: string): string {
  return GENDER_COLORS[key] ?? "hsl(280 45% 58%)";
}

export function StudentsByGenderCard() {
  const [scope, setScope] = useState<Scope>("students");
  const state = useStudentDemographics();

  if (state.status !== "ready") return null;
  const data = scope === "students" ? state.data.students : state.data.applicants;
  if (!data || data.perProgram.length === 0) return null;

  const withPeople = data.perProgram.filter((p) => p.total > 0);
  const overallKeys = orderedKeys(data.overall.genders);

  return (
    <WidgetShell title="Gender Split by School" href="/schools">
      <div
        className="flex items-center justify-between"
        style={{
          padding: "0.75rem 1.5rem",
          borderBottom: "1px solid hsl(22 8% 13%)",
          gap: "1rem",
        }}
      >
        <Legend
          items={overallKeys.map((k) => ({
            label: genderLabel(k),
            value: data.overall.genders[k] ?? 0,
            color: colorFor(k),
          }))}
        />
        <ScopeToggle scope={scope} onChange={setScope} />
      </div>

      {withPeople.length === 0 ? (
        <WidgetEmpty>No {scope} yet</WidgetEmpty>
      ) : (
        <div>
          {withPeople.map((p) => {
            const keys = orderedKeys(p.genders);
            const male = p.genders.male ?? 0;
            const female = p.genders.female ?? 0;
            return (
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
                    {male} m · {female} f
                    <span style={{ color: "hsl(30 8% 35%)" }}> · {p.total} total</span>
                  </p>
                </div>
                <StackedBar
                  total={p.total}
                  segments={keys.map((k) => ({
                    label: genderLabel(k),
                    value: p.genders[k] ?? 0,
                    color: colorFor(k),
                  }))}
                />
              </div>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}
