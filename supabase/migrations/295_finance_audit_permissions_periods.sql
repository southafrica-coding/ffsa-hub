-- DRAFT ONLY. DO NOT APPLY to production.
-- Replaces the unapplied #475 file 277_finance_audit_permissions_periods.sql.
-- Depends on main's already-applied 275 (Xero code mirror), 290 (finance_orgs
-- and projects) and 291 (Xero sync). Do not reapply those. Do not invent a 276.
-- Numbered 295: 293 and 294 are reserved by sibling draft PRs. Once-only;
-- not safe to re-run, and there is no destructive rollback.
-- finance_private must NOT be added to the exposed API schemas.

CREATE SCHEMA IF NOT EXISTS finance_private;
REVOKE ALL ON SCHEMA finance_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA finance_private TO authenticated, service_role;


INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('finance', 'budget.view_all',     'See every budget',                   70),
  ('finance', 'budget.edit_all',     'Edit any budget',                    80),
  ('finance', 'budget.manage_codes', 'Manage budget categories and Xero coding', 90),
  ('finance', 'budget.approve',      'Approve budgets',                    100)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p
    ON p.key IN ('budget.view_all', 'budget.edit_all', 'budget.manage_codes')
 WHERE r.name = 'finance_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  JOIN public.permissions p ON p.key = 'budget.view_all'
 WHERE r.name = 'finance_office'
ON CONFLICT (role_id, permission_id) DO NOTHING;

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


CREATE OR REPLACE FUNCTION finance_private.can_edit_all_budgets()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_admin()
      OR public.has_permission('budget.edit_all');
$$;

CREATE OR REPLACE FUNCTION finance_private.can_view_all_budgets()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT finance_private.can_edit_all_budgets()
      OR public.has_permission('finance.view')
      OR public.has_permission('budget.view_all')
      OR public.has_permission('budget.approve');
$$;

CREATE OR REPLACE FUNCTION finance_private.can_manage_budget_codes()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_admin()
      OR public.has_permission('budget.manage_codes');
$$;

CREATE OR REPLACE FUNCTION finance_private.can_approve_budgets()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.has_permission('budget.approve');
$$;


