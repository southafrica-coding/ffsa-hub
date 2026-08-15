import { Position, type Node as RFNode, type Edge as RFEdge } from "@xyflow/react";
import type { OrgNode, OrgEdge } from "@/services/org-chart";

// ── Accent palette (hex for edge strokes; cards use CSS vars + data-accent) ──
type Theme = "paper" | "dark";
const ACCENT_HEX: Record<Theme, Record<string, string>> = {
  paper: { outward: "#B5703F", inward: "#5C7A56", backbone: "#5E7187", gold: "#B68A3C", sand: "#9C9377", copper: "#B5703F" },
  dark: { outward: "#D08A4F", inward: "#74A56E", backbone: "#7C9AC0", gold: "#D7AA4E", sand: "#9A9079", copper: "#D08A4F" },
};
export function accentColor(key: string | null | undefined, theme: Theme = "dark"): string {
  const k = key ?? "sand";
  return ACCENT_HEX[theme][k] ?? ACCENT_HEX[theme].sand;
}

// ── Layout geometry ──────────────────────────────────────────────────────
const COL = { w: 300, gap: 32, pad: 14, indent: 16, headerH: 40 };
const H = { root: 100, leadership: 112, role: 88, team: 94, subteam: 40, person: 58, stream: 62, missioHead: 80 };
const ROW = 12;
const NEST = 7;

export type Member = { label: string; subtitle: string | null };
export type FlowNodeData = {
  node: OrgNode;
  hasChildren: boolean;
  childCount: number;
  expanded: boolean;
  dimmed: boolean;
  matched: boolean;
  members?: Member[]; // leadership chips
  laneCount?: string; // lane caption "6 teams · 66"
};

type BuildArgs = { nodes: OrgNode[]; edges: OrgEdge[]; expanded: Set<string>; query?: string; theme?: Theme };
type BuildResult = { rfNodes: RFNode<FlowNodeData>[]; rfEdges: RFEdge[]; matchIds: string[] };

const sortKids = (a: OrgNode, b: OrgNode) => a.sort_order - b.sort_order || a.label.localeCompare(b.label);

