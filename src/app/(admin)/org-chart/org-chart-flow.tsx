"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node as RFNode,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./org-chart.css";
import type { OrgChartData } from "@/services/org-chart";
import {
  buildGraph,
  defaultExpanded,
  ancestorsOf,
  accentColor,
  type FlowNodeData,
} from "@/lib/org-chart/graph";

type Theme = "paper" | "dark";

function initials(label: string) {
  const w = label.trim().split(/\s+/);
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[1][0]).toUpperCase();
}

const HandlePair = () => (
  <>
    <Handle type="target" position={Position.Top} />
    <Handle type="source" position={Position.Bottom} />
  </>
);

// ── node renderers ────────────────────────────────────────────────────────
function RootNode({ data }: NodeProps<RFNode<FlowNodeData>>) {
  const n = data.node;
  return (
    <div className="nd root" data-ac={n.accent ?? "gold"}>
      <HandlePair />
      <div>
        <div className="eyebrow">Fire &amp; Fragrance · South Africa</div>
        <div className="name">{n.label}</div>
      </div>
      {n.headcount != null && (
        <div className="num">{n.headcount}<small>STAFF</small></div>
      )}
    </div>
  );
}

function LeadershipNode({ data }: NodeProps<RFNode<FlowNodeData>>) {
  const n = data.node;
  const members = data.members ?? [];
  const shown = members.slice(0, 6);
  const rest = members.length - shown.length;
  return (
    <div className={`nd lead ${data.dimmed ? "dim" : ""} ${data.matched ? "matched" : ""}`} data-ac="gold">
      <HandlePair />
      <div className="hd"><span className="ti">{n.label}</span>{n.headcount != null && <span className="n">{n.headcount}</span>}</div>
      <div className="chips">
        {shown.map((m, i) => (
          <span className="chip" key={i}><b>{m.label}</b></span>
        ))}
        {rest > 0 && <span className="chip">+{rest}</span>}
      </div>
    </div>
  );
}

function RoleNode({ data }: NodeProps<RFNode<FlowNodeData>>) {
  const n = data.node;
  return (
    <div className={`nd role ${data.dimmed ? "dim" : ""} ${data.matched ? "matched" : ""}`} data-ac="copper">
      <HandlePair />
      {n.status && <span className="tag">{n.status}</span>}
      <div className="ti">{n.label}</div>
      {n.subtitle && <div className="sub">{n.subtitle}</div>}
    </div>
  );
}

function LaneNode({ data }: NodeProps<RFNode<FlowNodeData>>) {
  const n = data.node;
  return (
    <div className="nd lane" data-ac={n.accent ?? "sand"}>
      <Handle type="target" position={Position.Top} />
      <span className="lbl">{n.label}</span>
      <span className="ct">{data.laneCount}</span>
    </div>
  );
}

function TeamNode({ data }: NodeProps<RFNode<FlowNodeData>>) {
  const n = data.node;
  return (
    <div className={`nd team ${data.dimmed ? "dim" : ""} ${data.matched ? "matched" : ""}`} data-ac={n.accent ?? "sand"}>
      <HandlePair />
      <div className="row"><span className="ti">{n.label}</span>{n.headcount != null && <span className="num">{n.headcount}</span>}</div>
      {n.subtitle && <div className="sub">{n.subtitle}</div>}
      {data.hasChildren && (
        <span className="exp">{data.expanded ? "▾ Collapse" : `▸ ${data.childCount}`}</span>
      )}
    </div>
  );
}

function SubteamNode({ data }: NodeProps<RFNode<FlowNodeData>>) {
  const n = data.node;
  return (
    <div className={`nd subteam ${data.dimmed ? "dim" : ""} ${data.matched ? "matched" : ""}`} data-ac={n.accent ?? "sand"}>
      <HandlePair />
      <span className="s">{n.label}</span>
      <span className="ln" />
      <span className="c">{data.expanded ? "▾" : `▸ ${data.childCount}`}</span>
    </div>
  );
}

function PersonNode({ data }: NodeProps<RFNode<FlowNodeData>>) {
  const n = data.node;
  const link = !!n.person_id;
  return (
    <div className={`nd person ${link ? "link" : ""} ${data.dimmed ? "dim" : ""} ${data.matched ? "matched" : ""}`} data-ac={n.accent ?? "sand"}>
      <HandlePair />
      <span className="mono">{initials(n.label)}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="pn">{n.label}</div>
        {n.subtitle && <div className="pr">{n.subtitle}</div>}
      </div>
      {n.status && <span className="tag">{n.status}</span>}
    </div>
  );
}

function StreamNode({ data }: NodeProps<RFNode<FlowNodeData>>) {
  const n = data.node;
  const head = n.key === "missio";
  return (
    <div className={`nd stream ${head ? "head" : ""} ${data.dimmed ? "dim" : ""}`} data-ac="sand">
      <HandlePair />
      {head && <span className="tag">Alongside structure</span>}
      <div className="ti">{n.label}</div>
      {n.subtitle && <div className="sub">{n.subtitle}</div>}
    </div>
  );
}

