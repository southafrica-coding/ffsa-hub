"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ClipboardList, GraduationCap } from "lucide-react";

type StudentLite = {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
};

type AssignedApplication = {
  id: string;
  program_id: string;
  status: string;
  applicant_info: { first_name?: string; last_name?: string } | null;
  applicant_email: string | null;
  staff_assigned_at: string | null;
  staff_viewed_at: string | null;
  users: StudentLite | null;
  programs: { name: string; code: string } | null;
};

type AssignedEnrollment = {
  id: string;
  program_id: string;
  status: string;
  enrolled_at: string;
  staff_assigned_at: string | null;
  staff_viewed_at: string | null;
  users: StudentLite | null;
  programs: { name: string; code: string } | null;
};

type Payload = {
  applications: AssignedApplication[];
  enrollments: AssignedEnrollment[];
  unread: { applications: number; enrollments: number };
};

function studentName(s: StudentLite | null, fallback: { first_name?: string; last_name?: string } | null, email: string | null) {
  if (s) {
    const f = s.first_name || "";
    const l = s.last_name || "";
    const n = `${f} ${l}`.trim();
    if (n) return n;
    if (s.email) return s.email;
  }
  if (fallback) {
    const n = `${fallback.first_name ?? ""} ${fallback.last_name ?? ""}`.trim();
    if (n) return n;
  }
  return email ?? "Unknown";
}

export function MyAssignmentsCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState<"applications" | "enrollments" | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const res = await fetch("/api/schools/my-staff-assignments", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as Payload;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function markViewed(kind: "applications" | "enrollments") {
    const items = data?.[kind] ?? [];
    const unreadIds = items.filter((i) => !i.staff_viewed_at).map((i) => i.id);
    if (unreadIds.length === 0) return;
    await fetch("/api/schools/my-staff-assignments/mark-viewed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        kind === "applications" ? { application_ids: unreadIds } : { enrollment_ids: unreadIds }
      ),
    });
    refresh();
  }

  function togglePanel(kind: "applications" | "enrollments") {
    const next = open === kind ? null : kind;
    setOpen(next);
    if (next) markViewed(next);
  }

  if (loading || !data) {
    return (
      <div
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--rule)",
          borderRadius: 0,
          padding: "1.25rem 1.5rem",
        }}
      >
        <p style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Loading your assignments…</p>
      </div>
    );
  }

  const totalApps = data.applications.length;
  const totalEnrollments = data.enrollments.length;
  if (totalApps === 0 && totalEnrollments === 0) {
    return null;
  }

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
        className="flex items-center justify-between"
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
          My Assignments
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2">
        <AssignmentTile
          label="Applications"
          total={totalApps}
          unread={data.unread.applications}
          icon={ClipboardList}
          isOpen={open === "applications"}
          onToggle={() => togglePanel("applications")}
        />
        <AssignmentTile
          label="Enrolled Students"
          total={totalEnrollments}
          unread={data.unread.enrollments}
          icon={GraduationCap}
          isOpen={open === "enrollments"}
          onToggle={() => togglePanel("enrollments")}
        />
      </div>

      {open === "applications" && (
        <AssignmentList
          items={data.applications.map((a) => ({
            id: a.id,
            name: studentName(a.users, a.applicant_info, a.applicant_email),
            subtitle: `${a.programs?.name ?? "—"} · ${a.status.replace(/_/g, " ")}`,
            assignedAt: a.staff_assigned_at,
            href: `/schools/${a.program_id}`,
            wasUnread: !a.staff_viewed_at,
          }))}
        />
      )}
      {open === "enrollments" && (
        <AssignmentList
          items={data.enrollments.map((e) => ({
            id: e.id,
            name: studentName(e.users, null, null),
            subtitle: `${e.programs?.name ?? "—"} · ${e.status.replace(/_/g, " ")}`,
            assignedAt: e.staff_assigned_at,
            href: `/schools/${e.program_id}`,
            wasUnread: !e.staff_viewed_at,
          }))}
        />
      )}
    </div>
  );
}

function AssignmentTile({
  label,
  total,
  unread,
  icon: Icon,
  isOpen,
  onToggle,
}: {
  label: string;
  total: number;
  unread: number;
  icon: React.ComponentType<{ className?: string }>;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-between text-left transition-colors duration-150"
      style={{
        padding: "1.25rem 1.5rem",
        background: isOpen ? "var(--surface-2)" : "transparent",
        borderRight: "1px solid var(--rule)",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: 0,
            background: unread > 0 ? "var(--surface-3)" : "var(--rule)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: unread > 0 ? "var(--ink)" : "var(--text-tertiary)",
          }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>{label}</p>
          <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>
            {total} total {unread > 0 ? `· ${unread} new` : ""}
          </p>
        </div>
      </div>
      {unread > 0 && (
        <span
          style={{
            fontSize: "10px",
            letterSpacing: "0.1em",
            fontWeight: 700,
            textTransform: "uppercase",
            padding: "3px 8px",
            borderRadius: 0,
            background: "var(--ink)",
            color: "#FFFFFF",
          }}
        >
          {unread} new
        </span>
      )}
    </button>
  );
}

function AssignmentList({
  items,
}: {
  items: Array<{ id: string; name: string; subtitle: string; assignedAt: string | null; href: string; wasUnread: boolean }>;
}) {
  if (items.length === 0) {
    return (
      <p style={{ padding: "1.5rem", textAlign: "center", fontSize: "12px", color: "var(--text-tertiary)" }}>
        Nothing here yet.
      </p>
    );
  }
  return (
    <div style={{ borderTop: "1px solid var(--rule)" }}>
      {items.map((it) => (
        <Link
          key={it.id}
          href={it.href}
          className="flex items-center justify-between transition-colors duration-150"
          style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid var(--surface-2)" }}
        >
          <div className="flex items-center gap-2">
            {it.wasUnread && (
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ink)", display: "inline-block" }}
              />
            )}
            <div>
              <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>{it.name}</p>
              <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>{it.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {it.assignedAt && (
              <span style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>
                {new Date(it.assignedAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
              </span>
            )}
            <ArrowUpRight className="h-3 w-3" style={{ color: "var(--ink)" }} />
          </div>
        </Link>
      ))}
    </div>
  );
}
