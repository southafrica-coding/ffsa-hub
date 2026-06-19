-- ============================================================
-- FFSA Hub — Migration 099: Org Chart module
-- ============================================================
-- A living, interactive org chart — a "glorified org chart" styled
-- like Supabase's schema visualizer. Renders FFSA's 2026 structure
-- ("Rooted & Sent") as an expandable canvas of nodes + connectors.
--
-- Data model (generic / hand-authored, NOT derived from users):
--   org_charts  — a named chart (supports >1 later: "Leadership", …)
--   org_nodes   — every box. Self-referential via parent_id (the tree).
--                 `key` is a stable human slug so the seed + edges are
--                 readable and order-independent.
--   org_edges   — NON-hierarchical connectors only (cross-team service,
--                 the Missio "alongside" structure). The tree itself is
--                 drawn from parent_id; edges add the dotted relationships.
--
-- Permissions (module = 'org-chart'):
--   org.view    — (reserved) explicit view grant
--   org.manage  — author / edit the chart (v2 editor)
-- Viewing is open to ANY authenticated user — the chart is internal
-- reference material meant to orient "anyone working in the app".
--
-- Layout: node x/y are OPTIONAL overrides. The viewer auto-lays-out the
-- hierarchy with dagre at load, so the seed need not place pixels.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Access helper
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_org_chart_manage()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR public.has_permission('org.manage');
$$;

-- ────────────────────────────────────────────────────────────
-- 1. CHARTS
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.org_charts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 2. NODES (the boxes — a tree via parent_id)
-- ────────────────────────────────────────────────────────────
-- kind drives the visual treatment in the viewer:
--   root     — the organisation itself
--   cluster  — Outward / Inward / Backbone
--   team     — a ministry team
--   subteam  — a department / sub-unit within a team
--   person   — a named staff member
--   role     — an unfilled / structural role (e.g. "Integrator — open")
--   stream   — a parallel structure node (Missio Church chain)
CREATE TABLE public.org_nodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id      uuid NOT NULL REFERENCES public.org_charts (id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES public.org_nodes (id) ON DELETE CASCADE,
  key           text NOT NULL,            -- stable slug, unique per chart
  kind          text NOT NULL DEFAULT 'person'
                CHECK (kind IN ('root','cluster','team','subteam','person','role','stream')),
  label         text NOT NULL,            -- primary line (name / team)
  subtitle      text,                     -- role / description line
  accent        text,                     -- cluster colour key: gold|green|copper|sand|slate|outward|inward|backbone
  headcount     integer,                  -- shown as a pill on team nodes
  status        text,                     -- e.g. 'open', 'developing', 'temp'
  person_id     uuid REFERENCES public.users (id) ON DELETE SET NULL, -- optional deep-link
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  collapsed     boolean NOT NULL DEFAULT false, -- default-collapsed in the viewer
  x             numeric,                   -- optional manual position override
  y             numeric,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chart_id, key)
);

CREATE INDEX idx_org_nodes_chart  ON public.org_nodes (chart_id);
CREATE INDEX idx_org_nodes_parent ON public.org_nodes (parent_id);

