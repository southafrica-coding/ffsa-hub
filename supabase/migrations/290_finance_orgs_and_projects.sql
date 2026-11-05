-- ============================================================
-- FFSA Hub — Migration 290: finance organisations + per-org projects
-- ============================================================
-- APPLY ORDER: stands alone on top of main (289). It does NOT need the
-- Xero code mirror (275, PR #474) or the budget tables (277–279, PR #475)
-- and can be applied before or after them.
--
-- Finance runs two separate organisations, each with its own Xero file:
--
--   key   name          xero_region  records in   Xero tenant name (xero_tokens)
--   npc   FFSA NPC      za           ZAR          "Fire & Fragrance SA NPC"
--   usa   FF USA Inc    us           USD          "FF SA USA, Inc"
--
-- The Hub names above are the short names finance uses; the Xero tenant
-- names are left exactly as they are (nothing is renamed). finance_orgs maps
-- 1:1 onto the existing xero_region ('za' | 'us') used by xero_tokens,
-- student_billing_plans, orders and invoice_email_templates. Those existing
-- records keep their xero_region, which maps to an org through
-- finance_orgs.xero_region, so NO duplicate org_id is added to
-- student_billing_plans or invoice_email_templates.
--
-- FF USA Inc records are always in USD: anything that lands in the US
-- account is recorded in USD under FF USA Inc. FFSA NPC records are in ZAR.
--
-- What this adds:
--
--   1. public.finance_orgs — the two organisations (seeded).
--
--   2. public.finance_projects — the Hub's "projects": the options of each
--      org's Xero tracking category "Ministries", stored PER ORG. Seeded
--      from the two CSV exports in supabase/seed-data/finance/
--      (38 for FFSA NPC, 32 for FF USA Inc), spelled exactly as in Xero, in
--      CSV order (sort_order). Projects are never merged across orgs:
--      'EFLTanz' (NPC) and 'EFL Tanz' (USA) are two rows, unlinked.
--        * project_type (ministry / event / asset) is NULL for every seeded
--          row. Finance sets it by hand; nothing is guessed.
--        * linked_project_id is the cross-org link ("this NPC project is
--          that USA project"). NULL for every row; set only by hand. There
--          is NO automatic linking by name.
--        * Rows are never hard-deleted: archive (is_active = false,
--          archived_at) instead. There is no DELETE policy.
--      A trigger keeps org_id fixed, checks the cross-org link and keeps
--      updated_at. A second trigger lets only an admin change the Xero-owned
--      fields (name, source).
--
--   3. Org choice per event / per payment — explicit, never derived:
--        events.finance_org_id   the event's org (NULL = not chosen yet)
--        orders.finance_org_id   per-payment override (NULL = use the event's)
--        public.finance_org_for_order(order_id) =
--          coalesce(order.finance_org_id, event.finance_org_id)
--      Rand can go to EITHER org, so there is NO currency → org routing and
--      NO default org. NULL means "finance org not chosen yet"; callers must
--      never guess. Both columns are plain nullable additions; existing rows
--      are not backfilled.
--
--   4. RLS: finance reads both tables (is_admin / finance_admin /
--      finance.view / finance.edit). Finance editors (is_admin /
--      finance_admin / finance.edit) may update and add projects. Only
--      is_admin() writes finance_orgs. No DELETE policy, no anon access.
--
-- ACCOUNT CODES: the chart of accounts is on hold (Coreen has not sent it),
-- so this migration adds NO account-code column anywhere. Any account / code
-- column on a future finance record (transactions, budget lines) must be
-- NULLABLE until the chart of accounts arrives. PR #475's
-- budget_line_coding.account_id is already nullable; there is no
-- transactions table on main yet.
--
-- Only adds objects (plus the two nullable columns above). No existing row
-- is changed.
--
-- Safe to re-run: tables, indexes and columns are IF NOT EXISTS, functions
-- are CREATE OR REPLACE, constraints added with ALTER TABLE are guarded by a
-- pg_constraint check, triggers and policies are dropped by name before
-- they are created, seed rows are ON CONFLICT DO NOTHING (a later edit by
-- finance is never overwritten).
--
-- ROLLBACK (summary): drop the function, the two columns on events/orders,
-- then finance_projects and finance_orgs. Full block at the end of this file.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Organisations
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_orgs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                    text NOT NULL UNIQUE CHECK (key IN ('npc', 'usa')),
  name                   text NOT NULL,
  xero_region            text NOT NULL UNIQUE CHECK (xero_region IN ('za', 'us')),
  record_currency        text NOT NULL CHECK (record_currency IN ('ZAR', 'USD')),
  projects_category_name text NOT NULL DEFAULT 'Ministries',
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Already there → left alone, so re-running never overrides an admin's edit.
INSERT INTO public.finance_orgs (key, name, xero_region, record_currency)
VALUES
  ('npc', 'FFSA NPC',   'za', 'ZAR'),
  ('usa', 'FF USA Inc', 'us', 'USD')
ON CONFLICT (key) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 2. Projects (Xero "Ministries" options, per org)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.finance_orgs(id) ON DELETE RESTRICT,
  name              text NOT NULL CHECK (btrim(name) <> ''),
  match_key         text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  sort_order        integer,
  project_type      text CHECK (project_type IS NULL OR project_type IN ('ministry', 'event', 'asset')),
  linked_project_id uuid REFERENCES public.finance_projects(id) ON DELETE SET NULL,
  notes             text,
  is_active         boolean NOT NULL DEFAULT true,
  archived_at       timestamptz,
  source            text DEFAULT 'xero_csv_2026-11-05',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES public.users(id) ON DELETE SET NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'finance_projects_org_name_key'
       AND conrelid = 'public.finance_projects'::regclass
  ) THEN
    ALTER TABLE public.finance_projects
      ADD CONSTRAINT finance_projects_org_name_key UNIQUE (org_id, name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS finance_projects_org_id_idx       ON public.finance_projects (org_id);
CREATE INDEX IF NOT EXISTS finance_projects_project_type_idx ON public.finance_projects (project_type);

-- org_id never changes; the cross-org link must point at a different
-- project in a DIFFERENT org; updated_at is kept current.
CREATE OR REPLACE FUNCTION public.finance_projects_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  v_linked_org uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'A finance project cannot move to another organisation (org_id is fixed)';
  END IF;

  IF NEW.linked_project_id IS NOT NULL THEN
    IF NEW.linked_project_id = NEW.id THEN
      RAISE EXCEPTION 'A finance project cannot be linked to itself';
    END IF;
    SELECT org_id INTO v_linked_org
      FROM public.finance_projects
     WHERE id = NEW.linked_project_id;
    IF v_linked_org IS NULL THEN
      RAISE EXCEPTION 'Linked finance project % does not exist', NEW.linked_project_id;
    END IF;
    IF v_linked_org = NEW.org_id THEN
      RAISE EXCEPTION 'A finance project can only be linked to a project in the other organisation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_projects_guard ON public.finance_projects;
CREATE TRIGGER finance_projects_guard
  BEFORE INSERT OR UPDATE ON public.finance_projects
  FOR EACH ROW EXECUTE FUNCTION public.finance_projects_guard();

-- Names (and where they came from) are seeded from Xero: only an admin may
-- change them. auth.uid() IS NULL is the SQL editor / service role (no
-- signed-in person), which is how a later Xero sync or a hand fix runs.
-- match_key is generated from name, so it follows the same rule.
CREATE OR REPLACE FUNCTION public.finance_projects_protect_xero_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF (NEW.name IS DISTINCT FROM OLD.name OR NEW.source IS DISTINCT FROM OLD.source)
     AND auth.uid() IS NOT NULL
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can change a finance project''s name or source (they come from Xero)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_projects_protect_xero_fields ON public.finance_projects;
CREATE TRIGGER finance_projects_protect_xero_fields
  BEFORE UPDATE ON public.finance_projects
  FOR EACH ROW EXECUTE FUNCTION public.finance_projects_protect_xero_fields();


-- ────────────────────────────────────────────────────────────
-- 3. Seed: the "Ministries" options from the two Xero CSV exports
-- ────────────────────────────────────────────────────────────
-- supabase/seed-data/finance/ffsa-npc-tracking-categories.csv   → npc (38)
-- supabase/seed-data/finance/ff-usa-inc-tracking-categories.csv → usa (32)
-- Spelled exactly as in Xero, CSV order. project_type and
-- linked_project_id are NOT set: both are left for finance to decide.
-- Already there → left alone.
INSERT INTO public.finance_projects (org_id, sort_order, name)
SELECT o.id, v.sort_order, v.name
  FROM public.finance_orgs o
  JOIN (VALUES
  ('npc',  1, '1040 Crossfit'),
  ('npc',  2, 'BASE 36 SPRUIT BUILDINGS'),
  ('npc',  3, 'Base Beauty'),
  ('npc',  4, 'Brave Love'),
  ('npc',  5, 'EBPN'),
  ('npc',  6, 'EFL'),
  ('npc',  7, 'EFLTanz'),
  ('npc',  8, 'FFBX'),
  ('npc',  9, 'FIRE & FRAGRANCE BUILDING (BOURBONS)'),
  ('npc', 10, 'Gap Year - Marketing'),
  ('npc', 11, 'General Donation'),
  ('npc', 12, 'General Non Budgeted'),
  ('npc', 13, 'Glory'),
  ('npc', 14, 'Hope Again'),
  ('npc', 15, 'HS Camp'),
  ('npc', 16, 'HULC'),
  ('npc', 17, 'HULC Merch'),
  ('npc', 18, 'Leaders GG'),
  ('npc', 19, 'Media'),
  ('npc', 20, 'Merch'),
  ('npc', 21, 'Missio - JHB'),
  ('npc', 22, 'Missio - Potch'),
  ('npc', 23, 'Missio to Base (10%)'),
  ('npc', 24, 'MOTOR VEHICLES - FLEET'),
  ('npc', 25, 'NOORDBRUG CENTRE BUILDING'),
  ('npc', 26, 'Old Age Ministry'),
  ('npc', 27, 'PREACHERS EVENT'),
  ('npc', 28, 'Project 54'),
  ('npc', 29, 'Redwood Christian Academy'),
  ('npc', 30, 'Rooted'),
  ('npc', 31, 'The Send'),
  ('npc', 32, 'Uni Camp'),
  ('npc', 33, 'Uni Camp - Potch (Sept 26)'),
  ('npc', 34, 'Uni Camp - WC (Sept 26)'),
  ('npc', 35, 'Wild Ones Conf'),
  ('npc', 36, 'Witness'),
  ('npc', 37, 'Worship & Prayer'),
  ('npc', 38, 'Woven'),
  ('usa',  1, '1040 Crossfit'),
  ('usa',  2, 'Brave Love'),
  ('usa',  3, 'Camp - Potch'),
  ('usa',  4, 'Camp - WC'),
  ('usa',  5, 'Church'),
  ('usa',  6, 'EBPN'),
  ('usa',  7, 'Educating for Life'),
  ('usa',  8, 'EFL 2026'),
  ('usa',  9, 'EFL Tanz'),
  ('usa', 10, 'FF Global Gathering'),
  ('usa', 11, 'FFSA Music'),
  ('usa', 12, 'General Donation'),
  ('usa', 13, 'General Non Budgeted'),
  ('usa', 14, 'Global Leaders'),
  ('usa', 15, 'Glory'),
  ('usa', 16, 'Hope Again'),
  ('usa', 17, 'HULC'),
  ('usa', 18, 'Media'),
  ('usa', 19, 'Merch'),
  ('usa', 20, 'Missio - JHB'),
  ('usa', 21, 'Missio - Potch'),
  ('usa', 22, 'Mission to Base (10%)'),
  ('usa', 23, 'Old Age Ministry'),
  ('usa', 24, 'Preachers'),
  ('usa', 25, 'Project 54'),
  ('usa', 26, 'Redwoods Christian Academy'),
  ('usa', 27, 'The Send'),
  ('usa', 28, 'Virtual Sports'),
  ('usa', 29, 'Wild Ones Conference'),
  ('usa', 30, 'Wild Ones Fundraising'),
  ('usa', 31, 'Worship & Prayer'),
  ('usa', 32, 'Woven')
  ) AS v(org_key, sort_order, name) ON o.key = v.org_key
ON CONFLICT (org_id, name) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 4. Org choice per event and per payment
-- ────────────────────────────────────────────────────────────
-- No default and no backfill: NULL means "not chosen yet".
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS finance_org_id uuid REFERENCES public.finance_orgs(id) ON DELETE SET NULL;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS finance_org_id uuid REFERENCES public.finance_orgs(id) ON DELETE SET NULL;

-- The payment's own choice wins, else the event's, else NULL. Never derived
-- from currency. Runs as the caller, so RLS on orders/events applies.
CREATE OR REPLACE FUNCTION public.finance_org_for_order(p_order_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT coalesce(o.finance_org_id, e.finance_org_id)
    FROM public.orders o
    LEFT JOIN public.events e ON e.id = o.event_id
   WHERE o.id = p_order_id;
$$;

REVOKE ALL ON FUNCTION public.finance_org_for_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_org_for_order(uuid) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────
-- 5. RLS — finance reads; finance editors update/add projects;
--    only admins write orgs; nobody deletes; no anon
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.finance_orgs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_projects ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.finance_orgs     FROM anon;
REVOKE ALL ON public.finance_projects FROM anon;

DROP POLICY IF EXISTS "Finance can read finance orgs" ON public.finance_orgs;
CREATE POLICY "Finance can read finance orgs"
  ON public.finance_orgs FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
  );

DROP POLICY IF EXISTS "Admins can add finance orgs" ON public.finance_orgs;
CREATE POLICY "Admins can add finance orgs"
  ON public.finance_orgs FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update finance orgs" ON public.finance_orgs;
CREATE POLICY "Admins can update finance orgs"
  ON public.finance_orgs FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Finance can read finance projects" ON public.finance_projects;
CREATE POLICY "Finance can read finance projects"
  ON public.finance_projects FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
  );

DROP POLICY IF EXISTS "Finance editors can add finance projects" ON public.finance_projects;
CREATE POLICY "Finance editors can add finance projects"
  ON public.finance_projects FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.edit')
  );

DROP POLICY IF EXISTS "Finance editors can update finance projects" ON public.finance_projects;
CREATE POLICY "Finance editors can update finance projects"
  ON public.finance_projects FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.edit')
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.edit')
  );


