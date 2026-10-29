-- ============================================================
-- FFSA Hub — Migration 277: finance audit log, budget permissions,
--                           fiscal periods (finance PR-2, part 1 of 3)
-- ============================================================
-- APPLY ORDER: 275_xero_code_mirror.sql FIRST (PR #474), then 277, 278,
-- 279. This file attaches audit triggers to two of 275's tables
-- (xero_accounts, xero_tracking_options), so it fails if 275 is missing.
-- (276 is reserved for PR #441; 277 does not depend on it.)
--
-- The groundwork the budget tables (278) stand on:
--
--   1. Four permission keys for finance, in the 'finance' module (so they
--      also open the Finance menu, like finance.donor_statements in 245):
--        budget.view_all      — see every budget
--        budget.edit_all      — change any budget, its lines and members
--        budget.manage_codes  — friendly categories and Xero coding
--        budget.approve       — approve a submitted budget
--      The first three are added to the Finance Admin role's bundle
--      (role_permissions, pattern from 183/248).
--      budget.approve is NOT: only Coreen approves. It is held by exactly
--      one new role, budget_approver ("Budget Approver", pattern from 248),
--      and approval checks has_permission('budget.approve') ONLY — not
--      is_admin(), not finance_admin. NO role or permission is assigned to
--      any person here; Jack gives Coreen the role by hand (see the PR).
--
--   2. Four SQL helpers the policies use: can_view_all_budgets(),
--      can_edit_all_budgets(), can_manage_budget_codes(),
--      can_approve_budgets(). SECURITY DEFINER, like
--      can_manage_donor_statements() in 245.
--      can_view_all_budgets() includes finance.view on purpose: finance
--      sees every budget, independent of the outreach-only "own teams"
--      flag from 274. It also includes budget.approve: the approver must
--      be able to read what she approves.
--
--   3. fiscal_periods — the period a budget covers ('2027', a term, an
--      event). NO periods are seeded: the SA and US year-end dates are
--      Coreen's call. Finance adds a period before the first budget.
--
--   4. finance_audit_log — append-only history of every change to budget
--      data, written by ONE generic trigger, finance_audit_row(). Nobody
--      can update or delete a row: UPDATE/DELETE/TRUNCATE are revoked
--      and a guard trigger refuses them even for the table owner.
--      Finance can read it; no one can write it directly.
--      Audited here: fiscal_periods, and the two Hub-owned columns
--      (friendly_name, is_hidden) on xero_accounts / xero_tracking_options
--      — only when one of those changes, so the nightly sync adds no noise.
--      278 attaches the same trigger to every budget table.
--
-- Only adds new objects; no existing table, row, role grant or policy is
-- changed. The Hub never writes to Xero.
--
-- Safe to re-run: tables and indexes are IF NOT EXISTS, functions are
-- CREATE OR REPLACE, triggers and policies are dropped by name before
-- they are created, seed rows are ON CONFLICT DO NOTHING.
--
-- ROLLBACK (summary): drop the triggers, the two tables, the helper
-- functions, the role_permissions rows, the four permission keys and the
-- budget_approver role (which also removes it from whoever holds it).
-- Full block at the end of this file. Roll back 279 and 278 first.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Permission keys + the Finance Admin bundle
-- ────────────────────────────────────────────────────────────
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('finance', 'budget.view_all',     'See every budget',                   70),
  ('finance', 'budget.edit_all',     'Edit any budget',                    80),
  ('finance', 'budget.manage_codes', 'Manage budget categories and Xero coding', 90),
  ('finance', 'budget.approve',      'Approve budgets',                    100)
ON CONFLICT (key) DO NOTHING;

-- Finance Admin: see, edit and code every budget — but NOT approve.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p
    ON p.key IN ('budget.view_all', 'budget.edit_all', 'budget.manage_codes')
 WHERE r.name = 'finance_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Budget Approver: the only holder of budget.approve. Assigned to Coreen by
-- hand, never by a migration. is_system = false so it shows on the Roles page.
INSERT INTO public.roles (name, display_name, description, is_system)
VALUES (
  'budget_approver',
  'Budget Approver',
  'Approves submitted budgets (and can reopen an approved one). The only role that holds budget.approve. Finance Admin can see, edit and code budgets but cannot approve them.',
  false
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p ON p.key = 'budget.approve'
 WHERE r.name = 'budget_approver'
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 2. Access helpers
-- ────────────────────────────────────────────────────────────
-- has_role('finance_admin') is listed as well as the bundle, matching every
-- other finance policy (236, 245, 275).
CREATE OR REPLACE FUNCTION public.can_edit_all_budgets()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR public.has_role('finance_admin')
      OR public.has_permission('budget.edit_all');
$$;

CREATE OR REPLACE FUNCTION public.can_view_all_budgets()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_edit_all_budgets()
      OR public.has_permission('finance.view')
      OR public.has_permission('budget.view_all')
      OR public.has_permission('budget.approve');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_budget_codes()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
      OR public.has_role('finance_admin')
      OR public.has_permission('budget.manage_codes');
$$;

-- Deliberately ONLY the permission: no is_admin(), no finance_admin.
CREATE OR REPLACE FUNCTION public.can_approve_budgets()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_permission('budget.approve');
$$;


-- ────────────────────────────────────────────────────────────
-- 3. Fiscal periods
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fiscal_periods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label        text NOT NULL CHECK (btrim(label) <> ''),
  kind         text NOT NULL CHECK (kind IN ('year', 'term', 'event')),
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  is_current   boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  CONSTRAINT fiscal_periods_dates_check CHECK (end_date >= start_date)
);

-- One live period per (kind, label); at most one current period per kind.
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_periods_kind_label_key
  ON public.fiscal_periods (kind, lower(btrim(label)))
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_periods_one_current_per_kind
  ON public.fiscal_periods (kind)
  WHERE is_current AND archived_at IS NULL;


-- ────────────────────────────────────────────────────────────
-- 4. Audit log (append-only)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  -- No foreign keys on purpose: a history row must survive anything.
  actor_user_id  uuid,
  actor_kind     text NOT NULL CHECK (actor_kind IN ('user', 'system', 'xero_sync', 'ai')),
  action         text NOT NULL
                 CHECK (action IN ('insert', 'update', 'delete', 'archive', 'create_from_template', 'copy_to_period')),
  entity_type    text NOT NULL,           -- the table name, e.g. 'budget_lines'
  entity_id      uuid,
  budget_id      uuid,
  before         jsonb,
  after          jsonb
);

CREATE INDEX IF NOT EXISTS idx_finance_audit_log_entity
  ON public.finance_audit_log (entity_type, entity_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_audit_log_budget
  ON public.finance_audit_log (budget_id, at DESC)
  WHERE budget_id IS NOT NULL;

-- Nobody changes history: not the app, not the service role, not the owner.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.finance_audit_log FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finance_audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'finance_audit_log is append-only (% refused)', TG_OP USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_finance_audit_log_no_change ON public.finance_audit_log;
CREATE TRIGGER trg_finance_audit_log_no_change
  BEFORE UPDATE OR DELETE ON public.finance_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_log_immutable();

DROP TRIGGER IF EXISTS trg_finance_audit_log_no_truncate ON public.finance_audit_log;
CREATE TRIGGER trg_finance_audit_log_no_truncate
  BEFORE TRUNCATE ON public.finance_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.finance_audit_log_immutable();

-- The one generic writer. Attach AFTER INSERT OR UPDATE OR DELETE ... FOR
-- EACH ROW to any table with a uuid "id". SECURITY DEFINER so it can write
-- the log, which nobody else can. The bulky Xero "raw" payload is dropped.
CREATE OR REPLACE FUNCTION public.finance_audit_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old     jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'raw' END;
  v_new     jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'raw' END;
  v_row     jsonb := coalesce(v_new, v_old);
  v_action  text  := lower(TG_OP);
  v_budget  uuid;
  v_actor   uuid  := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' AND v_old - 'updated_at' = v_new - 'updated_at' THEN
    RETURN NULL;                                    -- nothing but updated_at changed
  END IF;

  IF TG_OP = 'UPDATE' AND v_old ? 'archived_at'
     AND v_old->>'archived_at' IS NULL AND v_new->>'archived_at' IS NOT NULL THEN
    v_action := 'archive';
  ELSIF TG_OP = 'INSERT' AND TG_TABLE_NAME = 'budgets' THEN
    -- A direct copy has a source budget and no source template.
    v_action := CASE WHEN v_new->>'source_budget_id' IS NOT NULL AND v_new->>'source_template_id' IS NULL
                     THEN 'copy_to_period' ELSE 'create_from_template' END;
  END IF;

  IF TG_TABLE_NAME = 'budgets' THEN
    v_budget := (v_row->>'id')::uuid;
  ELSIF v_row ? 'budget_id' THEN
    v_budget := (v_row->>'budget_id')::uuid;
  ELSIF TG_TABLE_NAME = 'budget_line_coding' THEN
    SELECT l.budget_id INTO v_budget FROM public.budget_lines l WHERE l.id = (v_row->>'line_id')::uuid;
  END IF;

  INSERT INTO public.finance_audit_log
    (actor_user_id, actor_kind, action, entity_type, entity_id, budget_id, before, after)
  VALUES
    (v_actor, CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END,
     v_action, TG_TABLE_NAME, (v_row->>'id')::uuid, v_budget, v_old, v_new);

  RETURN NULL;
END;
$$;

-- Keeps updated_at honest on the new finance tables (here and in 278).
CREATE OR REPLACE FUNCTION public.finance_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 5. Triggers
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_fiscal_periods_touch ON public.fiscal_periods;
CREATE TRIGGER trg_fiscal_periods_touch
  BEFORE UPDATE ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();

DROP TRIGGER IF EXISTS trg_fiscal_periods_audit ON public.fiscal_periods;
CREATE TRIGGER trg_fiscal_periods_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_row();

-- Mirror tables (275): only the Hub-owned columns are audited.
DROP TRIGGER IF EXISTS trg_xero_accounts_hub_audit ON public.xero_accounts;
CREATE TRIGGER trg_xero_accounts_hub_audit
  AFTER UPDATE OF friendly_name, is_hidden ON public.xero_accounts
  FOR EACH ROW
  WHEN (OLD.friendly_name IS DISTINCT FROM NEW.friendly_name
        OR OLD.is_hidden IS DISTINCT FROM NEW.is_hidden)
  EXECUTE FUNCTION public.finance_audit_row();

DROP TRIGGER IF EXISTS trg_xero_tracking_options_hub_audit ON public.xero_tracking_options;
CREATE TRIGGER trg_xero_tracking_options_hub_audit
  AFTER UPDATE OF friendly_name, is_hidden ON public.xero_tracking_options
  FOR EACH ROW
  WHEN (OLD.friendly_name IS DISTINCT FROM NEW.friendly_name
        OR OLD.is_hidden IS DISTINCT FROM NEW.is_hidden)
  EXECUTE FUNCTION public.finance_audit_row();


-- ────────────────────────────────────────────────────────────
-- 6. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.fiscal_periods    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_audit_log ENABLE ROW LEVEL SECURITY;

-- Periods are labels like "2027": any signed-in user may read them, so a
-- budget member can see which period their budget covers.
DROP POLICY IF EXISTS "Signed-in users read fiscal periods" ON public.fiscal_periods;
CREATE POLICY "Signed-in users read fiscal periods"
  ON public.fiscal_periods FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Finance adds fiscal periods" ON public.fiscal_periods;
CREATE POLICY "Finance adds fiscal periods"
  ON public.fiscal_periods FOR INSERT
  WITH CHECK (public.can_edit_all_budgets());

DROP POLICY IF EXISTS "Finance edits fiscal periods" ON public.fiscal_periods;
CREATE POLICY "Finance edits fiscal periods"
  ON public.fiscal_periods FOR UPDATE
  USING (public.can_edit_all_budgets())
  WITH CHECK (public.can_edit_all_budgets());
-- No DELETE policy: periods are archived (archived_at), never deleted.

DROP POLICY IF EXISTS "Finance reads the audit log" ON public.finance_audit_log;
CREATE POLICY "Finance reads the audit log"
  ON public.finance_audit_log FOR SELECT
  USING (public.can_view_all_budgets());
-- No write policies: only finance_audit_row() (SECURITY DEFINER) writes.


-- ────────────────────────────────────────────────────────────
-- 7. Comments
-- ────────────────────────────────────────────────────────────
COMMENT ON FUNCTION public.can_view_all_budgets() IS
  'True for anyone who sees every budget: admin, finance_admin, finance.view, budget.view_all, budget.approve, or anyone who can edit all budgets. Independent of the outreach-only restriction in migration 274.';
COMMENT ON FUNCTION public.can_edit_all_budgets() IS
  'True for anyone who may change any budget, its lines and members: admin, finance_admin or budget.edit_all.';
COMMENT ON FUNCTION public.can_manage_budget_codes() IS
  'True for anyone who may manage friendly budget categories and Xero coding on budget lines: admin, finance_admin or budget.manage_codes.';
COMMENT ON FUNCTION public.can_approve_budgets() IS
  'True ONLY for holders of budget.approve (the Budget Approver role). Admins and finance_admin are deliberately not included: only Coreen approves.';
COMMENT ON FUNCTION public.finance_audit_row() IS
  'Generic audit trigger: writes one finance_audit_log row per inserted, updated, archived or deleted row (no row when nothing changed). Strips the Xero raw payload.';

COMMENT ON TABLE public.fiscal_periods IS
  'Periods budgets are planned for (a year, a term or an event). Budgets point at one; reports group by it. Archived, never deleted.';
COMMENT ON COLUMN public.fiscal_periods.label IS
  'What people see, e.g. "2027" or "Term 1 2027". Unique per kind among live periods.';
COMMENT ON COLUMN public.fiscal_periods.kind IS
  'year, term or event.';
COMMENT ON COLUMN public.fiscal_periods.is_current IS
  'The default period for new budgets. At most one live current period per kind.';
COMMENT ON COLUMN public.fiscal_periods.archived_at IS
  'Set instead of deleting. Archived periods drop out of pickers but budgets keep pointing at them.';

COMMENT ON TABLE public.finance_audit_log IS
  'Append-only history of every change to budget data (and to Hub-owned columns on the Xero mirror). Written only by the finance_audit_row() trigger. Rows can never be updated or deleted. Finance reads it; excluded from AI views.';
COMMENT ON COLUMN public.finance_audit_log.actor_user_id IS
  'auth.uid() of the person who made the change. NULL for system work (service role, SQL editor). No foreign key so history survives anything.';
COMMENT ON COLUMN public.finance_audit_log.actor_kind IS
  'user when a signed-in person made the change, system otherwise. xero_sync and ai are reserved for later phases.';
COMMENT ON COLUMN public.finance_audit_log.action IS
  'insert, update, delete, archive (archived_at was set), create_from_template (a budget created from a template) or copy_to_period (a budget copied from an earlier one).';
COMMENT ON COLUMN public.finance_audit_log.entity_type IS
  'Name of the table the changed row lives in, e.g. budget_lines.';
COMMENT ON COLUMN public.finance_audit_log.entity_id IS
  'id of the changed row in entity_type.';
COMMENT ON COLUMN public.finance_audit_log.budget_id IS
  'The budget the change belongs to, when there is one, so a budget''s whole history is one query.';
COMMENT ON COLUMN public.finance_audit_log.before IS
  'The row before the change (NULL on insert).';
COMMENT ON COLUMN public.finance_audit_log.after IS
  'The row after the change (NULL on delete).';


-- ============================================================
-- Verify:
--   SELECT key, module FROM public.permissions WHERE key LIKE 'budget.%' ORDER BY sort_order;
--                                                  -- four rows, module 'finance'
--   SELECT r.name, p.key FROM public.role_permissions rp
--     JOIN public.roles r ON r.id = rp.role_id
--     JOIN public.permissions p ON p.id = rp.permission_id
--    WHERE p.key LIKE 'budget.%' ORDER BY 1, 2;   -- budget_approver x1 (approve),
--                                                  -- finance_admin x3 (no approve)
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('fiscal_periods', 'finance_audit_log');  -- both true
--   SELECT count(*) FROM public.fiscal_periods;   -- 0 (finance adds the first)
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (run 279's and 278's rollback first):
--   WARNING: deletes the audit history and every fiscal period.
--
--   DROP TRIGGER IF EXISTS trg_xero_tracking_options_hub_audit ON public.xero_tracking_options;
--   DROP TRIGGER IF EXISTS trg_xero_accounts_hub_audit ON public.xero_accounts;
--   DROP TABLE IF EXISTS public.finance_audit_log CASCADE;
--   DROP TABLE IF EXISTS public.fiscal_periods CASCADE;
--   DROP FUNCTION IF EXISTS public.finance_audit_row();
--   DROP FUNCTION IF EXISTS public.finance_audit_log_immutable();
--   DROP FUNCTION IF EXISTS public.finance_touch_updated_at();
--   DROP FUNCTION IF EXISTS public.can_approve_budgets();
--   DROP FUNCTION IF EXISTS public.can_manage_budget_codes();
--   DROP FUNCTION IF EXISTS public.can_view_all_budgets();
--   DROP FUNCTION IF EXISTS public.can_edit_all_budgets();
--   DELETE FROM public.role_permissions
--    WHERE permission_id IN (SELECT id FROM public.permissions WHERE key LIKE 'budget.%');
--   DELETE FROM public.user_permissions
--    WHERE permission_id IN (SELECT id FROM public.permissions WHERE key LIKE 'budget.%');
--   DELETE FROM public.permissions WHERE key LIKE 'budget.%';
--   DELETE FROM public.user_roles
--    WHERE role_id IN (SELECT id FROM public.roles WHERE name = 'budget_approver');
--   DELETE FROM public.roles WHERE name = 'budget_approver';
-- ------------------------------------------------------------
