// ============================================================
// GET /api/mobile/okrs and /api/mobile/okrs/[ownerId] — response
// contract (pure, tested)
// ============================================================
// The phone app's OKR wall and one group's OKRs. The website renders these
// pages on the server (src/app/(admin)/okrs/page.tsx and [ownerId]/page.tsx),
// so there was no JSON for the app to read. These helpers shape the same
// rows those pages fetch, through the same roll-ups (summariseByOwner,
// totals, writesOkrs, krProgress, metricCaption), so the phone never carries
// its own copy of the formulae.
//
// Nothing here decides access. The routes pass in the answers from the same
// helpers the pages use (callerIsAdmin, isLeadershipTeam, getLedMinistryIds,
// callerCanEditMinistryOkrs); RLS decides which rows exist at all.
// ============================================================

import { krProgress, metricCaption } from "@/lib/okrs/progress";
import { summariseByOwner, toOwners, totals, writesOkrs } from "@/lib/okrs/summary";
import {
  MINISTRY_TYPES,
  MINISTRY_TYPE_SECTION_LABELS,
  ministryTypeOf,
  type MinistryType,
} from "@/lib/ministries/ministry-type";
import type { OkrCycle, OkrKeyResult, OkrObjective, OkrStatus } from "@/types/okrs";

export type MobileOkrCycle = {
  id: string;
  name: string;
  slug: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
};

export type MobileOkrOwner = {
  id: string;
  name: string;
  kind: "ministry" | "team";
  /** Inactive ministry still on the wall because it has objectives this cycle. */
  retired: boolean;
  objectives: number;
  keyResults: number;
  byStatus: Record<OkrStatus, number>;
};

export type MobileOkrWallSection = {
  type: MinistryType;
  label: string;
  /** Every group of this kind on the wall, started or not. */
  total: number;
  started: MobileOkrOwner[];
  /** Empty unless the caller may see the gap list (and the cycle is current). */
  notStarted: MobileOkrOwner[];
};

export type MobileOkrWall = {
  cycles: MobileOkrCycle[];
  cycle: MobileOkrCycle | null;
  /** Leadership / admin: the website's Cycles page is worth a link. */
  canManageCycles: boolean;
  /** Admin, leadership team, or leads a ministry (the web's seesGaps). */
  seesGaps: boolean;
  totals: {
    groups: number;
    groupsStarted: number;
    objectives: number;
    keyResults: number;
    complete: number;
    stuck: number;
  };
  sections: MobileOkrWallSection[];
  /** Section headings only appear when there is more than one section. */
  showHeadings: boolean;
};

export type MobileKeyResult = {
  id: string;
  label: string | null;
  description: string;
  timeline: string | null;
  notes: string | null;
  ownerNote: string | null;
  status: OkrStatus;
  currentValue: number | null;
  metricUnit: string | null;
  /** True when the key result tracks a figure (start and target are set). */
  hasMetric: boolean;
  /** 0–100 toward the target, or null: no ratio, no bar. */
  progressPct: number | null;
  /** "120 / 180 people", or null. */
  caption: string | null;
  lastCheckinAt: string | null;
};

export type MobileObjective = {
  id: string;
  position: number;
  title: string;
  description: string | null;
  timeline: string | null;
  notes: string | null;
  ownerNote: string | null;
  keyResults: MobileKeyResult[];
};

export type MobileOkrOwnerPage = {
  owner: { id: string; name: string; kind: "ministry" | "team" };
  cycles: MobileOkrCycle[];
  cycle: MobileOkrCycle;
  /** May post check-ins: leads this ministry (or admin) AND the cycle is current. */
  canEdit: boolean;
  /** Why it is read-only, so the app can say so calmly. Null when editable. */
  readOnly: "closed" | "read_access" | null;
  totals: { objectives: number; keyResults: number; complete: number; stuck: number };
  objectives: MobileObjective[];
};

type MinistryRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  ministry_type: string | null;
};

// ── Cycles ─────────────────────────────────────────────────────────────────

export function toMobileCycle(c: OkrCycle): MobileOkrCycle {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    startsOn: c.starts_on,
    endsOn: c.ends_on,
    isCurrent: !!c.is_current,
  };
}

/**
 * The cycle a page shows: the one asked for by slug, else the current one,
 * else the newest. Same order as the website pages; resolved from the list
 * they already fetch (listCycles), so no second query.
 */
export function pickCycle(cycles: OkrCycle[], slug: string | null | undefined): OkrCycle | null {
  const requested = slug ? cycles.find((c) => c.slug === slug) : undefined;
  return requested ?? cycles.find((c) => c.is_current) ?? cycles[0] ?? null;
}

// ── The wall ───────────────────────────────────────────────────────────────

