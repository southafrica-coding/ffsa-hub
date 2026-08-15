"use client";

import { useEffect, useState } from "react";

type WorkloadRow = {
  user: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
  };
  applications: number;
  enrollments: number;
};

function staffLabel(u: WorkloadRow["user"]) {
  const f = u.preferred_name || u.first_name || "";
  const l = u.last_name || "";
  const n = `${f} ${l}`.trim();
  return n || u.email || "Unknown";
}

export function StaffWorkloadCard() {
  const [rows, setRows] = useState<WorkloadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/schools/staff-workload", { cache: "no-store" });
      if (res.status === 403) {
        setError("forbidden");
        setRows([]);
        return;
      }
      if (res.ok) {
        const json = (await res.json()) as { workload: WorkloadRow[] };
        setRows(json.workload);
      }
    })();
  }, []);

  if (rows === null) {
    return null;
  }
  if (error === "forbidden") {
    return null;
  }
  if (rows.length === 0) {
    return null;
  }

  const max = rows.reduce(
    (m, r) => Math.max(m, r.applications + r.enrollments),
    1
  );

  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--rule)",
        borderRadius: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--rule)" }}
      >
        <p
          style={{
            fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
            fontSize: "1.15rem",
            letterSpacing: "0.07em",
            color: "var(--text-primary)",
          }}
        >
          Staff Workload
        </p>
        <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>
          Active applications + enrolled students per staff member
        </p>
      </div>
      <div style={{ padding: "0.5rem 0" }}>
        {rows.map((r) => {
          const total = r.applications + r.enrollments;
          const width = (total / max) * 100;
          return (
            <div
              key={r.user.id}
              style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid var(--surface-2)" }}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: "6px" }}>
                <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>
                  {staffLabel(r.user)}
                </p>
                <p style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  <span style={{ color: "var(--ink)" }}>{r.applications}</span> apps ·{" "}
                  <span style={{ color: "var(--text-primary)" }}>{r.enrollments}</span> students
                </p>
              </div>
              <div
                style={{
                  height: "4px",
                  borderRadius: 0,
                  background: "var(--rule)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${width}%`,
                    background:
                      "linear-gradient(90deg, var(--ink), var(--ink))",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
