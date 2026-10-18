// Where everything sits on the 40a canvas, and where the lines run. Same
// geometry as the design file's orgView(): a left column (direction, the
// Leadership team, Missio) and cluster zones of up-to-four 190px tables.
// org_layout rows (migration 250) override a team's position when present —
// the one thing the chart is allowed to store.

import type { OrgCluster, OrgModel, OrgState, OrgTeam } from "./model";

export const GEO = {
  LX: 36,
  LW: 250,
  ZX: 330,
  CW: 190,
  CG: 20,
  HEAD: 34,
  ROW: 28,
  DIR_Y: 24,
  DIR_H: 40,
  PER_ROW: 4,
} as const;

export type NodeId = string; // "team:<id>" | "lead:<userId>" | "dir:<key>" | "schools" | "person:<userId>"

export type Placed = { x: number; y: number; w: number; h: number; cluster: OrgCluster };
export type Zone = { x: number; y: number; w: number; h: number; label: string; meta: string };
export type Edge = {
  a: NodeId;
  b: NodeId;
  kind: "okr" | "report" | "works" | "alongside";
  state?: OrgState;
  label?: string;
  from: [number, number, number];
  to: [number, number, number];
};
export type Layout = {
  pos: Record<string, Placed>; // keyed by team id, plus "schools" and "dir"
  zones: Zone[];
  edges: Edge[];
  width: number;
  height: number;
  /** y of each Leadership-team leader row's centre, keyed by userId. */
  leadRowY: Record<string, number>;
};

const ZONE_ORDER: OrgCluster[] = ["outward", "inward", "backbone", "parttime", "unplaced"];

/** A team table's rows: lead, one per objective (at least one), people. */
export function teamRows(t: OrgTeam): number {
  return Math.max(t.objectives.length, 1) + 2;
}

