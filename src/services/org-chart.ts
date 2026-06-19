// Org Chart — data access. The org_charts / org_nodes / org_edges tables
// (migration 098) aren't in the generated database.ts yet, so this service
// uses the project's standard `Client = any` pattern with hand-written types.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type OrgNodeKind =
  | "root"
  | "cluster"
  | "team"
  | "subteam"
  | "person"
  | "role"
  | "stream";

export type OrgEdgeKind = "cross_team" | "parallel" | "dotted";

export type OrgNode = {
  id: string;
  chart_id: string;
  parent_id: string | null;
  key: string;
  kind: OrgNodeKind;
  label: string;
  subtitle: string | null;
  accent: string | null;
  headcount: number | null;
  status: string | null;
  person_id: string | null;
  collapsed: boolean;
  x: number | null;
  y: number | null;
  sort_order: number;
};

export type OrgEdge = {
  id: string;
  chart_id: string;
  source_id: string;
  target_id: string;
  kind: OrgEdgeKind;
  label: string | null;
};

export type OrgChart = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

export type OrgChartData = {
  chart: OrgChart;
  nodes: OrgNode[];
  edges: OrgEdge[];
};

const NODE_COLS =
  "id, chart_id, parent_id, key, kind, label, subtitle, accent, headcount, status, person_id, collapsed, x, y, sort_order";

/** Load a full chart (active by default, or a specific slug) with its nodes + edges. */
export async function getOrgChart(
  supabase: Client,
  slug = "ffsa-2026"
): Promise<OrgChartData | null> {
  const { data: chart, error: chartErr } = await supabase
    .from("org_charts")
    .select("id, name, slug, description")
    .eq("slug", slug)
    .maybeSingle();

  if (chartErr || !chart) return null;

  const [{ data: nodes }, { data: edges }] = await Promise.all([
    supabase
      .from("org_nodes")
      .select(NODE_COLS)
      .eq("chart_id", chart.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("org_edges")
      .select("id, chart_id, source_id, target_id, kind, label")
      .eq("chart_id", chart.id),
  ]);

  return {
    chart: chart as OrgChart,
    nodes: (nodes ?? []) as OrgNode[],
    edges: (edges ?? []) as OrgEdge[],
  };
}
