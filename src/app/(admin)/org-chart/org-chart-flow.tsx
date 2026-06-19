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
import {
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
  Search,
  Users,
  X,
} from "lucide-react";
import type { OrgChartData } from "@/services/org-chart";
import {
  buildGraph,
  defaultExpanded,
  ancestorsOf,
  accentColor,
  NODE_SIZE,
  type FlowNodeData,
} from "@/lib/org-chart/graph";
import { cn } from "@/lib/utils/cn";

// ── Custom node ──────────────────────────────────────────────────────────
function OrgNodeCard({ data }: NodeProps<RFNode<FlowNodeData>>) {
  const { node, hasChildren, childCount, expanded, dimmed, matched } = data;
  const accent = accentColor(node.accent);
  const size = NODE_SIZE[node.kind] ?? NODE_SIZE.person;
  const isStructural =
    node.kind === "root" ||
    node.kind === "cluster" ||
    node.kind === "team" ||
    node.kind === "subteam" ||
    node.kind === "stream";

  const titleSize =
    node.kind === "root"
      ? 17
      : node.kind === "cluster" || node.kind === "team"
        ? 14
        : node.kind === "role"
          ? 13.5
          : 12.5;

  return (
    <div
      className={cn(
        "group relative flex flex-col justify-center overflow-hidden rounded-[10px] border transition-all",
        matched && "ring-2"
      )}
      style={{
        width: size.w,
        height: size.h,
        background: node.kind === "root" ? "#1c1813" : "#171310",
        borderColor: matched ? accent : "#2C2823",
        opacity: dimmed ? 0.32 : 1,
        boxShadow: isStructural
          ? `0 1px 0 ${accent}22, 0 8px 24px rgba(0,0,0,0.45)`
          : "0 4px 14px rgba(0,0,0,0.4)",
        // @ts-expect-error ring color via CSS var
        "--tw-ring-color": accent,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, top: 0 }} />
      {/* accent rail */}
      <div
        className="absolute left-0 top-0 h-full"
        style={{ width: 4, background: accent }}
      />

      <div className="flex items-center gap-2.5 pl-4 pr-3">
        {node.kind === "person" || node.kind === "role" ? (
          <span
            className="mt-[1px] inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: accent, boxShadow: `0 0 8px ${accent}99` }}
          />
        ) : null}

        <div className="min-w-0 flex-1 py-2">
          <div className="flex items-center gap-1.5">
            <span
              className="truncate font-semibold leading-tight text-[#F0EBE3]"
              style={{ fontSize: titleSize, letterSpacing: "0.005em" }}
              title={node.label}
            >
              {node.label}
            </span>
            {node.status ? (
              <span
                className="shrink-0 rounded px-1.5 py-[1px] text-[8px] font-bold uppercase tracking-[0.1em]"
                style={{
                  color: accent,
                  background: `${accent}1f`,
                  border: `1px solid ${accent}40`,
                }}
              >
                {node.status}
              </span>
            ) : null}
          </div>
          {node.subtitle ? (
            <div
              className="mt-0.5 truncate text-[#9A9389]"
              style={{ fontSize: 10.5, lineHeight: 1.35 }}
              title={node.subtitle}
            >
              {node.subtitle}
            </div>
          ) : null}
        </div>

        {/* headcount + expand affordance */}
        <div className="flex shrink-0 items-center gap-1.5">
          {node.headcount != null ? (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-[2px] text-[9px] font-bold tracking-wider text-[#C9C2B6]"
              style={{ background: "#221E19", border: "1px solid #2C2823" }}
            >
              <Users size={9} style={{ color: accent }} />
              {node.headcount}
            </span>
          ) : null}
          {hasChildren ? (
            <span
              className="flex h-5 items-center gap-0.5 rounded-md px-1 text-[#8A8378]"
              style={{ background: "#221E19", border: "1px solid #2C2823" }}
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {!expanded ? (
                <span className="pr-0.5 text-[9px] font-bold">{childCount}</span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, bottom: 0 }} />
    </div>
  );
}

const NODE_TYPES = { org: OrgNodeCard };

// ── Flow inner ───────────────────────────────────────────────────────────
function FlowInner({ data }: { data: OrgChartData }) {
  const router = useRouter();
  const { fitView } = useReactFlow();
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    defaultExpanded(data.nodes)
  );
  const [query, setQuery] = useState("");

  const { rfNodes, rfEdges, matchIds } = useMemo(
    () => buildGraph({ nodes: data.nodes, edges: data.edges, expanded, query }),
    [data.nodes, data.edges, expanded, query]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  useEffect(() => {
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [rfNodes, rfEdges, setNodes, setEdges]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, n: RFNode<FlowNodeData>) => {
      const data = n.data;
      if (data.node.person_id) {
        router.push(`/users/${data.node.person_id}`);
        return;
      }
      if (data.hasChildren) toggle(n.id);
    },
    [router, toggle]
  );

  const expandAll = useCallback(() => {
    setExpanded(new Set(data.nodes.map((n) => n.id)));
  }, [data.nodes]);

  const collapseAll = useCallback(() => {
    // keep the top scaffold open: root, leadership, integrator, clusters
    const keep = new Set(
      data.nodes
        .filter((n) =>
          ["root", "cluster"].includes(n.kind) ||
          ["leadership", "integrator", "missio"].includes(n.key)
        )
        .map((n) => n.id)
    );
    setExpanded(keep);
  }, [data.nodes]);

  // Auto-expand ancestors of search hits so matches are revealed.
  useEffect(() => {
    if (!query.trim() || matchIds.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of matchIds) for (const a of ancestorsOf(data.nodes, id)) next.add(a);
      return next;
    });
  }, [query, matchIds, data.nodes]);

  // Re-fit when the visible set changes materially.
  useEffect(() => {
    const t = setTimeout(() => fitView({ duration: 350, padding: 0.18 }), 60);
    return () => clearTimeout(t);
  }, [expanded, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.15}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      className="org-flow"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#2A2620" />
      <Controls
        showInteractive={false}
        className="!border-[#2C2823] !bg-[#171310] [&_button]:!border-[#2C2823] [&_button]:!bg-[#171310] [&_button]:!fill-[#9A9389] [&_button:hover]:!bg-[#221E19]"
      />
      <MiniMap
        pannable
        zoomable
        className="!bg-[#100D0A]"
        maskColor="rgba(8,6,4,0.72)"
        nodeColor={(n) => accentColor((n.data as FlowNodeData)?.node?.accent)}
        nodeStrokeWidth={0}
        style={{ border: "1px solid #2C2823", borderRadius: 8 }}
      />

      {/* Toolbar */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        <div
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
          style={{ background: "#171310cc", border: "1px solid #2C2823", backdropFilter: "blur(6px)" }}
        >
          <Search size={13} className="text-[#8A8378]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people & teams…"
            className="w-40 bg-transparent text-[12px] text-[#F0EBE3] outline-none placeholder:text-[#6B645B] sm:w-52"
            style={{ border: "none", padding: 0 }}
          />
          {query ? (
            <button onClick={() => setQuery("")} className="text-[#8A8378] hover:text-[#F0EBE3]">
              <X size={13} />
            </button>
          ) : (
            query === "" &&
            matchIds.length === 0 && <span className="hidden" />
          )}
        </div>
        {query ? (
          <span
            className="rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#C9C2B6]"
            style={{ background: "#171310cc", border: "1px solid #2C2823" }}
          >
            {matchIds.length} match{matchIds.length === 1 ? "" : "es"}
          </span>
        ) : null}
      </div>

      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <button
          onClick={expandAll}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#C9C2B6] transition-colors hover:text-[#F0EBE3]"
          style={{ background: "#171310cc", border: "1px solid #2C2823", backdropFilter: "blur(6px)" }}
        >
          <Maximize2 size={12} /> Expand all
        </button>
        <button
          onClick={collapseAll}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#C9C2B6] transition-colors hover:text-[#F0EBE3]"
          style={{ background: "#171310cc", border: "1px solid #2C2823", backdropFilter: "blur(6px)" }}
        >
          <Minimize2 size={12} /> Collapse
        </button>
      </div>

      {/* Legend */}
      <div
        className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2"
        style={{ background: "#171310cc", border: "1px solid #2C2823", backdropFilter: "blur(6px)" }}
      >
        {[
          { c: "outward", l: "Outward · Mission" },
          { c: "inward", l: "Inward · Formation" },
          { c: "backbone", l: "Backbone · Support" },
          { c: "sand", l: "Missio (alongside)" },
        ].map((x) => (
          <span key={x.c} className="flex items-center gap-1.5 text-[10px] text-[#9A9389]">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: accentColor(x.c) }} />
            {x.l}
          </span>
        ))}
      </div>
    </ReactFlow>
  );
}

export function OrgChartFlow({ data }: { data: OrgChartData }) {
  return (
    <div
      className="org-flow-wrap relative w-full overflow-hidden rounded-xl"
      style={{ height: "calc(100vh - 190px)", minHeight: 520, border: "1px solid #2C2823", background: "#100D0A" }}
    >
      <ReactFlowProvider>
        <FlowInner data={data} />
      </ReactFlowProvider>
    </div>
  );
}