/**
 * The wall for one cycle, mirroring src/app/(admin)/okrs/page.tsx line for
 * line: which ministries appear, Main / Part-time sections, and the
 * "not started" list only for people who can act on it, only on the
 * current cycle.
 */
export function buildWall(input: {
  cycles: OkrCycle[];
  cycle: OkrCycle;
  objectives: OkrObjective[];
  ministries: MinistryRow[];
  seesGaps: boolean;
  canManageCycles: boolean;
}): MobileOkrWall {
  const { cycle, objectives, seesGaps } = input;

  // Anything with objectives stays on the wall; otherwise active and the
  // kind of ministry that writes OKRs (see the page for why).
  const withObjectives = new Set(
    objectives.map((o) => o.staff_ministry_id).filter((id): id is string => !!id)
  );
  const ministries = input.ministries.filter(
    (m) => withObjectives.has(m.id) || (m.is_active && writesOkrs(m))
  );
  const retiredIds = new Set(ministries.filter((m) => !m.is_active).map((m) => m.id));

  const summaries = summariseByOwner(objectives, toOwners(ministries, []));
  const started = summaries.filter((s) => s.objectives > 0);
  const notStarted = summaries.filter((s) => s.objectives === 0);
  const t = totals(objectives);

  const showNotStarted = seesGaps && cycle.is_current && notStarted.length > 0;

  const toOwner = (s: (typeof summaries)[number]): MobileOkrOwner => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    retired: retiredIds.has(s.id),
    objectives: s.objectives,
    keyResults: s.keyResults,
    byStatus: s.byStatus,
  });

  const typeById = new Map(ministries.map((m) => [m.id, ministryTypeOf(m.ministry_type)]));
  const sections = MINISTRY_TYPES.map((type) => ({
    type,
    label: MINISTRY_TYPE_SECTION_LABELS[type],
    total: summaries.filter((s) => typeById.get(s.id) === type).length,
    started: started.filter((s) => typeById.get(s.id) === type).map(toOwner),
    notStarted: showNotStarted
      ? notStarted.filter((s) => typeById.get(s.id) === type).map(toOwner)
      : [],
  })).filter((s) => s.started.length > 0 || s.notStarted.length > 0);

  return {
    cycles: input.cycles.map(toMobileCycle),
    cycle: toMobileCycle(cycle),
    canManageCycles: input.canManageCycles,
    seesGaps,
    totals: {
      groups: summaries.length,
      groupsStarted: started.length,
      objectives: t.objectives,
      keyResults: t.keyResults,
      complete: t.byStatus.complete,
      stuck: t.byStatus.stuck,
    },
    sections,
    showHeadings: sections.length > 1,
  };
}

// ── One group's OKRs ───────────────────────────────────────────────────────

export function toMobileKeyResult(kr: OkrKeyResult): MobileKeyResult {
  const progress = krProgress(kr);
  return {
    id: kr.id,
    label: kr.label ?? null,
    description: kr.description,
    timeline: kr.timeline ?? null,
    notes: kr.notes ?? null,
    ownerNote: kr.owner_note ?? null,
    status: kr.current_status,
    currentValue: kr.current_value ?? null,
    metricUnit: kr.metric_unit ?? null,
    hasMetric:
      kr.metric_start !== null &&
      kr.metric_start !== undefined &&
      kr.metric_target !== null &&
      kr.metric_target !== undefined,
    progressPct: progress ? Math.round(progress.pct) : null,
    caption: metricCaption(kr),
    lastCheckinAt: kr.last_checkin_at ?? null,
  };
}

export function buildOwnerPage(input: {
  owner: { id: string; name: string; kind: "ministry" | "team" };
  cycles: OkrCycle[];
  cycle: OkrCycle;
  objectives: OkrObjective[];
  canEditOwner: boolean;
}): MobileOkrOwnerPage {
  const { cycle, objectives, canEditOwner } = input;
  const t = totals(objectives);
  // Past cycles are a record, not a workspace (same rule as the web page).
  const canEdit = canEditOwner && !!cycle.is_current;
  return {
    owner: input.owner,
    cycles: input.cycles.map(toMobileCycle),
    cycle: toMobileCycle(cycle),
    canEdit,
    readOnly: canEdit ? null : !cycle.is_current ? "closed" : "read_access",
    totals: {
      objectives: t.objectives,
      keyResults: t.keyResults,
      complete: t.byStatus.complete,
      stuck: t.byStatus.stuck,
    },
    objectives: objectives.map((o) => ({
      id: o.id,
      position: o.position,
      title: o.title,
      description: o.description ?? null,
      timeline: o.timeline ?? null,
      notes: o.notes ?? null,
      ownerNote: o.owner_note ?? null,
      keyResults: (o.okr_key_results ?? []).map(toMobileKeyResult),
    })),
  };
}