-- ────────────────────────────────────────────────────────────
-- 6. Comments
-- ────────────────────────────────────────────────────────────
COMMENT ON TABLE public.finance_orgs IS
  'The two finance organisations, 1:1 with xero_region. npc = FFSA NPC (Xero tenant "Fire & Fragrance SA NPC", records in ZAR); usa = FF USA Inc (Xero tenant "FF SA USA, Inc", records always in USD). Existing records with a xero_region map to an org through xero_region.';
COMMENT ON COLUMN public.finance_orgs.record_currency IS
  'The currency this org''s finance records are kept in. FF USA Inc is always USD (anything landing in the US account is recorded in USD). Not used to route money: the org is chosen explicitly per event / payment.';
COMMENT ON COLUMN public.finance_orgs.projects_category_name IS
  'The Xero tracking category whose options are this org''s projects (finance_projects). ''Ministries'' in both orgs.';

COMMENT ON TABLE public.finance_projects IS
  'Hub projects: the options of each org''s Xero "Ministries" tracking category, stored per org and never merged across orgs. Archived, never hard-deleted.';
COMMENT ON COLUMN public.finance_projects.project_type IS
  'ministry / event / asset, or NULL = not set. Set by finance by hand; never guessed.';
COMMENT ON COLUMN public.finance_projects.linked_project_id IS
  'Manual cross-org link to the same project in the other org. Always NULL unless finance sets it; never linked automatically by name.';
