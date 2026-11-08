"use client";

// Copied into src/app/legal/layout-fixtures/page.tsx by
// scripts/verify-hub-layouts.mjs, then deleted. Not a route in the repo.
// Invented model. The ?role=reader query is a mocked canManage={false} prop.
// It is not a session and does not prove RLS.

import { useEffect, useMemo, useState } from "react";
import { buildOrgModel, type OrgInput } from "@/lib/org-chart/model";
import { OrgCanvas } from "@/app/(admin)/org-chart/org-canvas";
import { OrgPhone } from "@/app/(admin)/org-chart/org-phone";

function fixtureInput(): OrgInput {
  const member = (
    id: string,
    team: string,
    user: string,
    role: "leader" | "member",
    title: string | null,
    responsibilities: string[] = []
  ) => ({
    id,
    staff_ministry_id: team,
    user_id: user,
    member_role: role,
    is_point_leader: false,
    role_title: title,
    responsibilities,
    share_pct: null,
    staff_kind: null,
    subcategories: [] as string[],
  });
  return {
    teams: [
      { id: "lt", name: "Leadership Team", slug: "leadership_team", cluster: "leadership", parent_id: null, purpose: "The base", description: null, ministry_type: "main", sort_order: 1 },
      { id: "lt2", name: "Trustees", slug: "trustees", cluster: "leadership", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 2 },
      { id: "missio", name: "Missio", slug: "missio", cluster: "alongside", parent_id: null, purpose: "Church", description: null, ministry_type: "main", sort_order: 3 },
      { id: "missio2", name: "Alongside Two", slug: "alongside_two", cluster: "alongside", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 4 },
      { id: "media", name: "Media", slug: "media", cluster: "backbone", parent_id: null, purpose: "Tell the story", description: null, ministry_type: "main", sort_order: 5 },
      { id: "events", name: "Events", slug: "events", cluster: "outward", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 6 },
      { id: "empty", name: "Empty Roster", slug: "empty_roster", cluster: "backbone", parent_id: null, purpose: null, description: null, ministry_type: "main", sort_order: 7 },
    ],
    members: [
      member("m1", "lt", "gabriel", "leader", "Visionary", ["Holds the base"]),
      member("m2", "lt", "caleb", "member", "Integrator", ["Day to day"]),
      member("m3", "missio", "gabriel", "leader", "Lead pastor", ["Missio"]),
      member("m4", "media", "steph", "leader", "Media lead", ["Runs media"]),
      member("m6", "events", "steph", "member", "Events media", ["Covers events"]),
      member("m7", "events", "brendon", "leader", "finance", []),
      member("m8", "events", "dwayne", "member", null, []),
      member("m9", "lt2", "ally", "leader", "Operator", ["Operates"]),
      ...Array.from({ length: 8 }, (_, i) => member("x" + i, "missio2", "p" + i, i === 0 ? "leader" : "member", null)),
    ],
    people: [
      { id: "gabriel", name: "Gabriël Strydom", job_title: null },
      { id: "caleb", name: "Caleb Cox", job_title: null },
      { id: "steph", name: "Stephanie Mensah", job_title: null },
      { id: "brendon", name: "Brendon Homan", job_title: "Business Development" },
      { id: "dwayne", name: "Dwayne Roberts", job_title: null },
      { id: "ally", name: "Allyson Roestorf", job_title: null },
      { id: "nia", name: "Nia Not On Roster", job_title: null },
      ...Array.from({ length: 8 }, (_, i) => ({ id: "p" + i, name: "Person " + i, job_title: null })),
    ],
    lines: [
      { staff_ministry_id: "lt", leader_user_id: "caleb", kind: "integrates", label: "Integrator" },
      { staff_ministry_id: "media", leader_user_id: "gabriel", kind: "oversees", label: null },
      { staff_ministry_id: "events", leader_user_id: "nia", kind: "oversees", label: null },
    ],
    objectives: [
      {
        id: "o1",
        staff_ministry_id: "media",
        title: "Tell it",
        description: null,
        direction: "mission",
        position: 1,
        krs: [
          {
            id: "k1",
            description: "Film the story",
            position: 0,
            current_status: "in_progress",
            current_value: null,
            metric_start: null,
            metric_target: null,
            metric_unit: null,
            owner_user_id: "nia",
            owner_note: null,
            last_checkin_at: null,
          },
        ],
      },
    ],
    shepherds: [],
    schools: [],
    cycleName: "FIXTURE",
    updateMonthStart: "2026-10-01",
  };
}

export default function LayoutFixturesPage() {
  const model = useMemo(() => buildOrgModel(fixtureInput()), []);
  const [role, setRole] = useState<"manager" | "reader" | null>(null);
  useEffect(() => {
    const reader = new URLSearchParams(window.location.search).get("role") === "reader";
    setRole(reader ? "reader" : "manager");
  }, []);
  useEffect(() => {
    if (!role) return;
    document.documentElement.dataset.fixtureRole = role;
    document.documentElement.dataset.fixtureReady = "1";
  }, [role]);
  if (!role) return <p data-fixture="loading">FIXTURE loading</p>;
  const canManage = role === "manager";
  return (
    <div>
      <p data-fixture="banner" className="bg-black px-3 py-2 font-mono text-[10px] text-white">
        FIXTURE — invented model, mocked canManage={String(canManage)}, not a session
      </p>
      <section data-fixture="chart">
        <div className="xl:hidden">
          <OrgPhone model={model} canManage={canManage} />
        </div>
        {canManage ? (
          <div className="hidden xl:block" style={{ height: "100vh" }}>
            <OrgCanvas model={model} savedLayout={{}} canManage />
          </div>
        ) : null}
      </section>
    </div>
  );
}
