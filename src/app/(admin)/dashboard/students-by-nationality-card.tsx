"use client";

import { useState } from "react";
import {
  useStudentDemographics,
  pickerStyle,
} from "./use-student-demographics";
import { WidgetShell, WidgetEmpty } from "./widget-shell";

const TOP_N = 8;

// Citizenship mix of accepted and arrived students, ranked, with a school
// filter. Percentages are of the total INCLUDING unrecorded nationalities, so
// the list always sums to 100 and a patchy dataset looks patchy rather than
// confidently wrong.
export function StudentsByNationalityCard() {
  const [programId, setProgramId] = useState<string>("all");
  const [expanded, setExpanded] = useState(false);
  const state = useStudentDemographics();

  if (state.status !== "ready") return null;
  const data = state.data.population;
  if (!data) return null;

  const source =
    programId === "all"
      ? data.overall
      : data.perProgram.find((p) => p.id === programId);

  const ranked = source?.nationalities ?? [];
  const total = source?.total ?? 0;
  const shown = expanded ? ranked : ranked.slice(0, TOP_N);
  const remainder = ranked.length - shown.length;

  return (
    <WidgetShell title="Student Citizenship" href="/schools">
      <div
        className="flex items-center justify-between flex-wrap"
        style={{
          padding: "0.75rem 1.5rem",
          borderBottom: "1px solid hsl(22 8% 13%)",
          gap: "0.5rem",
        }}
      >
        <select
          value={programId}
          onChange={(e) => {
            setProgramId(e.target.value);
            setExpanded(false);
          }}
          style={pickerStyle}
          aria-label="Filter by school"
        >
          <option value="all">All schools</option>
          {state.data.programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {total === 0 ? (
        <WidgetEmpty>No students yet</WidgetEmpty>
      ) : (
        <>
          <div style={{ padding: "0.5rem 0" }}>
            {shown.map((row) => (
              <div
                key={row.country}
                className="flex items-center"
                style={{ gap: "0.75rem", padding: "0.4rem 1.5rem" }}
              >
                <span
                  style={{
                    fontSize: "12px",
                    color: row.country === "Unknown" ? "hsl(30 8% 42%)" : "#F0EBE3",
                    width: "40%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontStyle: row.country === "Unknown" ? "italic" : "normal",
                  }}
                >
                  {row.country === "Unknown" ? "Not recorded" : row.country}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: "6px",
                    background: "hsl(22 8% 13%)",
                    borderRadius: "3px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${row.percent}%`,
                      height: "100%",
                      background:
                        row.country === "Unknown"
                          ? "hsl(22 8% 28%)"
                          : "hsl(42 95% 55%)",
                      borderRadius: "3px",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    color: "hsl(30 8% 55%)",
                    width: "72px",
                    textAlign: "right",
                    flexShrink: 0,
                  }}
                >
                  {row.percent}% · {row.count}
                </span>
              </div>
            ))}
          </div>

          {remainder > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              style={{
                width: "100%",
                padding: "0.6rem",
                borderTop: "1px solid hsl(22 8% 11%)",
                fontSize: "9px",
                letterSpacing: "0.18em",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "hsl(42 95% 55%)",
              }}
            >
              Show {remainder} more {remainder === 1 ? "country" : "countries"}
            </button>
          )}
          {expanded && ranked.length > TOP_N && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              style={{
                width: "100%",
                padding: "0.6rem",
                borderTop: "1px solid hsl(22 8% 11%)",
                fontSize: "9px",
                letterSpacing: "0.18em",
                fontWeight: 700,
                textTransform: "uppercase",
                color: "hsl(30 8% 45%)",
              }}
            >
              Show less
            </button>
          )}
        </>
      )}
    </WidgetShell>
  );
}
