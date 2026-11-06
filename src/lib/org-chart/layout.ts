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
export type OutsidePerson = { userId: string; name: string };

export type Layout = {
  pos: Record<string, Placed>; // keyed by team id, plus "schools", "dir" and "outside"
  zones: Zone[];
  edges: Edge[];
  width: number;
  height: number;
  /** y of each Leadership-team leader row's centre, keyed by userId. */
  leadRowY: Record<string, number>;
  /**
   * People who hold a reporting line but are not a row on any team card.
   * Drawn as their own table so the line has somewhere to start.
   */
  outside: OutsidePerson[];
};

const ZONE_ORDER: OrgCluster[] = ["outward", "inward", "backbone", "parttime", "unplaced"];

/**
 * What a team's table shows, people first: every lead, then everyone else.
 * A child ministry adds a "within" row. The canvas keeps one OPEN row under
 * the names so the team view is one click away — it does not hide anyone.
 * Objectives are NOT on the canvas — they are one click away, in the drawer
 * and the team view.
 */
export function teamTableRows(t: OrgTeam) {
  const leads = t.members.filter((m) => m.isLead);
  const shown = t.members.filter((m) => !m.isLead);
  return { leads, shown, more: 0 };
}

export function teamRows(t: OrgTeam): number {
  const { leads, shown } = teamTableRows(t);
  return (t.parentId ? 1 : 0) + Math.max(leads.length, 1) + shown.length + 1;
}

/** Where a named person sits, so a reporting line can start on their row. */
type PersonRow = { teamId: string; y: number };