const NODE_TYPES = {
  root: RootNode, leadership: LeadershipNode, role: RoleNode, lane: LaneNode,
  team: TeamNode, subteam: SubteamNode, person: PersonNode, stream: StreamNode,
};

// ── flow ──────────────────────────────────────────────────────────────────
function FlowInner({ data, theme, setTheme }: { data: OrgChartData; theme: Theme; setTheme: (t: Theme) => void }) {
  const router = useRouter();
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded());
  const [query, setQuery] = useState("");

  const { rfNodes, rfEdges, matchIds } = useMemo(
    () => buildGraph({ nodes: data.nodes, edges: data.edges, expanded, query, theme }),
    [data.nodes, data.edges, expanded, query, theme]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  useEffect(() => { setNodes(rfNodes); setEdges(rfEdges); }, [rfNodes, rfEdges, setNodes, setEdges]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, nd: RFNode<FlowNodeData>) => {
      const d = nd.data;
      if (d.node.person_id) { router.push(`/users/${d.node.person_id}`); return; }
      if (d.hasChildren && (d.node.kind === "team" || d.node.kind === "subteam")) toggle(nd.id);
    },
    [router, toggle]
  );

  const expandAll = useCallback(() => {
    setExpanded(new Set(data.nodes.filter((n) => n.kind === "team" || n.kind === "subteam").map((n) => n.id)));
  }, [data.nodes]);
  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  useEffect(() => {
    if (!query.trim() || matchIds.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of matchIds) for (const a of ancestorsOf(data.nodes, id)) next.add(a);
      return next;
    });
  }, [query, matchIds, data.nodes]);

  useEffect(() => {
    const t = setTimeout(() => fitView({ duration: 380, padding: 0.16 }), 60);
    return () => clearTimeout(t);
  }, [expanded, theme, fitView]);

  const minimapColor = useCallback(
    (nd: RFNode) => {
      const d = nd.data as FlowNodeData;
      if (nd.type === "lane") return "transparent";
      return accentColor(d?.node?.accent, theme);
    },
    [theme]
  );

  return (
    <>
      <div className="orgx-rail">
        <label className="orgx-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ color: "var(--ink3)" }}>
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" />
          </svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people & teams…" />
        </label>
        {query && <span className="orgx-count">{matchIds.length} match{matchIds.length === 1 ? "" : "es"}</span>}
        <div className="spacer" />
        <div className="orgx-ctl">
          <button onClick={expandAll}>Expand</button>
          <button onClick={collapseAll}>Collapse</button>
          <button onClick={() => zoomOut()} aria-label="Zoom out">－</button>
          <button onClick={() => zoomIn()} aria-label="Zoom in">＋</button>
          <button onClick={() => fitView({ duration: 380, padding: 0.16 })}>Fit</button>
        </div>
        <button className="orgx-toggle" onClick={() => setTheme(theme === "paper" ? "dark" : "paper")}>
          {theme === "paper" ? "◑ Dark" : "◐ Paper"}
        </button>
      </div>
      <div className="orgx-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.16 }}
        minZoom={0.12}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          pannable zoomable
          nodeColor={minimapColor}
          nodeStrokeWidth={0}
          maskColor={theme === "paper" ? "rgba(214,205,182,0.6)" : "rgba(8,6,4,0.72)"}
          style={{ background: theme === "paper" ? "#E3DAC6" : "#0F0D09", width: 168, height: 116 }}
        />
      </ReactFlow>

      {/* legend */}
      <div className="orgx-legend">
        {[["outward", "Outward"], ["inward", "Inward"], ["backbone", "Backbone"], ["gold", "Leadership"]].map(([k, l]) => (
          <span className="it" key={k}><span className="dot" style={{ background: accentColor(k, theme) }} />{l}</span>
        ))}
        <span className="it" style={{ borderLeft: "1px solid var(--hair)", paddingLeft: 12 }}>- - cross-team</span>
      </div>
      </div>
    </>
  );
}

export function OrgChartFlow({ data }: { data: OrgChartData }) {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("orgx-theme")) as Theme | null;
    if (saved === "paper" || saved === "dark") setTheme(saved);
  }, []);
  const setAndSave = useCallback((t: Theme) => { setTheme(t); try { localStorage.setItem("orgx-theme", t); } catch {} }, []);

  return (
    <div
      className={`orgx ${theme}`}
      style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 150px)", minHeight: 560, borderRadius: 12, overflow: "hidden", border: "1px solid var(--hair)" }}
    >
      <ReactFlowProvider>
        <FlowInner data={data} theme={theme} setTheme={setAndSave} />
      </ReactFlowProvider>
    </div>
  );
}
