-- ============================================================
-- FFSA Hub — Migration 275: Xero code mirror (finance PR-1)
-- ============================================================
-- A read-only local copy ("mirror") of the codes finance uses in Xero:
-- the chart of accounts, tracking categories and their options, and items.
-- Budgets (a later PR) will point at these rows by the Hub's own uuid, so a
-- rename in Xero never breaks a budget, and every change is kept as history.
--
-- Nothing reads or writes these tables yet. The sync that fills them, the
-- screens that show them and the budgets that use them come in later PRs.
-- The Hub never writes to Xero.
--
-- Two Xero organisations exist (South Africa = 'za', USA = 'us') and their
-- ids differ, so every mirror row is keyed by org_region + tenant_id + the
-- Xero id. If the organisation behind a region ever changes, the old rows
-- are marked missing and new rows are added beside them — never mixed.
--
-- Rows are NEVER hard-deleted. When Xero stops returning a row the sync
-- sets missing_since; when Xero archives it, status = 'archived'.
--
-- Hub-owned columns (friendly_name, is_hidden on accounts and tracking
-- options) belong to finance, not Xero. The sync never overwrites them.
--
-- Objects created:
--   public.xero_accounts             — chart of accounts, per organisation
--   public.xero_tracking_categories  — tracking categories (e.g. "Schools")
--   public.xero_tracking_options     — options inside a category
--   public.xero_items                — Xero items (product/service codes)
--   public.xero_tracking_roles       — "the category that plays role X";
--                                      seeded with 'schools' for za and us
--   public.xero_sync_runs            — one row per sync run
--   public.xero_mirror_changes       — append-only field-level change history
--   + indexes, one finance read policy per table, comments.
--
-- RLS: finance can read (is_admin / finance_admin / finance.view /
-- finance.edit / budget.view_all). There are NO write policies: the sync
-- runs server-side with the service role, which bypasses RLS. budget.view_all
-- does not exist yet (a later PR adds it); has_permission() returns false for
-- an unknown key, so the policy is safe before then.
--
-- Only adds new objects; no existing table or row is touched.
--
-- Safe to re-run: tables and indexes are IF NOT EXISTS, every policy is
-- dropped by name before it is created again, and the two seeded rows are
-- ON CONFLICT DO NOTHING (an admin's later edit is never overwritten).
--
-- ROLLBACK (summary): drop the seven tables in reverse dependency order —
-- full block at the end of this file. It deletes the mirrored data.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Chart of accounts
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xero_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_region       text NOT NULL CHECK (org_region IN ('za', 'us')),
  tenant_id        text NOT NULL,
  xero_account_id  text NOT NULL,
  -- From Xero. Codes can be changed or reused, so code is NOT unique.
  code             text,
  name             text NOT NULL,
  type             text,
  class            text,                  -- ASSET / EQUITY / EXPENSE / LIABILITY / REVENUE
  tax_type         text,
  is_bank          boolean NOT NULL DEFAULT false,
  currency_code    text,
  description      text,
  -- Hub-owned: never overwritten by the sync.
  friendly_name    text,
  is_hidden        boolean NOT NULL DEFAULT false,
  -- Mirror bookkeeping.
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  missing_since    timestamptz,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_changed_at  timestamptz NOT NULL DEFAULT now(),
  synced_at        timestamptz NOT NULL DEFAULT now(),
  raw              jsonb,
  CONSTRAINT xero_accounts_org_tenant_xero_id_key
    UNIQUE (org_region, tenant_id, xero_account_id)
);

CREATE INDEX IF NOT EXISTS idx_xero_accounts_region_code
  ON public.xero_accounts(org_region, code);


-- ────────────────────────────────────────────────────────────
-- 2. Tracking categories
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xero_tracking_categories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_region        text NOT NULL CHECK (org_region IN ('za', 'us')),
  tenant_id         text NOT NULL,
  xero_category_id  text NOT NULL,
  name              text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  missing_since     timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_changed_at   timestamptz NOT NULL DEFAULT now(),
  synced_at         timestamptz NOT NULL DEFAULT now(),
  raw               jsonb,
  CONSTRAINT xero_tracking_categories_org_tenant_xero_id_key
    UNIQUE (org_region, tenant_id, xero_category_id)
);