export function computeLayout(model: OrgModel, overrides: Record<string, { x: number; y: number }> = {}): Layout {
  const { LX, LW, ZX, CW, CG, HEAD, ROW, DIR_Y, PER_ROW } = GEO;
  const pos: Record<string, Placed> = {};
  const zones: Zone[] = [];
  const byId = new Map(model.teams.map((t) => [t.id, t]));

  // Parents before children, so a child ministry sits with the team it is within.
  const columnTeams = (cluster: OrgCluster) => {
    const inCluster = model.teams.filter((t) => t.cluster === cluster);
    const top = inCluster.filter((t) => !(t.parentId && byId.get(t.parentId)?.cluster === cluster));
    const out: OrgTeam[] = [];
    for (const t of top) {
      out.push(t);
      for (const child of inCluster.filter((k) => k.parentId === t.id)) out.push(child);
    }
    return out;
  };

  // ── Left column: every Leadership ministry, every Alongside ministry ──
  // The direction table and the OKR lines into it are NOT drawn on the resting
  // canvas (Jack, 2026-10-19: people first). Their place is reserved here so
  // nothing shifts when they appear: the canvas shows them only while a team
  // or a direction is selected, and only that team's lines.
  // The direction itself is placed after the "outside" table, further down,
  // because that table only exists once every roster row is known.
  const leadRowY: Record<string, number> = {};
  let leftY = DIR_Y;
  for (const t of columnTeams("leadership")) {
    if (t.id === model.leadershipId) {
      const h = HEAD + ROW * Math.max(model.leaders.length, 1);
      pos[t.id] = { x: LX, y: leftY, w: LW, h, cluster: "leadership" };
      model.leaders.forEach((l, i) => {
        leadRowY[l.userId] = leftY + HEAD + ROW * i + ROW / 2;
      });
      leftY += h + 16;
      continue;
    }
    const h = HEAD + ROW * teamRows(t);
    pos[t.id] = { x: LX, y: leftY, w: LW, h, cluster: "leadership" };
    leftY += h + 16;
  }

  for (const t of columnTeams("alongside")) {
    const h = HEAD + ROW * teamRows(t);
    pos[t.id] = { x: LX, y: leftY, w: LW, h, cluster: "alongside" };
    leftY += h + 16;
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

  // A reporting line needs a row to start from. Anyone who holds one and is
  // not on a drawn roster gets a row of their own, under the left column.
  const onACard = new Set<string>();
  for (const t of model.teams) {
    if (!pos[t.id]) continue;
    for (const m of t.members) onACard.add(m.userId);
  }
  const outsideById = new Map<string, string>();
  for (const t of model.teams) {
    for (const l of t.lines) {
      if (!onACard.has(l.userId) && !outsideById.has(l.userId)) outsideById.set(l.userId, l.name);
    }
  }
  const outside: OutsidePerson[] = [...outsideById.entries()]
    .map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (outside.length) {
    const h = HEAD + ROW * outside.length;
    pos.outside = { x: LX, y: leftY, w: LW, h, cluster: "leadership" };
    leftY += h + 16;
  }
  pos.dir = { x: LX, y: leftY, w: LW, h: HEAD + GEO.DIR_H * model.directions.length, cluster: "leadership" };

  // Row centres from the positions actually drawn (after a saved move).
  const personRows = new Map<string, PersonRow[]>();
  const remember = (userId: string, row: PersonRow) => {
    const list = personRows.get(userId) ?? [];
    list.push(row);
    personRows.set(userId, list);
  };
  if (model.leadershipId && pos[model.leadershipId]) {
    const card = pos[model.leadershipId];
    model.leaders.forEach((l, i) => {
      const y = card.y + HEAD + ROW * i + ROW / 2;
      leadRowY[l.userId] = y;
      remember(l.userId, { teamId: model.leadershipId!, y });
    });
  }
  for (const t of model.teams) {
    if (t.id === model.leadershipId || !pos[t.id]) continue;
    for (const row of memberCenters(pos[t.id].y, t)) remember(row.userId, { teamId: t.id, y: row.y });
  }
  outside.forEach((p, i) => {
    remember(p.userId, { teamId: "outside", y: pos.outside.y + HEAD + ROW * i + ROW / 2 });
  });

  // ── Lines ──
  const edges: Edge[] = [];
  const left = (id: string): [number, number, number] => [pos[id].x, pos[id].y + HEAD / 2, -1];
  const right = (id: string): [number, number, number] => [pos[id].x + pos[id].w, pos[id].y + HEAD / 2, 1];

  const dirIdx = new Map(model.directions.map((d, i) => [d.key, i]));
  for (const t of model.teams) {
    if (!pos[t.id]) continue;
    for (const o of t.objectives) {
      if (!o.direction) continue;
      const from: [number, number, number] = [LX + LW, pos.dir.y + HEAD + GEO.DIR_H * dirIdx.get(o.direction)! + GEO.DIR_H / 2, 1];
      // Teams in the left column (Leadership, Missio) are met on their right edge.
      const to: [number, number, number] = pos[t.id].x === LX ? right(t.id) : left(t.id);
      edges.push({ a: "dir:" + o.direction, b: "team:" + t.id, kind: "okr", state: o.state, from, to });
    }
  }

  for (const t of model.teams) {
    if (!pos[t.id]) continue;
    for (const l of t.lines) {
      const fromRow = pickPersonRow(personRows.get(l.userId) ?? [], t.id);
      if (!fromRow || !pos[fromRow.teamId]) continue;
      const src = pos[fromRow.teamId];
      const dst = pos[t.id];
      // Same column: bow out to the right. A team to the right is met on its
      // left edge; a team to the left is met on its right edge.
      const sameColumn = src.x === dst.x;
      const targetToTheRight = dst.x + dst.w / 2 >= src.x + src.w / 2;
      const fromX = sameColumn || targetToTheRight ? src.x + src.w : src.x;
      const fromDir = sameColumn || targetToTheRight ? 1 : -1;
      const toX = sameColumn ? dst.x + dst.w : targetToTheRight ? dst.x : dst.x + dst.w;
      const toDir = sameColumn ? 1 : targetToTheRight ? -1 : 1;
      const toY = dst.y + HEAD / 2;
      // A person overseeing their own card still gets a line, bowed out to the right.
      // The id matches the row the canvas draws, so selecting that person lights the line.
      const anchorId =
        fromRow.teamId === model.leadershipId || fromRow.teamId === "outside" ? "lead:" + l.userId : "person:" + l.userId;
      if (l.kind === "alongside") {
        edges.push({
          a: anchorId,
          b: "team:" + t.id,
          kind: "alongside",
          from: [fromX, fromRow.y, fromDir],
          to: [toX, toY, toDir],
        });
      } else {
        edges.push({
          a: anchorId,
          b: "team:" + t.id,
          kind: "report",
          label: l.kind,
          from: [fromX, fromRow.y, fromDir],
          to: [toX, toY, toDir],
        });
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
    outside,
  };
}

/** Centre of each named row on a normal team card (within, leads, everyone else). */
function memberCenters(cardY: number, t: OrgTeam): { userId: string; y: number }[] {
  const { leads, shown } = teamTableRows(t);
  let i = t.parentId ? 1 : 0;
  const out: { userId: string; y: number }[] = [];
  const push = (userId: string) => {
    out.push({ userId, y: cardY + GEO.HEAD + GEO.ROW * i + GEO.ROW / 2 });
    i += 1;
  };
  if (leads.length === 0) i += 1;
  else for (const m of leads) push(m.userId);
  for (const m of shown) push(m.userId);
  return out;
}

/** Prefer a row on another card, and a Leadership-team row over any other. */
function pickPersonRow(rows: PersonRow[], targetTeamId: string): PersonRow | undefined {
  if (rows.length === 0) return undefined;
  const elsewhere = rows.filter((r) => r.teamId !== targetTeamId);
  const pool = elsewhere.length ? elsewhere : rows;
  return pool.find((r) => r.teamId !== "outside") ?? pool[0];
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