CREATE TABLE IF NOT EXISTS public.fiscal_periods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.finance_orgs(id) ON DELETE RESTRICT,
  label        text NOT NULL CHECK (btrim(label) <> ''),
  kind         text NOT NULL CHECK (kind IN ('year', 'term', 'event')),
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  is_current   boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  CONSTRAINT fiscal_periods_dates_check CHECK (end_date >= start_date),
  CONSTRAINT fiscal_periods_id_org_key UNIQUE (id, org_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_periods_kind_label_key
  ON public.fiscal_periods (org_id, kind, lower(btrim(label)))
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_periods_one_current_per_kind
  ON public.fiscal_periods (org_id, kind)
  WHERE is_current AND archived_at IS NULL;


CREATE TABLE IF NOT EXISTS public.finance_audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
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

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.finance_audit_log FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION finance_private.finance_audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'finance_audit_log is append-only (% refused)', TG_OP USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_finance_audit_log_no_change ON public.finance_audit_log;
CREATE TRIGGER trg_finance_audit_log_no_change
  BEFORE UPDATE OR DELETE ON public.finance_audit_log
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_log_immutable();

DROP TRIGGER IF EXISTS trg_finance_audit_log_no_truncate ON public.finance_audit_log;
CREATE TRIGGER trg_finance_audit_log_no_truncate
  BEFORE TRUNCATE ON public.finance_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION finance_private.finance_audit_log_immutable();

CREATE OR REPLACE FUNCTION finance_private.finance_audit_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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

CREATE OR REPLACE FUNCTION finance_private.finance_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_fiscal_periods_touch ON public.fiscal_periods;
CREATE TRIGGER trg_fiscal_periods_touch
  BEFORE UPDATE ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_touch_updated_at();

DROP TRIGGER IF EXISTS trg_fiscal_periods_audit ON public.fiscal_periods;
CREATE TRIGGER trg_fiscal_periods_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_xero_accounts_hub_audit ON public.xero_accounts;
CREATE TRIGGER trg_xero_accounts_hub_audit
  AFTER UPDATE OF friendly_name, is_hidden ON public.xero_accounts
  FOR EACH ROW
  WHEN (OLD.friendly_name IS DISTINCT FROM NEW.friendly_name
        OR OLD.is_hidden IS DISTINCT FROM NEW.is_hidden)
  EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_xero_tracking_options_hub_audit ON public.xero_tracking_options;
CREATE TRIGGER trg_xero_tracking_options_hub_audit
  AFTER UPDATE OF friendly_name, is_hidden ON public.xero_tracking_options
  FOR EACH ROW
  WHEN (OLD.friendly_name IS DISTINCT FROM NEW.friendly_name
        OR OLD.is_hidden IS DISTINCT FROM NEW.is_hidden)
  EXECUTE FUNCTION finance_private.finance_audit_row();


ALTER TABLE public.fiscal_periods    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users read fiscal periods" ON public.fiscal_periods;
CREATE POLICY "Signed-in users read fiscal periods"
  ON public.fiscal_periods FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Finance adds fiscal periods" ON public.fiscal_periods;
CREATE POLICY "Finance adds fiscal periods"
  ON public.fiscal_periods FOR INSERT
  WITH CHECK (finance_private.can_edit_all_budgets());

DROP POLICY IF EXISTS "Finance edits fiscal periods" ON public.fiscal_periods;
CREATE POLICY "Finance edits fiscal periods"
  ON public.fiscal_periods FOR UPDATE
  USING (finance_private.can_edit_all_budgets())
  WITH CHECK (finance_private.can_edit_all_budgets());

DROP POLICY IF EXISTS "Finance reads the audit log" ON public.finance_audit_log;
CREATE POLICY "Finance reads the audit log"
  ON public.finance_audit_log FOR SELECT
  USING (finance_private.can_view_all_budgets());


COMMENT ON FUNCTION finance_private.can_view_all_budgets() IS
  'True for anyone who sees every budget: admin, finance.view, budget.view_all (Finance Admin and Finance Office bundles), budget.approve, or anyone who can edit all budgets. Permissions only, never the finance_admin role itself. Independent of the outreach-only restriction in migration 274.';
COMMENT ON FUNCTION finance_private.can_edit_all_budgets() IS
  'True for anyone who may change any budget, its lines and members: admin or budget.edit_all (in the Finance Admin bundle). Does not test the finance_admin role itself.';
COMMENT ON FUNCTION finance_private.can_manage_budget_codes() IS
  'True for anyone who may manage friendly budget categories and Xero coding on budget lines: admin or budget.manage_codes (in the Finance Admin bundle). Does not test the finance_admin role itself.';
COMMENT ON FUNCTION finance_private.can_approve_budgets() IS
  'True ONLY for holders of budget.approve (the Budget Approver role). Admins and finance_admin are deliberately not included: only Coreen approves.';
COMMENT ON FUNCTION finance_private.finance_audit_row() IS
  'Generic audit trigger: writes one finance_audit_log row per inserted, updated, archived or deleted row (no row when nothing changed). Strips the Xero raw payload.';

COMMENT ON TABLE public.fiscal_periods IS
  'Periods budgets are planned for (a year, a term or an event). Budgets point at one; reports group by it. Archived, never deleted.';
COMMENT ON COLUMN public.fiscal_periods.label IS
  'What people see, e.g. "2027" or "Term 1 2027". Unique per organisation and kind among live periods.';
COMMENT ON COLUMN public.fiscal_periods.kind IS
  'year, term or event.';
COMMENT ON COLUMN public.fiscal_periods.is_current IS
  'The default period for new budgets. At most one live current period per organisation and kind.';
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




CREATE INDEX fiscal_periods_org_idx ON public.fiscal_periods(org_id);
-- Changing a used period's dates/org changes the meaning of approved budgets. Make identity immutable.
CREATE FUNCTION finance_private.budget_period_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF ROW(NEW.org_id,NEW.start_date,NEW.end_date,NEW.kind) IS DISTINCT FROM
    ROW(OLD.org_id,OLD.start_date,OLD.end_date,OLD.kind) THEN
  RAISE EXCEPTION 'Period org, dates and kind are immutable; create another period' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fiscal_period_identity_guard BEFORE UPDATE ON public.fiscal_periods
FOR EACH ROW EXECUTE FUNCTION finance_private.budget_period_identity_guard();