-- ────────────────────────────────────────────────────────────
-- 3. EDGES (non-hierarchical connectors)
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.org_edges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id    uuid NOT NULL REFERENCES public.org_charts (id) ON DELETE CASCADE,
  source_id   uuid NOT NULL REFERENCES public.org_nodes (id) ON DELETE CASCADE,
  target_id   uuid NOT NULL REFERENCES public.org_nodes (id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'cross_team'
              CHECK (kind IN ('cross_team','parallel','dotted')),
  label       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_edges_chart ON public.org_edges (chart_id);

-- ────────────────────────────────────────────────────────────
-- 4. PERMISSIONS
-- ────────────────────────────────────────────────────────────
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('org-chart', 'org.view',   'View Org Chart',   10),
  ('org-chart', 'org.manage', 'Manage Org Chart', 20)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.org_charts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_nodes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_edges  ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user (internal reference material).
CREATE POLICY "org_charts_read" ON public.org_charts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "org_nodes_read" ON public.org_nodes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "org_edges_read" ON public.org_edges
  FOR SELECT TO authenticated USING (true);

-- Write: admins or holders of org.manage (reserved for the v2 editor).
CREATE POLICY "org_charts_manage" ON public.org_charts
  FOR ALL TO authenticated
  USING (public.has_org_chart_manage()) WITH CHECK (public.has_org_chart_manage());
CREATE POLICY "org_nodes_manage" ON public.org_nodes
  FOR ALL TO authenticated
  USING (public.has_org_chart_manage()) WITH CHECK (public.has_org_chart_manage());
CREATE POLICY "org_edges_manage" ON public.org_edges
  FOR ALL TO authenticated
  USING (public.has_org_chart_manage()) WITH CHECK (public.has_org_chart_manage());

-- ============================================================
-- 6. SEED — FFSA 2026 "Rooted & Sent" structure
-- ============================================================
-- Authored from the 2026 Organisational Structure document.
-- Staging temp tables make the seed readable and order-independent:
-- insert every node flat, then resolve parent_id / edges by `key`.

DO $$
DECLARE
  v_chart uuid;
BEGIN

INSERT INTO public.org_charts (name, slug, description, sort_order)
VALUES ('FFSA 2026', 'ffsa-2026',
        'Rooted & Sent — Fire & Fragrance South Africa organisational structure, 2026.', 0)
ON CONFLICT (slug) DO UPDATE SET description = EXCLUDED.description
RETURNING id INTO v_chart;

-- Fresh seed each apply (idempotent re-seed of this chart's nodes/edges).
DELETE FROM public.org_edges WHERE chart_id = v_chart;
DELETE FROM public.org_nodes WHERE chart_id = v_chart;

CREATE TEMP TABLE _seed (
  key text, parent_key text, kind text, label text, subtitle text,
  accent text, headcount int, status text, collapsed boolean, sort_order int
) ON COMMIT DROP;

CREATE TEMP TABLE _seed_edges (
  source_key text, target_key text, kind text, label text
) ON COMMIT DROP;

-- ── Apex ────────────────────────────────────────────────────
INSERT INTO _seed VALUES
('ffsa', NULL, 'root', 'Fire & Fragrance SA', 'Potchefstroom · 2026 · 157 staff', 'gold', 157, NULL, false, 0),
('leadership', 'ffsa', 'team', 'Leadership Team', 'Governance & senior oversight', 'gold', 8, NULL, false, 0),
('integrator', 'leadership', 'role', 'Integrator', 'Day-to-day execution · alignment · accountability', 'copper', NULL, 'open', false, 1);

-- Leadership Team members
INSERT INTO _seed VALUES
('p-gabriel',  'leadership', 'person', 'Gabriel',        'Senior Leader · Visionary (EOS) · Base Leader', 'gold', NULL, NULL, false, 0),
('p-michelle', 'leadership', 'person', 'Michelle',       'COO · Operations owner',                        'gold', NULL, NULL, false, 1),
('p-brendon',  'leadership', 'person', 'Brendon Homan',  'Business Development & Corporate Fundraising',   'gold', NULL, NULL, false, 2),
('p-eduard',   'leadership', 'person', 'Eduard Schoch',  'Project 54 core · Nigeria nations leader',       'gold', NULL, NULL, false, 3),
('p-hanno',    'leadership', 'person', 'Hanno Degenaar', 'Project 54 core · Madagascar & Malawi leader',   'gold', NULL, NULL, false, 4),
('p-jaco',     'leadership', 'person', 'Jaco',           'Training Director',                              'gold', NULL, NULL, false, 5),
('p-ally',     'leadership', 'person', 'Ally',           'Inside Ministry · OKRs (role developing)',       'gold', NULL, NULL, false, 6),
('p-caleb',    'leadership', 'person', 'Caleb',          'Outside Ministry · Leadership Dev (developing)',  'gold', NULL, NULL, false, 7);

-- ── Clusters ────────────────────────────────────────────────
INSERT INTO _seed VALUES
('cluster-outward',  'integrator', 'cluster', 'Outward · Mission',   'Sending into the nations',        'outward',  NULL, NULL, false, 0),
('cluster-inward',   'integrator', 'cluster', 'Inward · Formation',  'Forming disciples & leaders',     'inward',   NULL, NULL, false, 1),
('cluster-backbone', 'integrator', 'cluster', 'Backbone · Support',  'The base that carries the load',  'backbone', NULL, NULL, false, 2);

-- ════════════════════════════════════════════════════════════
-- OUTWARD · MISSION
-- ════════════════════════════════════════════════════════════
INSERT INTO _seed VALUES
('team-outside',   'cluster-outward', 'team', 'Outside Ministry', 'External outreach · leadership development', 'outward', NULL, NULL, false, 0),
('team-hulc',      'cluster-outward', 'team', 'HULC',             'University, campus & high-school mission',   'outward', 21,   NULL, true,  1),
('team-events',    'cluster-outward', 'team', 'Events',           'The Send · FFX · FFBX · national mobilisation','outward', 7,   NULL, true,  2),
('team-p54',       'cluster-outward', 'team', 'Project 54',       'African nations mission · 10/40 window',     'outward', 25,   NULL, true,  3),
('team-crossfit',  'cluster-outward', 'team', '10/40 CrossFit',   'Discipleship through strength & community',  'outward', 7,    NULL, true,  4),
('team-woven',     'cluster-outward', 'team', 'Woven',            'Mercy · women''s ministry · Restoration',    'outward', 6,    NULL, true,  5);

-- Outside Ministry
INSERT INTO _seed VALUES
('om-caleb', 'team-outside', 'person', 'Caleb', 'Outside Ministry lead · Leadership Development', 'outward', NULL, NULL, false, 0);

-- HULC (21) — Heinrich lead
INSERT INTO _seed VALUES
('hulc-core',    'team-hulc', 'subteam', 'Core Leadership',        '6',           'outward', 6, NULL, false, 0),
('hulc-campus',  'team-hulc', 'subteam', 'Campus Leaders',         '9',           'outward', 9, NULL, false, 1),
('hulc-schools', 'team-hulc', 'subteam', 'High Schools & Pipeline','6',           'outward', 6, NULL, false, 2);
INSERT INTO _seed VALUES
('h-heinrich',   'hulc-core', 'person', 'Heinrich', 'Visionary / Apostolic Architect · camps · Rev & Ref', 'outward', NULL, NULL, false, 0),
('h-gabrielvw',  'hulc-core', 'person', 'Gabriel van Wyk', 'Mobilisation Strategy Architect · campus activation', 'outward', NULL, NULL, false, 1),
('h-luke',       'hulc-core', 'person', 'Luke', 'OTC Leader · SU point leader · Cape Town camps', 'outward', NULL, NULL, false, 2),
('h-sarah',      'hulc-core', 'person', 'Sarah', 'Formation & Empowerment · Brave Love lead · HS pipeline', 'outward', NULL, NULL, false, 3),
('h-ellie',      'hulc-core', 'person', 'Ellie', 'Executive Coordination · alignment tracking', 'outward', NULL, NULL, false, 4),
('h-lene',       'hulc-core', 'person', 'Lené', 'Messaging · curriculum · theological consistency · OTC', 'outward', NULL, NULL, false, 5),
('h-wimpie',     'hulc-campus', 'person', 'Wimpie', 'Training & formation · TUKS + UJ support · worship', 'outward', NULL, NULL, false, 0),
('h-ashlyn',     'hulc-campus', 'person', 'Ashlyn', 'Comms & campaigns · TUKS + UJ support leader', 'outward', NULL, NULL, false, 1),
('h-tshego',     'hulc-campus', 'person', 'Tshegofatso', 'Media lead: camps organiser · TUKS + UJ point leader', 'outward', NULL, NULL, false, 2),
('h-chandre',    'hulc-campus', 'person', 'Chandré', 'Finance owner · UFS + CUT point leader · Brave Love', 'outward', NULL, NULL, false, 3),
('h-ray',        'hulc-campus', 'person', 'Ray', 'UFS + CUT support · Rev & Ref leader · worship', 'outward', NULL, NULL, false, 4),
('h-tj',         'hulc-campus', 'person', 'TJ', 'NWU point leader', 'outward', NULL, NULL, false, 5),
('h-chanelle',   'hulc-campus', 'person', 'Chanelle', 'NWU support leader · Brave Love', 'outward', NULL, NULL, false, 6),
('h-meshach',    'hulc-campus', 'person', 'Meshach', 'UCT point leader · HULC worship', 'outward', NULL, NULL, false, 7),
('h-lauren',     'hulc-campus', 'person', 'Lauren', 'SU + UCT support · Brave Love · worship', 'outward', NULL, NULL, false, 8),
('h-nissi',      'hulc-schools', 'person', 'Nissi', 'High Schools team · HULC media · development pathway', 'outward', NULL, NULL, false, 0),
('h-hesmari',    'hulc-schools', 'person', 'Hesmari', 'UFS + CUT support · farm-town pipeline · worship', 'outward', NULL, NULL, false, 1),
('h-devan',      'hulc-schools', 'person', 'Devan', 'High Schools team · HULC worship', 'outward', NULL, NULL, false, 2),
('h-alison',     'hulc-schools', 'person', 'Alison', 'High Schools · NWU support · HULC media', 'outward', NULL, NULL, false, 3),
('h-deone',      'hulc-schools', 'person', 'Deoné', 'High Schools · NWU support · HULC media', 'outward', NULL, NULL, false, 4),
('h-japie',      'hulc-schools', 'person', 'Japie', 'Part-time with OPS & SBS', 'outward', NULL, NULL, false, 5);

-- Events (7) — Gabriel van Wyk mobilisation (cross-team members shown via edges)
INSERT INTO _seed VALUES
('e-ellievw',   'team-events', 'person', 'Ellie van Wyk', 'Event support · team member', 'outward', NULL, NULL, false, 0);

-- Project 54 (25) — Eduard · Hanno · Veronica · Mercy core
INSERT INTO _seed VALUES
('p54-core',    'team-p54', 'subteam', 'Core Leadership', '4', 'outward', 4, NULL, false, 0),
('p54-team',    'team-p54', 'subteam', 'Team Directory',  '21 members', 'outward', 21, NULL, false, 1);
INSERT INTO _seed VALUES
('p54-veronica','p54-core', 'person', 'Veronica Degenaar', 'Network Mobilisation · Training Point Leader · Nigeria', 'outward', NULL, NULL, false, 0),
('p54-mercy',   'p54-core', 'person', 'Mercy Johnson', 'Leadership Development · OKR Shepherd · Tanzania', 'outward', NULL, NULL, false, 1),
('p54-bianca',  'p54-team', 'person', 'Bianca Venter', 'Media Ops Lead · Madagascar · Church Planter · DMM Coach', 'outward', NULL, NULL, false, 0),
('p54-carla',   'p54-team', 'person', 'Carla Foord', 'Training Ops Lead · Nigeria · Church Planter · DMM Coach', 'outward', NULL, NULL, false, 1),
('p54-hanna',   'p54-team', 'person', 'Hanna Meyer', 'Training Ops · Nigeria · Church Planter · DMM Coach', 'outward', NULL, NULL, false, 2),
('p54-helanca', 'p54-team', 'person', 'Helanca van Heerden', 'Development Ops · Malawi · Church Planter · DMM Coach', 'outward', NULL, NULL, false, 3),
('p54-isabelle','p54-team', 'person', 'Isabelle Johnson', 'Madagascar · Training Assistant · Church Planter · DMM Coach', 'outward', NULL, NULL, false, 4),
('p54-jenna',   'p54-team', 'person', 'Jenna Follett', 'Nigeria · Training Assistant · Church Planter · DMM Coach', 'outward', NULL, NULL, false, 5),
('p54-jeremy',  'p54-team', 'person', 'Jeremy Vestal', 'Church Planter · Training Assistant · DMM Coach', 'outward', NULL, NULL, false, 6),
('p54-jessica', 'p54-team', 'person', 'Jessica Ketcham', 'Malawi · Training Assistant · Church Planter · DMM Coach', 'outward', NULL, NULL, false, 7),
('p54-josiah',  'p54-team', 'person', 'Josiah Bell', 'Prayer & Worship Ops Lead · Madagascar · Church Planter', 'outward', NULL, NULL, false, 8),
('p54-madison', 'p54-team', 'person', 'Madison M. Javeri', 'Media Ops · Tanzania · Training Assistant · DMM Coach', 'outward', NULL, NULL, false, 9),
('p54-maggie',  'p54-team', 'person', 'Maggie Dee', 'Prayer & Worship Ops · Tanzania · Training Assistant', 'outward', NULL, NULL, false, 10),
('p54-matthewa','p54-team', 'person', 'Matthew Akre', 'Development Ops Lead · Malawi · Church Planter · DMM Coach', 'outward', NULL, NULL, false, 11),
('p54-mia',     'p54-team', 'person', 'Mia Kriek', 'Tanzania · Church Planter · DMM Coach · Intercessor', 'outward', NULL, NULL, false, 12),
('p54-michaels','p54-team', 'person', 'Michael Smith', 'Training Ops · Malawi · Training Assistant · DMM Coach', 'outward', NULL, NULL, false, 13),
('p54-milly',   'p54-team', 'person', 'Milly Salguero', 'Nigeria · Training Assistant · Church Planter', 'outward', NULL, NULL, false, 14),
('p54-nythan',  'p54-team', 'person', 'Nythan Pienaar', 'Development Ops · Nigeria · Church Planter · DMM Coach', 'outward', NULL, NULL, false, 15),
('p54-ruan',    'p54-team', 'person', 'Ruan Kriek', 'Tanzania · Training Assistant · Church Planter · DMM Coach', 'outward', NULL, NULL, false, 16),
('p54-samantha','p54-team', 'person', 'Samantha Vestal', 'Church Planter · DMM Coach · Intercessor', 'outward', NULL, NULL, false, 17),
('p54-taylor',  'p54-team', 'person', 'Taylor Davis', 'Tanzania · Training Facilitator · Church Planter', 'outward', NULL, NULL, false, 18),
('p54-timon',   'p54-team', 'person', 'Timon Berrington', 'Madagascar · Training Facilitator · Church Planter', 'outward', NULL, NULL, false, 19),
('p54-uya',     'p54-team', 'person', 'Uyatholwa Mkhwanazi', 'Madagascar · Training Assistant · Church Planter', 'outward', NULL, NULL, false, 20);

-- 10/40 CrossFit (7) — Marno
INSERT INTO _seed VALUES
('cf-marno',   'team-crossfit', 'person', 'Marno', 'Octiv & equipment oversight · maintenance · Iran focus', 'outward', NULL, NULL, false, 0),
('cf-shania',  'team-crossfit', 'person', 'Shania', 'KIDS classes · Devo & Discipleship Dept lead · coaching', 'outward', NULL, NULL, false, 1),
('cf-jordan',  'team-crossfit', 'person', 'Jordan', 'Themes · maintenance (Special Ops) · programming', 'outward', NULL, NULL, false, 2),
('cf-armand',  'team-crossfit', 'person', 'Armand', 'Equipment lead · Morocco focus · coaching · gym app', 'outward', NULL, NULL, false, 3),
('cf-alyson',  'team-crossfit', 'person', 'Alyson', 'Programming trainer · Media Dept lead · Moms class', 'outward', NULL, NULL, false, 4),
('cf-ruben',   'team-crossfit', 'person', 'Ruben', 'Merch · coaching', 'outward', NULL, NULL, false, 5),
('cf-jp',      'team-crossfit', 'person', 'JP', 'New athlete profiles · discipleship map tracker · coaching', 'outward', NULL, NULL, false, 6);

-- Woven (6) — Caitlin Lange
INSERT INTO _seed VALUES
('w-caitlin',  'team-woven', 'person', 'Caitlin Lange', 'Woven Leader', 'outward', NULL, NULL, false, 0),
('w-hunter',   'team-woven', 'person', 'Hunter Stewart', 'Operations & finances · leads Restoration Program', 'outward', NULL, NULL, false, 1),
('w-kelsy',    'team-woven', 'person', 'Kelsy', 'Evangelism Lead', 'outward', NULL, NULL, false, 2),
('w-dani',     'team-woven', 'person', 'Dani Blood', 'Media', 'outward', NULL, NULL, false, 3),
('w-timberly', 'team-woven', 'person', 'Timberly Rider', 'Restoration Program support · team trainings', 'outward', NULL, NULL, false, 4),
('w-steph',    'team-woven', 'person', 'Steph Mensah', 'Restoration Program · finances & fundraising · Woven Media', 'outward', NULL, NULL, false, 5);

-- ════════════════════════════════════════════════════════════
-- INWARD · FORMATION
-- ════════════════════════════════════════════════════════════
INSERT INTO _seed VALUES
('team-inside',   'cluster-inward', 'team', 'Inside Ministry', 'Internal formation · OKRs',          'inward', NULL, NULL, false, 0),
('team-training', 'cluster-inward', 'team', 'Training',        'FFX · FFBX · FFSBI · RCA · FFLTrack · EFL', 'inward', 41, NULL, true, 1),
('team-worship',  'cluster-inward', 'team', 'Prayer & Worship','Worship Circle · 24/7 intercession',  'inward', 24, NULL, true, 2);

INSERT INTO _seed VALUES
('im-ally', 'team-inside', 'person', 'Ally', 'Inside Ministry lead · OKRs', 'inward', NULL, NULL, false, 0);

-- Training (41) — Jaco
INSERT INTO _seed VALUES
('tr-core',  'team-training', 'subteam', 'Core Training Team', 'Coaches & consultants · 5', 'inward', 5, NULL, false, 0),
('tr-ffx',   'team-training', 'subteam', 'FFX',                'Fire & Fragrance eXperience', 'inward', NULL, NULL, false, 1),
('tr-ffbx',  'team-training', 'subteam', 'FFBX',               'FFX Base eXperience', 'inward', NULL, NULL, false, 2),
('tr-ffsbi', 'team-training', 'subteam', 'FFSBI',              'School of Bible Immersion', 'inward', NULL, NULL, false, 3),
('tr-rca',   'team-training', 'subteam', 'RCA',                'Rooted Christian Academy', 'inward', NULL, NULL, false, 4),
('tr-track', 'team-training', 'subteam', 'FFLTrack',           'Leadership track', 'inward', NULL, NULL, false, 5),
('tr-efl',   'team-training', 'subteam', 'EFL',                'Educating For Life', 'inward', NULL, NULL, false, 6);
INSERT INTO _seed VALUES
('tr-ally',    'tr-core', 'person', 'Ally', 'FFX Coach', 'inward', NULL, NULL, false, 0),
('tr-wikus',   'tr-core', 'person', 'Wikus', 'FFBX Coach', 'inward', NULL, NULL, false, 1),
('tr-mercy',   'tr-core', 'person', 'Mercy', 'Short-form Coach', 'inward', NULL, NULL, false, 2),
('tr-riley',   'tr-core', 'person', 'Riley', 'FFSBI Coach', 'inward', NULL, NULL, false, 3),
('tr-nathaly', 'tr-core', 'person', 'Nathaly', 'Systems Consultant', 'inward', NULL, NULL, false, 4),
('tr-chante',  'tr-ffx', 'person', 'Chante', 'Point School Leader', 'inward', NULL, NULL, false, 0),
('tr-sarel',   'tr-ffx', 'person', 'Sarel Cilliers', 'FFX staff', 'inward', NULL, NULL, false, 1),
('tr-anna',    'tr-ffx', 'person', 'Anna Lillebø', 'FFX staff', 'inward', NULL, NULL, false, 2),
('tr-beniah',  'tr-ffx', 'person', 'Beniah Ted', 'FFX staff', 'inward', NULL, NULL, false, 3),
('tr-clark',   'tr-ffx', 'person', 'Clark Bossert', 'FFX staff', 'inward', NULL, NULL, false, 4),
('tr-jordanvz','tr-ffx', 'person', 'Jordan van Zyl', 'FFX staff', 'inward', NULL, NULL, false, 5),
('tr-justine', 'tr-ffx', 'person', 'Justine van Dyk', 'FFX staff', 'inward', NULL, NULL, false, 6),
('tr-ajn',     'tr-ffx', 'person', 'AJ Naudé', 'FFX staff', 'inward', NULL, NULL, false, 7),
('tr-marneb',  'tr-ffx', 'person', 'Marné Beukes', 'FFX staff', 'inward', NULL, NULL, false, 8),
('tr-naomi',   'tr-ffx', 'person', 'Naomi Kilne', 'FFX staff', 'inward', NULL, NULL, false, 9),
('tr-nicole',  'tr-ffx', 'person', 'Nicole Stander', 'FFX staff', 'inward', NULL, NULL, false, 10),
('tr-shanya',  'tr-ffx', 'person', 'Shanya van Rensburg', 'FFX staff', 'inward', NULL, NULL, false, 11),
('tr-stephan', 'tr-ffx', 'person', 'Stephan Kuhn', 'FFX staff', 'inward', NULL, NULL, false, 12),
('tr-thaddeus','tr-ffx', 'person', 'Thaddeus Alexander', 'FFX staff', 'inward', NULL, NULL, false, 13),
('tr-vanilza', 'tr-ffx', 'person', 'Vanilza Camal', 'FFX staff', 'inward', NULL, NULL, false, 14),
('tr-carieke', 'tr-ffx', 'person', 'Carieke Jacobs', 'FFX staff', 'inward', NULL, NULL, false, 15),
('tr-wikus2',  'tr-ffbx', 'person', 'Wikus', 'FFBX Coach', 'inward', NULL, NULL, false, 0),
('tr-tionne',  'tr-ffbx', 'person', 'Tiónne', 'Point School Leader', 'inward', NULL, NULL, false, 1),
('tr-moriah',  'tr-ffbx', 'person', 'Moriah', 'FFBX', 'inward', NULL, NULL, false, 2),
('tr-david',   'tr-ffbx', 'person', 'David', 'FFBX', 'inward', NULL, NULL, false, 3),
('tr-makaio',  'tr-ffbx', 'person', 'Makai''o', 'FFBX', 'inward', NULL, NULL, false, 4),
('tr-riley2',  'tr-ffsbi', 'person', 'Riley', 'FFSBI Coach & Point Leader', 'inward', NULL, NULL, false, 0),
('tr-seth',    'tr-ffsbi', 'person', 'Seth Johnson', 'FFSBI co-leader', 'inward', NULL, NULL, false, 1),
('tr-matthewg','tr-ffsbi', 'person', 'Matthew Gibson', 'FFSBI co-leader', 'inward', NULL, NULL, false, 2),
('tr-david2',  'tr-ffsbi', 'person', 'David-Jesse Rootman', 'FFSBI staff', 'inward', NULL, NULL, false, 3),
('tr-chanep',  'tr-ffsbi', 'person', 'Chané Pienaar', 'FFSBI staff', 'inward', NULL, NULL, false, 4),
('tr-rebecca', 'tr-ffsbi', 'person', 'Rebecca Turchi', 'FFSBI staff', 'inward', NULL, NULL, false, 5),
('tr-sydney',  'tr-ffsbi', 'person', 'Sydney Peterson', 'FFSBI staff', 'inward', NULL, NULL, false, 6),
('tr-elijah',  'tr-ffsbi', 'person', 'Elijah Roberts', 'FFSBI staff', 'inward', NULL, NULL, false, 7),
('tr-sharissa','tr-rca', 'person', 'Sharissa', 'RCA Principal & Point Leader', 'inward', NULL, NULL, false, 0),
('tr-jaco2',   'tr-track', 'person', 'Jaco', 'Point Leader', 'inward', NULL, NULL, false, 0),
('tr-marlon',  'tr-track', 'person', 'Marlon', 'FFLTrack', 'inward', NULL, NULL, false, 1),
('tr-jaco3',   'tr-efl', 'person', 'Jaco', 'Point Leader', 'inward', NULL, NULL, false, 0),
('tr-cassie',  'tr-efl', 'person', 'Cassie', 'Ministry Leader', 'inward', NULL, NULL, false, 1),
('tr-madri',   'tr-efl', 'person', 'Madri', 'Team member / Trainer', 'inward', NULL, NULL, false, 2),
('tr-anita',   'tr-ffx', 'person', 'Anita', 'School Leader', 'inward', NULL, NULL, false, 16),
('tr-delano',  'tr-ffx', 'person', 'Delano', 'School Leader', 'inward', NULL, NULL, false, 17),
('tr-jurie',   'tr-ffx', 'person', 'Jurie', 'School Leader', 'inward', NULL, NULL, false, 18),
('tr-kelly',   'tr-ffx', 'person', 'Kelly', 'School Leader', 'inward', NULL, NULL, false, 19),
('tr-wayne',   'tr-ffx', 'person', 'Wayne', 'School Leader', 'inward', NULL, NULL, false, 20);

-- Prayer & Worship (24) — Davis
INSERT INTO _seed VALUES
('wo-heads',   'team-worship', 'subteam', 'Department Heads', '6', 'inward', 6, NULL, false, 0),
('wo-members', 'team-worship', 'subteam', 'Team Members',     '17', 'inward', 17, NULL, false, 1);
INSERT INTO _seed VALUES
('wo-davis',     'team-worship', 'person', 'Davis', 'Ministry Leader · oversight of all departments', 'inward', NULL, NULL, false, 0),
('wo-cooper',    'wo-heads', 'person', 'Cooper', 'Songwriting · Music Track DTS', 'inward', NULL, NULL, false, 0),
('wo-molly',     'wo-heads', 'person', 'Molly', 'Outreach / Nations · Songwriting', 'inward', NULL, NULL, false, 1),
('wo-jan',       'wo-heads', 'person', 'Jan', 'Training', 'inward', NULL, NULL, false, 2),
('wo-bianca',    'wo-heads', 'person', 'Bianca', 'Media', 'inward', NULL, NULL, false, 3),
('wo-jolizna',   'wo-heads', 'person', 'Jolizna', 'Prayer Room', 'inward', NULL, NULL, false, 4),
('wo-jack',      'wo-heads', 'person', 'Jack', 'Production', 'inward', NULL, NULL, false, 5),
('wo-lizaan',    'wo-members', 'person', 'Lizaan', 'Songwriting Retreats · Vocal Manager · Worship Leader', 'inward', NULL, NULL, false, 0),
('wo-danielle',  'wo-members', 'person', 'Danielle Richwine', 'Nations team · Ministry Night Scheduling', 'inward', NULL, NULL, false, 1),
('wo-jaden',     'wo-members', 'person', 'Jaden', 'Training · Production · Evaluations', 'inward', NULL, NULL, false, 2),
('wo-lise',      'wo-members', 'person', 'Lise', 'Prayer Room (Burns, Devo Sets)', 'inward', NULL, NULL, false, 3),
('wo-sarahb',    'wo-members', 'person', 'Sarah Bonn', 'Systems · Scheduling', 'inward', NULL, NULL, false, 4),
('wo-julia',     'wo-members', 'person', 'Julia Peixoto', 'Systems for Production & Prayer Room (Temp)', 'inward', NULL, 'temp', false, 5),
('wo-charina',   'wo-members', 'person', 'Charina Barnard', 'Worship & Prayer Circle', 'inward', NULL, NULL, false, 6),
('wo-calebf',    'wo-members', 'person', 'Caleb Frow', 'Worship & Prayer Circle (Temp)', 'inward', NULL, 'temp', false, 7),
('wo-paulo',     'wo-members', 'person', 'Paulo Leão', 'Evangelism · joined from Woven (June 2026)', 'inward', NULL, NULL, false, 8),
('wo-briana',    'wo-members', 'person', 'Briana Boll', 'Songwriting team · Worship Leader', 'inward', NULL, NULL, false, 9),
('wo-hendriette','wo-members', 'person', 'Hendriëtte', 'Production team · Prayer Leader Scheduling · Main Slides', 'inward', NULL, NULL, false, 10),
('wo-kay',       'wo-members', 'person', 'Kay', 'Music Track DTS · Main Systems · Calendar / Stats · Media', 'inward', NULL, NULL, false, 11),
('wo-philip',    'wo-members', 'person', 'Philip van Staden', 'Worship Leader · Ministry Night Scheduling · OKR Manager', 'inward', NULL, NULL, false, 12),
('wo-tharina',   'wo-members', 'person', 'Tharina', 'Prayer Room team · Media team', 'inward', NULL, NULL, false, 13),
('wo-carmella',  'wo-members', 'person', 'Carmella Clark', 'Worship & Prayer Circle', 'inward', NULL, NULL, false, 14),
('wo-kristine',  'wo-members', 'person', 'Kristine Kilman', 'Worship & Prayer Circle', 'inward', NULL, NULL, false, 15),
('wo-malise',    'wo-members', 'person', 'Malise Landes', 'Worship & Prayer Circle (Temp)', 'inward', NULL, 'temp', false, 16),
('wo-bianca-vdm','wo-members', 'person', 'Bianca vdm', 'Worship & Prayer Circle', 'inward', NULL, NULL, false, 17),
('wo-jan-hendrik','wo-members', 'person', 'Jan-Hendrik van der Merwe', 'Worship & Prayer Circle', 'inward', NULL, NULL, false, 18),
('wo-jolizna-r', 'wo-members', 'person', 'Jolizna Roestorf', 'Worship & Prayer Circle', 'inward', NULL, NULL, false, 19),
('wo-jackk',     'wo-members', 'person', 'Jack Killman', 'Worship & Prayer Circle', 'inward', NULL, NULL, false, 20),
('wo-kaymc',     'wo-members', 'person', 'Kay McBratney', 'Worship & Prayer Circle', 'inward', NULL, NULL, false, 21);

-- ════════════════════════════════════════════════════════════
-- BACKBONE · SUPPORT
-- ════════════════════════════════════════════════════════════
INSERT INTO _seed VALUES
('team-ops',     'cluster-backbone', 'team', 'Operations',      'Base · hospitality · kitchens',     'backbone', 17, NULL, true, 0),
('team-finance', 'cluster-backbone', 'team', 'Finances & Legal','Stewardship · compliance',          'backbone', 2,  NULL, false, 1),
('team-donors',  'cluster-backbone', 'team', 'Donors & Dev',    'Corporate fundraising',             'backbone', NULL, NULL, false, 2),
('team-media',   'cluster-backbone', 'team', 'Media',           'Content · comms · marketing',       'backbone', 9,  NULL, true, 3);

-- Operations (17) — Michelle
INSERT INTO _seed VALUES
('ops-init',     'team-ops', 'subteam', 'Initiatives · Buildings', 'Point: Michelle / HE Steyn', 'backbone', NULL, NULL, false, 0),
('ops-living',   'team-ops', 'subteam', 'Living & Logistics',      'Hospitality · hosting · systems', 'backbone', NULL, NULL, false, 1),
('ops-kitchens', 'team-ops', 'subteam', 'Base Kitchens',           'Point: Maché', 'backbone', NULL, NULL, false, 2);
INSERT INTO _seed VALUES
('ops-michelle', 'ops-init', 'person', 'Michelle', 'Operations point leader · Initiatives', 'backbone', NULL, NULL, false, 0),
('ops-hesteyn',  'ops-init', 'person', 'HE Steyn', 'Buildings · Security · Maintenance point leader', 'backbone', NULL, NULL, false, 1),
('ops-gideon',   'ops-init', 'person', 'Gideon', 'Base vehicles · systems & maintenance', 'backbone', NULL, NULL, false, 2),
('ops-eddie',    'ops-init', 'person', 'Oom Eddie', 'Maintenance crew lead (buildings & spaces)', 'backbone', NULL, NULL, false, 3),
('ops-joshj',    'ops-init', 'person', 'Josh J', 'Maintenance crew', 'backbone', NULL, NULL, false, 4),
('ops-dylan',    'ops-init', 'person', 'Dylan', 'Buildings & maintenance', 'backbone', NULL, NULL, false, 5),
('ops-annie',    'ops-living', 'person', 'Annie', 'Guests & cleaning supplies', 'backbone', NULL, NULL, false, 0),
('ops-enge',     'ops-living', 'person', 'Enge', 'Hospitality point leader · FFSA schools & staff rooms', 'backbone', NULL, NULL, false, 1),
('ops-mache',    'ops-living', 'person', 'Maché', 'Hosting & kitchens point leader · outreach & events', 'backbone', NULL, NULL, false, 2),
('ops-dj',       'ops-kitchens', 'person', 'DJ', 'Lemon Blossom kitchen', 'backbone', NULL, NULL, false, 0),
('ops-chane',    'ops-kitchens', 'person', 'Chané', 'Lemon Blossom kitchen', 'backbone', NULL, NULL, false, 1),
('ops-millie',   'ops-kitchens', 'person', 'Millie', 'Lemon Blossom kitchen', 'backbone', NULL, NULL, false, 2),
('ops-michael',  'ops-kitchens', 'person', 'Michael', 'OG Kitchen', 'backbone', NULL, NULL, false, 3),
('ops-kay',      'ops-kitchens', 'person', 'Kay', 'OG Kitchen', 'backbone', NULL, NULL, false, 4),
('ops-biancav',  'ops-kitchens', 'person', 'Bianca V', 'OG Kitchen', 'backbone', NULL, NULL, false, 5),
('ops-marne',    'ops-kitchens', 'person', 'Marné', 'Container Kitchen', 'backbone', NULL, NULL, false, 6),
('ops-matthewg', 'ops-kitchens', 'person', 'Matthew G', 'Container Kitchen', 'backbone', NULL, NULL, false, 7);

-- Finances & Legal (2) — Coreen Styn
INSERT INTO _seed VALUES
('fin-coreen', 'team-finance', 'person', 'Coreen Styn', 'Finance Manager & Legal Department Lead', 'backbone', NULL, NULL, false, 0),
('fin-ellen',  'team-finance', 'person', 'Ellen Styn', 'Finance Clerk (under Coreen)', 'backbone', NULL, NULL, false, 1);

-- Donors & Dev — Brendon (cross-team; primary in Leadership, shown here as lead)
INSERT INTO _seed VALUES
('don-brendon', 'team-donors', 'person', 'Brendon', 'Corporate fundraising lead', 'backbone', NULL, NULL, false, 0);

-- Media (9) — Tosca + Ghost Team
INSERT INTO _seed VALUES
('me-tosca',    'team-media', 'person', 'Tosca', 'Media Point Leader & Creative Lead', 'backbone', NULL, NULL, false, 0),
('me-nathaly',  'team-media', 'person', 'Nathaly', 'Marketing Director & Ministry Leader · Training Systems', 'backbone', NULL, NULL, false, 1),
('me-annika',   'team-media', 'person', 'Annika', 'Ghost Team point person: content executor', 'backbone', NULL, NULL, false, 2),
('me-ilne',     'team-media', 'person', 'Ilne', 'Ghost Team support · photography · future Ghost Team lead', 'backbone', NULL, NULL, false, 3),
('me-wianco',   'team-media', 'person', 'Wianco', 'Videographer', 'backbone', NULL, NULL, false, 4),
('me-colton',   'team-media', 'person', 'Colton', 'Videographer', 'backbone', NULL, NULL, false, 5),
('me-annwaniq', 'team-media', 'person', 'Ann-Waniq', 'Ministry Nights content · photography & editing trainee', 'backbone', NULL, NULL, false, 6),
('me-gitte',    'team-media', 'person', 'Gitte', 'Volunteer photographer (not FFSA staff)', 'backbone', NULL, NULL, false, 7),
('me-nina',     'team-media', 'person', 'Nina', 'Merch · on sabbatical; future role under review', 'backbone', NULL, 'temp', false, 8);

-- ════════════════════════════════════════════════════════════
-- ALONGSIDE STRUCTURE — Missio Church (parallel, dotted)
-- ════════════════════════════════════════════════════════════
INSERT INTO _seed VALUES
('missio',        NULL,      'stream', 'Missio Church',         'Sodality & modality · two expressions of one body', 'sand', NULL, NULL, false, 99),
('missio-leaders','missio',  'stream', 'Missio Leadership',     'Gabriel (Senior) · Eduard (Frontiers Church Planting)', 'sand', NULL, NULL, false, 0),
('missio-comm',   'missio-leaders', 'stream', 'Missional Communities', NULL, 'sand', NULL, NULL, false, 0),
('missio-groups', 'missio-comm', 'stream', 'Small Groups',      '6+ active', 'sand', NULL, NULL, false, 0),
('missio-disc',   'missio-groups', 'stream', 'Individual Disciples', NULL, 'sand', NULL, NULL, false, 0);

-- ── Cross-team service & parallel connectors (dotted) ───────
INSERT INTO _seed_edges VALUES
('p-gabriel',  'missio',         'parallel',   'alongside'),
('p-eduard',   'missio',         'parallel',   'church planting'),
('p-gabriel',  'team-events',    'cross_team', 'mobilises'),
('p-eduard',   'team-p54',       'cross_team', 'Project 54'),
('p-hanno',    'team-p54',       'cross_team', 'Project 54'),
('p-brendon',  'team-events',    'cross_team', 'finance'),
('p-brendon',  'team-finance',   'cross_team', 'finance'),
('p-brendon',  'team-donors',    'cross_team', 'fundraising'),
('p-ally',     'team-training',  'cross_team', 'FFX coach'),
('p-ally',     'team-inside',    'cross_team', 'Inside Ministry'),
('p-michelle', 'team-ops',       'cross_team', 'Operations'),
('p-jaco',     'team-training',  'cross_team', 'Training Director'),
('p-caleb',    'team-outside',   'cross_team', 'Outside Ministry'),
('p54-mercy',  'tr-core',        'cross_team', 'short-form coach'),
('p54-veronica','team-p54',      'cross_team', 'Training point'),
('me-tosca',   'team-events',    'cross_team', 'Events media'),
('me-nathaly', 'tr-core',        'cross_team', 'Training systems'),
('ops-mache',  'team-events',    'cross_team', 'hosting'),
('h-gabrielvw','team-events',    'cross_team', 'mobilisation'),
('w-steph',    'team-finance',   'cross_team', 'finance'),
('p54-josiah', 'team-worship',   'cross_team', 'Prayer & Worship');

-- ── Resolve the staging tables into real rows ───────────────
INSERT INTO public.org_nodes
  (chart_id, key, kind, label, subtitle, accent, headcount, status, collapsed, sort_order)
SELECT v_chart, key, kind, label, subtitle, accent, headcount, status,
       COALESCE(collapsed, false), sort_order
FROM _seed;

UPDATE public.org_nodes n
SET parent_id = p.id
FROM _seed s
JOIN public.org_nodes p ON p.key = s.parent_key AND p.chart_id = v_chart
WHERE n.key = s.key AND n.chart_id = v_chart AND s.parent_key IS NOT NULL;

INSERT INTO public.org_edges (chart_id, source_id, target_id, kind, label)
SELECT v_chart, src.id, tgt.id, e.kind, e.label
FROM _seed_edges e
JOIN public.org_nodes src ON src.key = e.source_key AND src.chart_id = v_chart
JOIN public.org_nodes tgt ON tgt.key = e.target_key AND tgt.chart_id = v_chart;

END $$;

-- ============================================================
-- Validation (run in the Supabase SQL Editor after applying)
-- ------------------------------------------------------------
--   SELECT kind, count(*) FROM public.org_nodes
--     WHERE chart_id = (SELECT id FROM public.org_charts WHERE slug='ffsa-2026')
--     GROUP BY kind ORDER BY kind;
--   -- expect ~157 person rows + clusters/teams/subteams/stream
--   SELECT count(*) FROM public.org_edges
--     WHERE chart_id = (SELECT id FROM public.org_charts WHERE slug='ffsa-2026');
--   SELECT key, display_name FROM public.permissions WHERE module = 'org-chart';
-- ============================================================