-- ────────────────────────────────────────────────────────────
-- 3. Tracking options
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xero_tracking_options (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_region       text NOT NULL CHECK (org_region IN ('za', 'us')),
  tenant_id        text NOT NULL,
  xero_option_id   text NOT NULL,
  category_id      uuid NOT NULL REFERENCES public.xero_tracking_categories(id) ON DELETE RESTRICT,
  name             text NOT NULL,
  -- Case/space-insensitive name, for matching names typed elsewhere.
  match_key        text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  -- Hub-owned: never overwritten by the sync.
  friendly_name    text,
  is_hidden        boolean NOT NULL DEFAULT false,
  -- Mirror bookkeeping.
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  missing_since    timestamptz,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_changed_at  timestamptz NOT NULL DEFAULT now(),
  synced_at        timestamptz NOT NULL DEFAULT now(),
  raw              jsonb,
  CONSTRAINT xero_tracking_options_org_tenant_xero_id_key
    UNIQUE (org_region, tenant_id, xero_option_id)
);

CREATE INDEX IF NOT EXISTS idx_xero_tracking_options_category
  ON public.xero_tracking_options(category_id);
CREATE INDEX IF NOT EXISTS idx_xero_tracking_options_match
  ON public.xero_tracking_options(org_region, category_id, match_key);


-- ────────────────────────────────────────────────────────────
-- 4. Items
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xero_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_region          text NOT NULL CHECK (org_region IN ('za', 'us')),
  tenant_id           text NOT NULL,
  xero_item_id        text NOT NULL,
  code                text,
  name                text,
  description         text,
  sales_account_code  text,
  is_sold             boolean,
  is_purchased        boolean,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  missing_since       timestamptz,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_changed_at     timestamptz NOT NULL DEFAULT now(),
  synced_at           timestamptz NOT NULL DEFAULT now(),
  raw                 jsonb,
  CONSTRAINT xero_items_org_tenant_xero_id_key
    UNIQUE (org_region, tenant_id, xero_item_id)
);

CREATE INDEX IF NOT EXISTS idx_xero_items_region_code
  ON public.xero_items(org_region, code);


-- ────────────────────────────────────────────────────────────
-- 5. Tracking roles
-- ────────────────────────────────────────────────────────────
-- Lets the Hub ask for "the category that plays the role 'schools'" rather
-- than hard-coding the name "Schools". category_id is empty until the first
-- sync has mirrored the categories; the sync then links it by category_name.
CREATE TABLE IF NOT EXISTS public.xero_tracking_roles (
  role_key       text NOT NULL,
  org_region     text NOT NULL CHECK (org_region IN ('za', 'us')),
  category_name  text NOT NULL,
  category_id    uuid REFERENCES public.xero_tracking_categories(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (role_key, org_region)
);


-- ────────────────────────────────────────────────────────────
-- 6. Sync runs
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xero_sync_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_region   text NOT NULL CHECK (org_region IN ('za', 'us')),
  tenant_id    text,
  kind         text NOT NULL CHECK (kind IN ('all', 'accounts', 'tracking', 'items')),
  trigger      text NOT NULL CHECK (trigger IN ('cron', 'manual')),
  started_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  counts       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- inserted / updated / archived / unchanged
  error        text
);

CREATE INDEX IF NOT EXISTS idx_xero_sync_runs_region_started
  ON public.xero_sync_runs(org_region, started_at DESC);


-- ────────────────────────────────────────────────────────────
-- 7. Change history (append-only)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xero_mirror_changes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id      uuid REFERENCES public.xero_sync_runs(id) ON DELETE SET NULL,
  org_region  text NOT NULL CHECK (org_region IN ('za', 'us')),
  entity      text NOT NULL
              CHECK (entity IN ('account', 'tracking_category', 'tracking_option', 'item')),
  entity_id   uuid NOT NULL,                -- no FK: spans four tables
  field       text NOT NULL,                -- e.g. 'name', 'code', 'status'
  old_value   text,
  new_value   text,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xero_mirror_changes_entity
  ON public.xero_mirror_changes(entity, entity_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_xero_mirror_changes_run
  ON public.xero_mirror_changes(run_id);


-- ────────────────────────────────────────────────────────────
-- 8. Seed: the "schools" tracking role in both organisations
-- ────────────────────────────────────────────────────────────
-- Already there → left alone, so re-running never overrides an admin's edit.
INSERT INTO public.xero_tracking_roles (role_key, org_region, category_name)
VALUES
  ('schools', 'za', 'Schools'),
  ('schools', 'us', 'Schools')
ON CONFLICT (role_key, org_region) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 9. RLS — finance can read; nobody writes except the service role
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.xero_accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_tracking_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_tracking_options    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_tracking_roles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_sync_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xero_mirror_changes      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance can read Xero accounts" ON public.xero_accounts;
CREATE POLICY "Finance can read Xero accounts"
  ON public.xero_accounts FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.has_permission('budget.view_all')
  );