export function computeLayout(model: OrgModel, overrides: Record<string, { x: number; y: number }> = {}): Layout {
  const { LX, LW, ZX, CW, CG, HEAD, ROW, DIR_Y, DIR_H, PER_ROW } = GEO;
  const pos: Record<string, Placed> = {};
  const zones: Zone[] = [];
  const byId = new Map(model.teams.map((t) => [t.id, t]));

  // ── Left column ──
  const dirH = HEAD + DIR_H * model.directions.length;
  pos.dir = { x: LX, y: DIR_Y, w: LW, h: dirH, cluster: "leadership" };

  const leadership = model.leadershipId ? byId.get(model.leadershipId) : undefined;
  const leadY = DIR_Y + dirH + 18;
  const leadObjRows = Math.max(leadership?.objectives.length ?? 0, 1);
  const leadRowY: Record<string, number> = {};
  if (leadership) {
    const h = HEAD + ROW * (leadObjRows + Math.max(model.leaders.length, 1));
    pos[leadership.id] = { x: LX, y: leadY, w: LW, h, cluster: "leadership" };
    model.leaders.forEach((l, i) => (leadRowY[l.userId] = leadY + HEAD + ROW * (leadObjRows + i) + ROW / 2));
  }
  const afterLead = leadership ? pos[leadership.id].y + pos[leadership.id].h + 30 : leadY;

  const missio = model.missioId ? byId.get(model.missioId) : undefined;
  if (missio) {
    pos[missio.id] = { x: LX, y: afterLead, w: LW, h: HEAD + ROW * Math.max(missio.groups.length, 1), cluster: "alongside" };
  }

  // ── Cluster zones ──
  // Children sit straight after their parent, so Training's schools read
  // as Training's. The "schools in session" table follows Training.
  const zoneTeams = (c: OrgCluster) => {
    const top = model.teams.filter((t) => t.cluster === c && t.id !== model.leadershipId && t.id !== model.missioId && !(t.parentId && byId.get(t.parentId)?.cluster === c));
    const out: (OrgTeam | "schools")[] = [];
    for (const t of top) {
      out.push(t);
      for (const child of model.teams.filter((k) => k.parentId === t.id && k.cluster === c)) out.push(child);
      if (c === "inward" && /training/i.test(t.name) && model.schools.length) out.push("schools");
    }
    return out;
  };

  let cy = DIR_Y;
  for (const c of ZONE_ORDER) {
    const items = zoneTeams(c);
    if (!items.length) continue;
    const zy = cy;
    let y = zy + 34;
    let teams = 0;
    const people = new Set<string>();
    for (let i = 0; i < items.length; i += PER_ROW) {
      const row = items.slice(i, i + PER_ROW);
      let h = 0;
      row.forEach((item, col) => {
        const x = ZX + col * (CW + CG);
        if (item === "schools") {
          const th = HEAD + ROW * model.schools.length;
          pos.schools = { x, y, w: CW, h: th, cluster: c };
          h = Math.max(h, th);
          return;
        }
        const th = HEAD + ROW * teamRows(item);
        pos[item.id] = { x, y, w: CW, h: th, cluster: c };
        teams += 1;
        item.members.forEach((m) => people.add(m.userId));
        h = Math.max(h, th);
      });
      y += h + 16;
    }
    const bottom = y - 2;
    zones.push({
      x: ZX - 18,
      y: zy,
      w: PER_ROW * CW + (PER_ROW - 1) * CG + 36,
      h: bottom - zy,
      label: clusterTitle(c),
      meta: `${teams} ${teams === 1 ? "TEAM" : "TEAMS"} · ${people.size} ${people.size === 1 ? "PERSON" : "PEOPLE"}`,
    });
    cy = bottom + 18;
  }

  // Saved positions win over the automatic layout.
  for (const [id, p] of Object.entries(overrides)) if (pos[id]) pos[id] = { ...pos[id], x: p.x, y: p.y };

  // ── Lines ──
  const edges: Edge[] = [];
  const left = (id: string): [number, number, number] => [pos[id].x, pos[id].y + HEAD / 2, -1];
  const right = (id: string): [number, number, number] => [pos[id].x + pos[id].w, pos[id].y + HEAD / 2, 1];
  const dirIdx = new Map(model.directions.map((d, i) => [d.key, i]));

  for (const t of model.teams) {
    if (!pos[t.id]) continue;
    t.objectives.forEach((o, j) => {
      if (!o.direction) return;
      const from: [number, number, number] = [LX + LW, DIR_Y + HEAD + DIR_H * dirIdx.get(o.direction)! + DIR_H / 2, 1];
      const to: [number, number, number] =
        t.id === model.leadershipId
          ? [LX + LW, pos[t.id].y + HEAD + ROW * j + ROW / 2, 1]
          : [pos[t.id].x, pos[t.id].y + HEAD + ROW * (1 + j) + ROW / 2, -1];
      edges.push({ a: "dir:" + o.direction, b: "team:" + t.id, kind: "okr", state: o.state, from, to });
    });
  }

  for (const t of model.teams) {
    if (!pos[t.id] || t.id === model.leadershipId) continue;
    for (const l of t.lines) {
      const y = leadRowY[l.userId];
      if (y === undefined) continue; // overseen by someone not on the Leadership team: shown in the drawer only
      if (l.kind === "alongside") {
        edges.push({ a: "lead:" + l.userId, b: "team:" + t.id, kind: "alongside", from: [LX, y, -1], to: [LX, pos[t.id].y + HEAD / 2, -1] });
      } else {
        edges.push({ a: "lead:" + l.userId, b: "team:" + t.id, kind: "report", label: l.kind, from: [LX + LW, y, 1], to: left(t.id) });
      }
    }
  }

  for (const s of model.shared) {
    if (!pos[s.a] || !pos[s.b]) continue;
    const sx = pos[s.a].x;
    const tx = pos[s.b].x;
    const [from, to] = tx > sx ? [right(s.a), left(s.b)] : tx < sx ? [left(s.a), right(s.b)] : [right(s.a), right(s.b)];
    edges.push({ a: "team:" + s.a, b: "team:" + s.b, kind: "works", label: "Shared: " + s.people.join(", "), from, to });
  }

  const training = model.teams.find((t) => pos.schools && pos[t.id] && /training/i.test(t.name));
  if (training && pos.schools) {
    edges.push({ a: "team:" + training.id, b: "schools", kind: "works", label: "Schools in session", from: right(training.id), to: left("schools") });
  }

  const all = Object.values(pos);
  return {
    pos,
    zones,
    edges,
    width: Math.max(...all.map((p) => p.x + p.w), ZX + PER_ROW * (CW + CG)) + 40,
    height: Math.max(...all.map((p) => p.y + p.h), ...zones.map((z) => z.y + z.h)) + 40,
    leadRowY,
  };
}

function clusterTitle(c: OrgCluster): string {
  return {
    leadership: "LEADERSHIP",
    outward: "OUTWARD · MISSION",
    inward: "INWARD · FORMATION",
    backbone: "BACKBONE · SUPPORT",
    alongside: "ALONGSIDE",
    parttime: "PART-TIME MINISTRIES",
    unplaced: "NOT PLACED YET",
  }[c];
}

/** The cubic the design uses: horizontal tangents, pulled by direction. */
export function bezier([x1, y1, d1]: [number, number, number], [x2, y2, d2]: [number, number, number]): string {
  const k = Math.max(x1 === x2 ? 70 : 36, Math.abs(x2 - x1) * 0.45);
  return `M${x1},${y1} C${x1 + d1 * k},${y1} ${x2 + d2 * k},${y2} ${x2},${y2}`;
}

/** What lights up when `sel` is chosen, given the visible lines. */
export function litSet(sel: NodeId | null, edges: Edge[], extra: NodeId[] = []): Set<NodeId> {
  const lit = new Set<NodeId>(sel ? [sel, ...extra] : []);
  if (!sel) return lit;
  for (const e of edges) {
    if (e.a === sel) lit.add(e.b);
    if (e.b === sel) lit.add(e.a);
  }
  return lit;
}