COMMENT ON COLUMN public.finance_projects.match_key IS
  'Generated: lower(btrim(name)). For matching names typed elsewhere regardless of case or stray spaces. Never used to link projects across orgs.';
COMMENT ON COLUMN public.finance_projects.sort_order IS
  'Position in the Xero CSV export the row was seeded from.';

COMMENT ON COLUMN public.events.finance_org_id IS
  'Which finance org this event''s money goes to. NULL = not chosen yet (never guessed from currency).';
COMMENT ON COLUMN public.orders.finance_org_id IS
  'Per-payment override of the event''s finance org. NULL = use the event''s (see finance_org_for_order).';
COMMENT ON FUNCTION public.finance_org_for_order(uuid) IS
  'coalesce(orders.finance_org_id, events.finance_org_id). NULL = finance org not chosen yet; callers must not guess. No currency fallback.';


-- ============================================================
-- Verify:
--   SELECT key, name, xero_region, record_currency FROM public.finance_orgs ORDER BY key;
--                                                  -- npc / usa
--   SELECT o.key, count(*) FROM public.finance_projects p
--     JOIN public.finance_orgs o ON o.id = p.org_id GROUP BY o.key ORDER BY o.key;
--                                                  -- npc 38, usa 32
--   SELECT count(*) FROM public.finance_projects
--    WHERE project_type IS NOT NULL OR linked_project_id IS NOT NULL;   -- 0
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename LIKE 'finance\_%';
--                                                  -- no DELETE rows
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK:
--   WARNING: deletes every project type, note and link finance has set,
--   and every org chosen on an event or payment.
--
--   DROP FUNCTION IF EXISTS public.finance_org_for_order(uuid);
--   ALTER TABLE public.orders DROP COLUMN IF EXISTS finance_org_id;
--   ALTER TABLE public.events DROP COLUMN IF EXISTS finance_org_id;
--   DROP TABLE IF EXISTS public.finance_projects CASCADE;
--   DROP FUNCTION IF EXISTS public.finance_projects_guard();
--   DROP FUNCTION IF EXISTS public.finance_projects_protect_xero_fields();
--   DROP TABLE IF EXISTS public.finance_orgs CASCADE;
-- ------------------------------------------------------------