DROP POLICY IF EXISTS "Finance can read Xero tracking categories" ON public.xero_tracking_categories;
CREATE POLICY "Finance can read Xero tracking categories"
  ON public.xero_tracking_categories FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.has_permission('budget.view_all')
  );

DROP POLICY IF EXISTS "Finance can read Xero tracking options" ON public.xero_tracking_options;
CREATE POLICY "Finance can read Xero tracking options"
  ON public.xero_tracking_options FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.has_permission('budget.view_all')
  );

DROP POLICY IF EXISTS "Finance can read Xero items" ON public.xero_items;
CREATE POLICY "Finance can read Xero items"
  ON public.xero_items FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.has_permission('budget.view_all')
  );

DROP POLICY IF EXISTS "Finance can read Xero tracking roles" ON public.xero_tracking_roles;
CREATE POLICY "Finance can read Xero tracking roles"
  ON public.xero_tracking_roles FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.has_permission('budget.view_all')
  );

DROP POLICY IF EXISTS "Finance can read Xero sync runs" ON public.xero_sync_runs;
CREATE POLICY "Finance can read Xero sync runs"
  ON public.xero_sync_runs FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.has_permission('budget.view_all')
  );

DROP POLICY IF EXISTS "Finance can read Xero mirror changes" ON public.xero_mirror_changes;
CREATE POLICY "Finance can read Xero mirror changes"
  ON public.xero_mirror_changes FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.has_permission('budget.view_all')
  );


-- ────────────────────────────────────────────────────────────
-- 10. Comments
-- ────────────────────────────────────────────────────────────
COMMENT ON TABLE public.xero_accounts IS
  'Read-only mirror of the Xero chart of accounts, one row per account per organisation. Filled by the Xero sync (service role); never hard-deleted. Hub references point at id, never at the Xero id.';
COMMENT ON TABLE public.xero_tracking_categories IS
  'Read-only mirror of Xero tracking categories (e.g. "Schools"), per organisation. Filled by the Xero sync; never hard-deleted.';
COMMENT ON TABLE public.xero_tracking_options IS
  'Read-only mirror of the options inside each Xero tracking category, per organisation. Filled by the Xero sync; never hard-deleted.';
COMMENT ON TABLE public.xero_items IS
  'Read-only mirror of Xero items (product/service codes), per organisation. Filled by the Xero sync; never hard-deleted.';
COMMENT ON TABLE public.xero_tracking_roles IS
  'Which tracking category plays a given role (e.g. ''schools'') in each organisation, so the Hub never hard-codes a category name. Editable by an admin later.';
COMMENT ON TABLE public.xero_sync_runs IS
  'One row per Xero mirror sync run (cron or manual): what it covered, how it ended, and how many rows it inserted / updated / archived / left unchanged.';
COMMENT ON TABLE public.xero_mirror_changes IS
  'Append-only history of field changes the Xero sync saw on mirror rows (renames, code changes, archiving). Never updated or deleted.';

COMMENT ON COLUMN public.xero_accounts.friendly_name IS
  'Hub-owned, never overwritten by the Xero sync. Optional name finance prefers over the Xero name.';
COMMENT ON COLUMN public.xero_accounts.is_hidden IS
  'Hub-owned, never overwritten by the Xero sync. Hides the account from Hub pickers; does not affect Xero.';
COMMENT ON COLUMN public.xero_tracking_options.friendly_name IS
  'Hub-owned, never overwritten by the Xero sync. Optional name finance prefers over the Xero name.';
COMMENT ON COLUMN public.xero_tracking_options.is_hidden IS
  'Hub-owned, never overwritten by the Xero sync. Hides the option from Hub pickers; does not affect Xero.';

COMMENT ON COLUMN public.xero_tracking_options.match_key IS
  'Generated: lower(btrim(name)). Used to match option names typed elsewhere (e.g. "Gap Year 2027") regardless of case or stray spaces.';

COMMENT ON COLUMN public.xero_accounts.status IS
  'Status in Xero: active or archived. Mirrors Xero; archived rows are kept.';