export function buildGraph({ nodes, edges, expanded, query, theme = "dark" }: BuildArgs): BuildResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const kids = new Map<string, OrgNode[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    const a = kids.get(n.parent_id) ?? [];
    a.push(n);
    kids.set(n.parent_id, a);
  }
  const childrenOf = (id: string) => (kids.get(id) ?? []).slice().sort(sortKids);
  const isOpen = (id: string) => expanded.has(id);

  // search
  const q = (query ?? "").trim().toLowerCase();
  const matchIds: string[] = [];
  if (q) for (const n of nodes) {
    if (n.label.toLowerCase().includes(q) || (n.subtitle ?? "").toLowerCase().includes(q)) matchIds.push(n.id);
  }
  const matchSet = new Set(matchIds);

  const rfNodes: RFNode<FlowNodeData>[] = [];
  const rfEdges: RFEdge[] = [];
  const visible = new Set<string>();

  const mk = (
    n: OrgNode,
    type: string,
    x: number, y: number, w: number, h: number,
    extra: Partial<FlowNodeData> = {},
    z = 1
  ) => {
    visible.add(n.id);
    rfNodes.push({
      id: n.id, type,
      position: { x, y },
      width: w, height: h,
      draggable: false, selectable: type !== "lane",
      zIndex: z,
      sourcePosition: Position.Bottom, targetPosition: Position.Top,
      data: {
        node: n,
        hasChildren: (kids.get(n.id)?.length ?? 0) > 0,
        childCount: kids.get(n.id)?.length ?? 0,
        expanded: isOpen(n.id),
        dimmed: q.length > 0 && !matchSet.has(n.id),
        matched: matchSet.has(n.id),
        ...extra,
      },
    });
  };

  // ── geometry anchors ──
  const lanesW = 3 * COL.w + 2 * COL.gap;
  const centerX = lanesW / 2;
  const laneXOf = (i: number) => i * (COL.w + COL.gap);

  // root
  const root = byKey.get("ffsa");
  const rootW = 340;
  const rootBottom = H.root;
  if (root) mk(root, "root", centerX - rootW / 2, 0, rootW, H.root);

  // leadership + integrator
  const leadership = byKey.get("leadership");
  const integrator = byKey.get("integrator");
  const leadW = 330, integW = 224, gapLI = 18;
  const pairStart = centerX - (leadW + gapLI + integW) / 2;
  const leadY = rootBottom + 46;
  if (leadership) {
    const members: Member[] = childrenOf(leadership.id)
      .filter((c) => c.kind === "person")
      .map((c) => ({ label: c.label, subtitle: c.subtitle }));
    mk(leadership, "leadership", pairStart, leadY, leadW, H.leadership, { members });
  }
  if (integrator) mk(integrator, "role", pairStart + leadW + gapLI, leadY + (H.leadership - H.role) / 2, integW, H.role);
  const leadBottom = leadY + H.leadership;

  // clusters as lanes
  const clusters = nodes.filter((n) => n.kind === "cluster").sort(sortKids);
  const lanesTop = leadBottom + 52;

  const layoutChildren = (parentId: string, laneX: number, depth: number, cursor: { y: number }) => {
    const x = laneX + COL.pad + depth * COL.indent;
    const w = COL.w - 2 * COL.pad - depth * COL.indent;
    for (const c of childrenOf(parentId)) {
      if (c.kind === "subteam") {
        mk(c, "subteam", x, cursor.y, w, H.subteam);
        cursor.y += H.subteam + NEST;
        if (isOpen(c.id)) layoutChildren(c.id, laneX, depth + 1, cursor);
      } else if (c.kind === "person" || c.kind === "role") {
        mk(c, "person", x, cursor.y, w, H.person);
        cursor.y += H.person + NEST;
      }
    }
  };

  clusters.forEach((cluster, i) => {
    const laneX = laneXOf(i);
    const teams = childrenOf(cluster.id).filter((t) => t.kind === "team" || t.kind === "person" || t.kind === "role");
    const contentTop = lanesTop + COL.headerH;
    const cursor = { y: contentTop };
    for (const t of teams) {
      if (t.kind === "team") {
        mk(t, "team", laneX + COL.pad, cursor.y, COL.w - 2 * COL.pad, H.team);
        cursor.y += H.team + ROW;
        if (isOpen(t.id)) layoutChildren(t.id, laneX, 1, cursor);
      } else {
        mk(t, "person", laneX + COL.pad, cursor.y, COL.w - 2 * COL.pad, H.person);
        cursor.y += H.person + ROW;
      }
    }
    const laneH = cursor.y - lanesTop + COL.pad;
    const headcount = teams.reduce((s, t) => s + (t.headcount ?? 0), 0);
    const teamCount = teams.filter((t) => t.kind === "team").length;
    rfNodes.push({
      id: `lane-${cluster.id}`, type: "lane",
      position: { x: laneX, y: lanesTop },
      width: COL.w, height: laneH,
      draggable: false, selectable: false, zIndex: 0,
      targetPosition: Position.Top,
      data: {
        node: cluster, hasChildren: false, childCount: teamCount,
        expanded: true, dimmed: false, matched: false,
        laneCount: `${teamCount} teams · ${headcount}`,
      },
    });
    visible.add(`lane-${cluster.id}`);
    if (integrator) rfEdges.push({
      id: `s-int-${cluster.id}`, source: integrator.id, target: `lane-${cluster.id}`,
      type: "smoothstep", style: { stroke: theme === "paper" ? "#B9AC8A" : "#3C3528", strokeWidth: 1 }, zIndex: 0,
    });
  });

  // missio alongside column
  const missio = byKey.get("missio");
  if (missio) {
    const mx = 3 * (COL.w + COL.gap) + 4;
    const mw = 250;
    let y = lanesTop;
    const chain = ["missio", "missio-leaders", "missio-comm", "missio-groups", "missio-disc"];
    chain.forEach((k, idx) => {
      const node = byKey.get(k);
      if (!node) return;
      const h = idx === 0 ? H.missioHead : H.stream;
      mk(node, "stream", mx, y, mw, h);
      if (idx > 0) {
        const prev = byKey.get(chain[idx - 1]);
        if (prev) rfEdges.push({
          id: `m-${k}`, source: prev.id, target: node.id, type: "smoothstep",
          style: { stroke: accentColor("sand", theme), strokeWidth: 1, strokeDasharray: "3 4", opacity: 0.6 },
        });
      }
      y += h + ROW;
    });
    if (leadership) rfEdges.push({
      id: "m-alongside", source: leadership.id, target: missio.id, type: "smoothstep",
      animated: true, label: "alongside",
      style: { stroke: accentColor("sand", theme), strokeWidth: 1.2, strokeDasharray: "5 4", opacity: 0.7 },
      labelStyle: { fill: theme === "paper" ? "#6E674F" : "#9A9079", fontSize: 9, fontFamily: "var(--font-roboto-mono)", textTransform: "uppercase", letterSpacing: "0.12em" },
      labelBgStyle: { fill: theme === "paper" ? "#E9E2D1" : "#13110C", fillOpacity: 0.9 },
      labelBgPadding: [4, 2],
    });
  }

  // scaffold solid connectors
  const hair = theme === "paper" ? "#B9AC8A" : "#3C3528";
  if (root && leadership) rfEdges.push({ id: "s-root-lead", source: root.id, target: leadership.id, type: "smoothstep", style: { stroke: hair, strokeWidth: 1.2 } });
  if (leadership && integrator) rfEdges.push({ id: "s-lead-int", source: leadership.id, target: integrator.id, type: "smoothstep", style: { stroke: hair, strokeWidth: 1 } });

  // cross-team dashed edges (only when both endpoints visible)
  for (const e of edges) {
    if (e.kind === "parallel") continue;
    if (!visible.has(e.source_id) || !visible.has(e.target_id)) continue;
    const tgt = byId.get(e.target_id);
    const color = accentColor(tgt?.accent ?? "copper", theme);
    rfEdges.push({
      id: `x-${e.id}`, source: e.source_id, target: e.target_id, type: "smoothstep",
      label: e.label ?? undefined,
      style: { stroke: color, strokeWidth: 1.25, strokeDasharray: "5 4", opacity: 0.7 },
      labelStyle: { fill: theme === "paper" ? "#6E674F" : "#9A9079", fontSize: 9, fontFamily: "var(--font-roboto-mono)", textTransform: "uppercase", letterSpacing: "0.1em" },
      labelBgStyle: { fill: theme === "paper" ? "#E9E2D1" : "#13110C", fillOpacity: 0.85 },
      labelBgPadding: [4, 2],
    });
  }

  return { rfNodes, rfEdges, matchIds };
}

/** Initial state: scaffold open, every team collapsed for a clean lane view. */
export function defaultExpanded(): Set<string> {
  return new Set();
}

export function ancestorsOf(nodes: OrgNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  let cur = byId.get(id)?.parent_id ?? null;
  while (cur) { chain.push(cur); cur = byId.get(cur)?.parent_id ?? null; }
  return chain;
}
