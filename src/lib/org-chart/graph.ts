import dagre from "dagre";
import { Position, type Node as RFNode, type Edge as RFEdge } from "@xyflow/react";
import type { OrgNode, OrgEdge, OrgNodeKind } from "@/services/org-chart";

// ── Accent palette (tuned for the Hub's dark/gold theme) ────────────────
export const ACCENTS: Record<string, string> = {
  gold: "#F5B820",
  outward: "#D08A4F", // Mission — copper/terracotta
  inward: "#5FA877", // Formation — green
  backbone: "#6E91BC", // Support — slate blue
  copper: "#D08A4F",
  green: "#5FA877",
  sand: "#C9B68C",
  slate: "#6E91BC",
};

export function accentColor(key: string | null | undefined): string {
  return (key && ACCENTS[key]) || "#8A8378";
}

// ── Node footprint per kind (must match the rendered card size) ─────────
export const NODE_SIZE: Record<OrgNodeKind, { w: number; h: number }> = {
  root: { w: 280, h: 96 },
  cluster: { w: 240, h: 80 },
  team: { w: 244, h: 92 },
  subteam: { w: 210, h: 70 },
  person: { w: 224, h: 70 },
  role: { w: 244, h: 84 },
  stream: { w: 224, h: 68 },
};

export type FlowNodeData = {
  node: OrgNode;
  hasChildren: boolean;
  childCount: number;
  expanded: boolean;
  dimmed: boolean;
  matched: boolean;
  onToggle: (id: string) => void;
};

type BuildArgs = {
  nodes: OrgNode[];
  edges: OrgEdge[];
  expanded: Set<string>;
  query?: string;
};

type BuildResult = {
  rfNodes: RFNode<FlowNodeData>[];
  rfEdges: RFEdge[];
  matchIds: string[];
};

/**
 * Turn the stored tree (parent_id) + extra connectors (org_edges) into a
 * laid-out React Flow graph, honouring which branches are expanded.
 *
 * - Hierarchy → solid edges, fed to dagre for a clean top-down tree.
 * - org_edges (cross-team / parallel) → dotted edges, NOT fed to dagre
 *   (they'd fight the tree layout), only drawn when both ends are visible.
 */
export function buildGraph({ nodes, edges, expanded, query }: BuildArgs): BuildResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, OrgNode[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    const arr = childrenOf.get(n.parent_id) ?? [];
    arr.push(n);
    childrenOf.set(n.parent_id, arr);
  }

  const isExpanded = (id: string) => expanded.has(id);

  // Visible = every ancestor is expanded.
  const visible = new Set<string>();
  const walk = (n: OrgNode) => {
    visible.add(n.id);
    if (!isExpanded(n.id)) return;
    for (const c of childrenOf.get(n.id) ?? []) walk(c);
  };
  for (const n of nodes) if (!n.parent_id) walk(n);

  // Search matching (over the full tree, not just visible).
  const q = (query ?? "").trim().toLowerCase();
  const matchIds: string[] = [];
  if (q) {
    for (const n of nodes) {
      if (
        n.label.toLowerCase().includes(q) ||
        (n.subtitle ?? "").toLowerCase().includes(q)
      ) {
        matchIds.push(n.id);
      }
    }
  }
  const matchSet = new Set(matchIds);

  // ── dagre layout over the visible hierarchy ───────────────────────────
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 64, nodesep: 22, marginx: 24, marginy: 24 });

  for (const id of visible) {
    const n = byId.get(id)!;
    const size = NODE_SIZE[n.kind] ?? NODE_SIZE.person;
    g.setNode(id, { width: size.w, height: size.h });
  }
  for (const id of visible) {
    const n = byId.get(id)!;
    if (n.parent_id && visible.has(n.parent_id)) g.setEdge(n.parent_id, id);
  }
  dagre.layout(g);

  const rfNodes: RFNode<FlowNodeData>[] = [];
  for (const id of visible) {
    const n = byId.get(id)!;
    const p = g.node(id);
    const size = NODE_SIZE[n.kind] ?? NODE_SIZE.person;
    const kids = childrenOf.get(id) ?? [];
    rfNodes.push({
      id,
      type: "org",
      position: { x: p.x - size.w / 2, y: p.y - size.h / 2 },
      data: {
        node: n,
        hasChildren: kids.length > 0,
        childCount: kids.length,
        expanded: isExpanded(id),
        dimmed: q.length > 0 && !matchSet.has(id),
        matched: matchSet.has(id),
        onToggle: () => {},
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    });
  }

  // ── edges ─────────────────────────────────────────────────────────────
  const rfEdges: RFEdge[] = [];
  for (const id of visible) {
    const n = byId.get(id)!;
    if (n.parent_id && visible.has(n.parent_id)) {
      rfEdges.push({
        id: `h-${n.parent_id}-${id}`,
        source: n.parent_id,
        target: id,
        type: "smoothstep",
        style: { stroke: "#3A3530", strokeWidth: 1.5 },
      });
    }
  }
  for (const e of edges) {
    if (!visible.has(e.source_id) || !visible.has(e.target_id)) continue;
    const tgt = byId.get(e.target_id);
    const color = accentColor(tgt?.accent ?? "copper");
    rfEdges.push({
      id: `x-${e.id}`,
      source: e.source_id,
      target: e.target_id,
      type: "smoothstep",
      animated: e.kind === "parallel",
      label: e.label ?? undefined,
      style: { stroke: color, strokeWidth: 1.25, strokeDasharray: "5 4", opacity: 0.7 },
      labelStyle: { fill: "#9A9389", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em" },
      labelBgStyle: { fill: "#171310", fillOpacity: 0.85 },
      labelBgPadding: [4, 2],
    });
  }

  return { rfNodes, rfEdges, matchIds };
}

/** Initial expanded set: everything except nodes stored as collapsed-by-default. */
export function defaultExpanded(nodes: OrgNode[]): Set<string> {
  return new Set(nodes.filter((n) => !n.collapsed).map((n) => n.id));
}

/** Ancestor chain (exclusive of self) for auto-expanding to a search hit. */
export function ancestorsOf(nodes: OrgNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  let cur = byId.get(id)?.parent_id ?? null;
  while (cur) {
    chain.push(cur);
    cur = byId.get(cur)?.parent_id ?? null;
  }
  return chain;
}