COMMENT ON COLUMN public.xero_tracking_categories.status IS
  'Status in Xero: active or archived. Mirrors Xero; archived rows are kept.';
COMMENT ON COLUMN public.xero_tracking_options.status IS
  'Status in Xero: active or archived. Mirrors Xero; archived rows are kept.';
COMMENT ON COLUMN public.xero_items.status IS
  'Status in Xero: active or archived. Mirrors Xero; archived rows are kept.';

COMMENT ON COLUMN public.xero_accounts.missing_since IS
  'When Xero stopped returning this row (deleted in Xero, or the organisation changed). NULL while Xero still returns it. The row is kept.';
COMMENT ON COLUMN public.xero_tracking_categories.missing_since IS
  'When Xero stopped returning this row (deleted in Xero, or the organisation changed). NULL while Xero still returns it. The row is kept.';
COMMENT ON COLUMN public.xero_tracking_options.missing_since IS
  'When Xero stopped returning this row (deleted in Xero, or the organisation changed). NULL while Xero still returns it. The row is kept.';
COMMENT ON COLUMN public.xero_items.missing_since IS
  'When Xero stopped returning this row (deleted in Xero, or the organisation changed). NULL while Xero still returns it. The row is kept.';

COMMENT ON COLUMN public.xero_accounts.synced_at IS
  'Last time a sync saw this row in Xero, whether or not anything changed.';
COMMENT ON COLUMN public.xero_tracking_categories.synced_at IS
  'Last time a sync saw this row in Xero, whether or not anything changed.';
COMMENT ON COLUMN public.xero_tracking_options.synced_at IS
  'Last time a sync saw this row in Xero, whether or not anything changed.';
COMMENT ON COLUMN public.xero_items.synced_at IS
  'Last time a sync saw this row in Xero, whether or not anything changed.';

COMMENT ON COLUMN public.xero_accounts.raw IS
  'The Xero payload for this row as last received. For debugging only; do not build features on it.';
COMMENT ON COLUMN public.xero_tracking_categories.raw IS
  'The Xero payload for this row as last received. For debugging only; do not build features on it.';
COMMENT ON COLUMN public.xero_tracking_options.raw IS
  'The Xero payload for this row as last received. For debugging only; do not build features on it.';
COMMENT ON COLUMN public.xero_items.raw IS
  'The Xero payload for this row as last received. For debugging only; do not build features on it.';

COMMENT ON COLUMN public.xero_tracking_roles.category_name IS
  'The category name to look for in this organisation (seeded "Schools"). Used to find the category until category_id is linked.';
COMMENT ON COLUMN public.xero_tracking_roles.category_id IS
  'The mirrored category playing this role. NULL until the first sync links it by category_name (the mirror is empty when this migration runs).';
COMMENT ON COLUMN public.xero_mirror_changes.entity_id IS
  'Hub id of the changed mirror row, in the table named by entity. No foreign key because it spans four tables.';


-- ============================================================
-- Verify:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name LIKE 'xero\_%'
--   ORDER BY 1;                                   -- the seven tables + xero_tokens
--
--   SELECT * FROM public.xero_tracking_roles;     -- schools/za and schools/us, category_id NULL
--
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('xero_accounts','xero_tracking_categories','xero_tracking_options',
--                     'xero_items','xero_tracking_roles','xero_sync_runs','xero_mirror_changes');
--                                                  -- all true
--
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename LIKE 'xero\_%' AND tablename <> 'xero_tokens';
--                                                  -- seven rows, all SELECT
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK:
--   WARNING: deletes all mirrored data. The mirror itself can be rebuilt
--   by running the sync again, but the Hub-owned friendly_name / is_hidden
--   values, the sync-run log, the change history and any edit to
--   xero_tracking_roles are lost for good.
--
--   DROP TABLE IF EXISTS public.xero_mirror_changes CASCADE;
--   DROP TABLE IF EXISTS public.xero_sync_runs CASCADE;
--   DROP TABLE IF EXISTS public.xero_tracking_roles CASCADE;
--   DROP TABLE IF EXISTS public.xero_tracking_options CASCADE;
--   DROP TABLE IF EXISTS public.xero_tracking_categories CASCADE;
--   DROP TABLE IF EXISTS public.xero_items CASCADE;
--   DROP TABLE IF EXISTS public.xero_accounts CASCADE;
-- ------------------------------------------------------------
