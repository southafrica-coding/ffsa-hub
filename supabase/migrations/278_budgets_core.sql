-- ============================================================
-- FFSA Hub — Migration 278: budgets + the empty team-budget template
--                           (finance PR-2, part 2 of 3)
-- ============================================================
-- APPLY ORDER: 275 (PR #474), then 277, then this file, then 279.
-- Needs 275's xero_accounts / xero_tracking_options (line coding points at
-- them) and 277's helpers, fiscal_periods and finance_audit_row().
--
-- What a budget is, in plain words:
--
--   * A budget belongs to ONE owner: a staff ministry, a ministry
--     sub-category, a school (program) or an event. Team budgets such as
--     "Sound – Upstairs" sit under the Prayer & Worship staff ministry for
--     now (owner_kind = 'staff_ministry'). 'outreach_team' is reserved but
--     not offered yet — outreach keeps its own budget lines (236).
--     A ministry can hold several budgets in one period as long as their
--     names differ ("Sound – Upstairs", "Sound – Downstairs").
--   * It is created from a TEMPLATE by create_budget_from_template(). The
--     template has sections but NO lines, so a new budget starts EMPTY.
--     The standard template's sections follow the old "Sound – Upstairs"
--     sheet: Overview, Dashboard, Variable cost, Fixed cost, Expense
--     tracker, Notes. Only Fixed and Variable hold lines. No data from the
--     sheet is imported.
--   * A line is amount × frequency × multiplier, in CENTS. The total is
--     always computed by a trigger, never taken from the client:
--       line_total_cents = round(amount_cents × frequency × multiplier)
--     A line with uses_driver follows the budget's driver (e.g. 8
--     volunteers): change the driver and those lines move.
--     Fixed lines have frequency 1; their multiplier is the quantity.
--   * Every line carries Xero coding per organisation (za / us): an
--     account and up to two tracking options, pointing at the 275 mirror
--     by uuid. The coding is COPIED from the line's friendly category when
--     the line is created. Only finance (budget.manage_codes) changes it
--     after that. A line in "Not sure yet", or whose category has no
--     account yet, is needs_coding and lands in finance's queue.
--     No Xero codes are invented: the only seeded category is
--     "Not sure yet", with no coding at all.
--   * Nothing is hard-deleted. Budgets and lines are archived
--     (archived_at). Every change is written to finance_audit_log (277).
--
-- Who sees what (RLS):
--   * Finance — can_view_all_budgets() — sees every budget.
--     can_edit_all_budgets() changes any of them.
--   * budget_members: owner / editor / viewer of ONE budget see that
--     budget. Editors and owners change its lines while it is a draft;
--     owners also change its header, submit it, archive it and manage its
--     members. Whoever creates a budget becomes its owner.
--   * Creating a budget: finance (any owner) or a leader of the staff
--     ministry it is for (leads_staff_ministry, 126; for a sub-category,
--     a leader of its parent ministry). School and event budgets are
--     finance-only until their leader tables are checked.
--   * Only budget.approve (or finance_admin / admin) can approve.
--   * Coding tables are readable by finance only; members see a line's
--     coding_status, never the account codes.
--
-- The Hub never writes to Xero. No sync, actuals or receipts here.
--
-- Only adds new objects; no existing table or row is touched.
--
-- Safe to re-run: tables and indexes are IF NOT EXISTS, functions are
-- CREATE OR REPLACE, triggers and policies are dropped by name before they
-- are created, seed rows are ON CONFLICT DO NOTHING (finance's later edits
-- to the seeded category or template are never overwritten).
--
-- ROLLBACK (summary): drop the nine tables and the functions this file
-- adds. Full block at the end. Roll back 279 first.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Friendly categories (what volunteers pick) + their default coding
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budget_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable handle for code, e.g. 'not_sure_yet'. Optional for categories
  -- finance adds later.
  key          text UNIQUE,
  name         text NOT NULL CHECK (btrim(name) <> ''),
  group_name   text,
  icon         text,
  sort         integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  help_text    text,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS budget_categories_live_name_key
  ON public.budget_categories (lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.budget_category_coding (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id           uuid NOT NULL REFERENCES public.budget_categories(id) ON DELETE RESTRICT,
  org_region            text NOT NULL CHECK (org_region IN ('za', 'us')),
  account_id            uuid REFERENCES public.xero_accounts(id) ON DELETE RESTRICT,
  tracking_option_1_id  uuid REFERENCES public.xero_tracking_options(id) ON DELETE RESTRICT,
  tracking_option_2_id  uuid REFERENCES public.xero_tracking_options(id) ON DELETE RESTRICT,
  updated_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_category_coding_category_org_key UNIQUE (category_id, org_region),
  CONSTRAINT budget_category_coding_tracking_order_check
    CHECK (tracking_option_2_id IS NULL OR tracking_option_1_id IS NOT NULL),
  CONSTRAINT budget_category_coding_tracking_distinct_check
    CHECK (tracking_option_2_id IS NULL OR tracking_option_2_id <> tracking_option_1_id)
);


-- ────────────────────────────────────────────────────────────
-- 2. Templates (sections only — a template never has lines)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budget_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key               text UNIQUE NOT NULL,
  name              text NOT NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_active         boolean NOT NULL DEFAULT true,
  applies_to        text[] NOT NULL DEFAULT ARRAY['staff_ministry', 'ministry_subcategory', 'program', 'event'],
  default_currency  text NOT NULL DEFAULT 'ZAR' CHECK (default_currency IN ('ZAR', 'USD')),
  funding_fields    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_templates_applies_to_check
    CHECK (applies_to <@ ARRAY['staff_ministry', 'ministry_subcategory', 'program', 'event', 'outreach_team'])
);

CREATE TABLE IF NOT EXISTS public.budget_template_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES public.budget_templates(id) ON DELETE RESTRICT,
  key          text NOT NULL
               CHECK (key IN ('overview', 'dashboard', 'variable', 'fixed', 'expense_tracker', 'notes')),
  label        text NOT NULL,
  help_text    text,
  sort         integer NOT NULL DEFAULT 0,
  holds_lines  boolean GENERATED ALWAYS AS (key IN ('fixed', 'variable')) STORED,
  CONSTRAINT budget_template_sections_template_key UNIQUE (template_id, key)
);


-- ────────────────────────────────────────────────────────────
-- 3. Budgets
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budgets (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL CHECK (btrim(name) <> ''),
  template_id             uuid NOT NULL REFERENCES public.budget_templates(id) ON DELETE RESTRICT,
  template_version        integer NOT NULL,
  period_id               uuid NOT NULL REFERENCES public.fiscal_periods(id) ON DELETE RESTRICT,
  currency                text NOT NULL DEFAULT 'ZAR' CHECK (currency IN ('ZAR', 'USD')),
  -- Owner: exactly one typed foreign key, the one owner_kind names.
  owner_kind              text NOT NULL
                          CHECK (owner_kind IN ('staff_ministry', 'ministry_subcategory', 'program', 'event', 'outreach_team')),
  staff_ministry_id       uuid REFERENCES public.staff_ministries(id) ON DELETE RESTRICT,
  subcategory_id          uuid REFERENCES public.staff_ministry_subcategories(id) ON DELETE RESTRICT,
  program_id              uuid REFERENCES public.programs(id) ON DELETE RESTRICT,
  event_id                uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  outreach_team_id        uuid REFERENCES public.outreach_teams(id) ON DELETE RESTRICT,
  status                  text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'submitted', 'approved', 'archived')),
  -- What the multiplier follows on uses_driver lines, e.g. "volunteers" = 8.
  driver_label            text,
  driver_value            numeric(10,2) CHECK (driver_value >= 0),
  -- The funding rows from the old sheet. Optional.
  funding_goal_cents      bigint CHECK (funding_goal_cents >= 0),
  funds_in_hand_cents     bigint CHECK (funds_in_hand_cents >= 0),
  income_goal_cents       bigint CHECK (income_goal_cents >= 0),
  fundraising_goal_cents  bigint CHECK (fundraising_goal_cents >= 0),
  notes                   text,
  approved_by             uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  created_by              uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  archived_at             timestamptz,
  CONSTRAINT budgets_one_owner_check CHECK (
    num_nonnulls(staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id) = 1
  ),
  CONSTRAINT budgets_owner_matches_kind_check CHECK (
    CASE owner_kind
      WHEN 'staff_ministry'       THEN staff_ministry_id IS NOT NULL
      WHEN 'ministry_subcategory' THEN subcategory_id IS NOT NULL
      WHEN 'program'              THEN program_id IS NOT NULL
      WHEN 'event'                THEN event_id IS NOT NULL
      WHEN 'outreach_team'        THEN outreach_team_id IS NOT NULL
    END
  )
);

-- One live budget per owner, period and name.
CREATE UNIQUE INDEX IF NOT EXISTS budgets_live_owner_period_name_key
  ON public.budgets (
    owner_kind,
    coalesce(staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id),
    period_id,
    lower(btrim(name))
  )
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_budgets_staff_ministry ON public.budgets (staff_ministry_id) WHERE staff_ministry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_subcategory    ON public.budgets (subcategory_id)    WHERE subcategory_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_program        ON public.budgets (program_id)        WHERE program_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_event          ON public.budgets (event_id)          WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_period         ON public.budgets (period_id);


-- ────────────────────────────────────────────────────────────
-- 4. Sections (copied from the template), members, lines, line coding
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budget_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id    uuid NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  key          text NOT NULL
               CHECK (key IN ('overview', 'dashboard', 'variable', 'fixed', 'expense_tracker', 'notes')),
  label        text NOT NULL,
  sort         integer NOT NULL DEFAULT 0,
  holds_lines  boolean GENERATED ALWAYS AS (key IN ('fixed', 'variable')) STORED,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_sections_budget_key UNIQUE (budget_id, key),
  -- Target of the lines' composite foreign key below.
  CONSTRAINT budget_sections_id_budget_key_key UNIQUE (id, budget_id, key)
);

CREATE TABLE IF NOT EXISTS public.budget_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   uuid NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  added_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_members_budget_user_key UNIQUE (budget_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_members_user ON public.budget_members (user_id);

CREATE TABLE IF NOT EXISTS public.budget_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id         uuid NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  section_id        uuid NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('fixed', 'variable')),
  name              text NOT NULL CHECK (btrim(name) <> ''),
  -- NULL on insert means "Not sure yet" (filled by the trigger).
  category_id       uuid NOT NULL REFERENCES public.budget_categories(id) ON DELETE RESTRICT,
  amount_cents      bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  -- A bare number, as in outreach (236): "12" times, no unit.
  frequency         numeric(10,2) NOT NULL DEFAULT 1 CHECK (frequency >= 0),
  multiplier        numeric(10,2) NOT NULL DEFAULT 1 CHECK (multiplier >= 0),
  uses_driver       boolean NOT NULL DEFAULT false,
  -- round(amount_cents × frequency × multiplier). Trigger-computed only.
  line_total_cents  bigint NOT NULL DEFAULT 0,
  sort              integer NOT NULL DEFAULT 0,
  notes             text,
  coding_status     text NOT NULL DEFAULT 'needs_coding'
                    CHECK (coding_status IN ('inherited', 'overridden', 'needs_coding')),
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz,
  -- The section must belong to the same budget and match the line's kind.
  CONSTRAINT budget_lines_section_fkey FOREIGN KEY (section_id, budget_id, kind)
    REFERENCES public.budget_sections (id, budget_id, key) ON DELETE RESTRICT,
  CONSTRAINT budget_lines_fixed_frequency_check CHECK (kind <> 'fixed' OR frequency = 1)
);

CREATE INDEX IF NOT EXISTS idx_budget_lines_budget
  ON public.budget_lines (budget_id, section_id, sort)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_budget_lines_category ON public.budget_lines (category_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_needs_coding
  ON public.budget_lines (budget_id)
  WHERE coding_status = 'needs_coding' AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.budget_line_coding (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id               uuid NOT NULL REFERENCES public.budget_lines(id) ON DELETE RESTRICT,
  org_region            text NOT NULL CHECK (org_region IN ('za', 'us')),
  account_id            uuid REFERENCES public.xero_accounts(id) ON DELETE RESTRICT,
  tracking_option_1_id  uuid REFERENCES public.xero_tracking_options(id) ON DELETE RESTRICT,
  tracking_option_2_id  uuid REFERENCES public.xero_tracking_options(id) ON DELETE RESTRICT,
  source                text NOT NULL DEFAULT 'finance_override'
                        CHECK (source IN ('category_default', 'finance_override')),
  updated_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_line_coding_line_org_key UNIQUE (line_id, org_region),
  CONSTRAINT budget_line_coding_tracking_order_check
    CHECK (tracking_option_2_id IS NULL OR tracking_option_1_id IS NOT NULL),
  CONSTRAINT budget_line_coding_tracking_distinct_check
    CHECK (tracking_option_2_id IS NULL OR tracking_option_2_id <> tracking_option_1_id)
);


-- ────────────────────────────────────────────────────────────
-- 5. Access helpers (SECURITY DEFINER: they read budget_members without
--    tripping that table's own policies)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_budget_member(p_budget_id uuid, p_min_role text DEFAULT 'viewer')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budget_members m
     WHERE m.budget_id = p_budget_id
       AND m.user_id = auth.uid()
       AND CASE m.role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END
           >= CASE p_min_role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END
  );
$$;

-- Header, sections and members: finance, or the budget's owner.
CREATE OR REPLACE FUNCTION public.can_manage_budget(p_budget_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_edit_all_budgets() OR public.is_budget_member(p_budget_id, 'owner');
$$;

-- Lines: finance always; owners and editors while the budget is a live draft.
CREATE OR REPLACE FUNCTION public.can_edit_budget_lines(p_budget_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_edit_all_budgets()
      OR (public.is_budget_member(p_budget_id, 'editor')
          AND EXISTS (SELECT 1 FROM public.budgets b
                       WHERE b.id = p_budget_id AND b.status = 'draft' AND b.archived_at IS NULL));
$$;

-- Who may create a budget for an owner.
CREATE OR REPLACE FUNCTION public.can_create_budget_for(
  p_owner_kind text, p_staff_ministry_id uuid, p_subcategory_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_edit_all_budgets()
      OR (p_owner_kind = 'staff_ministry' AND public.leads_staff_ministry(p_staff_ministry_id))
      OR (p_owner_kind = 'ministry_subcategory' AND EXISTS (
            SELECT 1 FROM public.staff_ministry_subcategories s
             WHERE s.id = p_subcategory_id AND public.leads_staff_ministry(s.staff_ministry_id)));
$$;


-- ────────────────────────────────────────────────────────────
-- 6. Trigger functions
-- ────────────────────────────────────────────────────────────

-- Budgets: who created it, status rules, things that never change.
CREATE OR REPLACE FUNCTION public.budgets_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by  := coalesce(auth.uid(), NEW.created_by);
    NEW.status      := 'draft';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.archived_at := NULL;
    IF NEW.template_version IS NULL THEN
      SELECT t.version INTO NEW.template_version FROM public.budget_templates t WHERE t.id = NEW.template_id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.owner_kind IS DISTINCT FROM OLD.owner_kind
     OR NEW.staff_ministry_id IS DISTINCT FROM OLD.staff_ministry_id
     OR NEW.subcategory_id IS DISTINCT FROM OLD.subcategory_id
     OR NEW.program_id IS DISTINCT FROM OLD.program_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.outreach_team_id IS DISTINCT FROM OLD.outreach_team_id
     OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.template_version IS DISTINCT FROM OLD.template_version
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A budget''s owner, template and creator cannot be changed' USING ERRCODE = '42501';
  END IF;

  -- Archiving: status and archived_at always agree.
  IF NEW.archived_at IS NOT NULL OR NEW.status = 'archived' THEN
    NEW.status := 'archived';
    NEW.archived_at := coalesce(NEW.archived_at, now());
  END IF;

  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF auth.uid() IS NOT NULL AND NOT public.can_approve_budgets() THEN
      RAISE EXCEPTION 'Only finance can approve a budget' USING ERRCODE = '42501';
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  ELSIF NEW.status <> 'approved' AND OLD.status = 'approved' THEN
    IF auth.uid() IS NOT NULL AND NOT public.can_approve_budgets() THEN
      RAISE EXCEPTION 'Only finance can reopen an approved budget' USING ERRCODE = '42501';
    END IF;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  ELSE
    NEW.approved_by := OLD.approved_by;
    NEW.approved_at := OLD.approved_at;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Whoever creates a budget becomes its owner.
CREATE OR REPLACE FUNCTION public.budgets_after_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.budget_members (budget_id, user_id, role, added_by)
    VALUES (NEW.id, auth.uid(), 'owner', auth.uid())
    ON CONFLICT (budget_id, user_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

-- Driver changed → every live line that follows it is recomputed.
CREATE OR REPLACE FUNCTION public.budgets_driver_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Touching the rows re-runs budget_lines_before_write (new total).
  UPDATE public.budget_lines
     SET updated_at = now()
   WHERE budget_id = NEW.id AND uses_driver AND archived_at IS NULL;
  RETURN NULL;
END;
$$;

-- True when a category has a default Xero account in at least one org.
CREATE OR REPLACE FUNCTION public.budget_category_is_coded(p_category_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.budget_categories c
      JOIN public.budget_category_coding cc ON cc.category_id = c.id
     WHERE c.id = p_category_id
       AND c.key IS DISTINCT FROM 'not_sure_yet'
       AND cc.account_id IS NOT NULL
  );
$$;

-- Lines: default category, driver, total, coding status, things that never change.
-- SECURITY DEFINER: it reads category coding, which members cannot see.
CREATE OR REPLACE FUNCTION public.budget_lines_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver numeric;
BEGIN
  IF NEW.category_id IS NULL THEN
    SELECT id INTO NEW.category_id FROM public.budget_categories WHERE key = 'not_sure_yet';
  END IF;

  IF NEW.uses_driver THEN
    SELECT b.driver_value INTO v_driver FROM public.budgets b WHERE b.id = NEW.budget_id;
    NEW.multiplier := coalesce(v_driver, 0);
  END IF;

  NEW.line_total_cents := round(NEW.amount_cents * NEW.frequency * NEW.multiplier)::bigint;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by    := coalesce(auth.uid(), NEW.created_by);
    NEW.coding_status := CASE WHEN public.budget_category_is_coded(NEW.category_id)
                              THEN 'inherited' ELSE 'needs_coding' END;
  ELSE
    IF NEW.budget_id IS DISTINCT FROM OLD.budget_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'A line cannot move to another budget or change its creator' USING ERRCODE = '42501';
    END IF;

    IF NEW.category_id IS DISTINCT FROM OLD.category_id AND OLD.coding_status <> 'overridden' THEN
      -- New category → its default coding (copied in budget_lines_after_write).
      NEW.coding_status := CASE WHEN public.budget_category_is_coded(NEW.category_id)
                                THEN 'inherited' ELSE 'needs_coding' END;
    ELSIF auth.uid() IS NOT NULL AND NOT public.can_manage_budget_codes() THEN
      -- Only finance moves coding_status by hand.
      NEW.coding_status := OLD.coding_status;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Copy the category's default coding onto a new line, or onto a line whose
-- category changed (unless finance had overridden its coding).
CREATE OR REPLACE FUNCTION public.budget_lines_after_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.category_id IS NOT DISTINCT FROM OLD.category_id OR OLD.coding_status = 'overridden' THEN
      RETURN NULL;
    END IF;
    DELETE FROM public.budget_line_coding WHERE line_id = NEW.id;
  END IF;

  INSERT INTO public.budget_line_coding
    (line_id, org_region, account_id, tracking_option_1_id, tracking_option_2_id, source)
  SELECT NEW.id, cc.org_region, cc.account_id, cc.tracking_option_1_id, cc.tracking_option_2_id, 'category_default'
    FROM public.budget_category_coding cc
   WHERE cc.category_id = NEW.category_id;
  RETURN NULL;
END;
$$;

-- Coding rows (both tables): the account and options belong to the row's
-- organisation, and the two options come from different tracking categories
-- (Xero allows one option per category on a line).
CREATE OR REPLACE FUNCTION public.budget_coding_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cat1 uuid;
  v_cat2 uuid;
BEGIN
  IF NEW.account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.xero_accounts a WHERE a.id = NEW.account_id AND a.org_region = NEW.org_region) THEN
    RAISE EXCEPTION 'Xero account belongs to another organisation' USING ERRCODE = '23514';
  END IF;

  IF NEW.tracking_option_1_id IS NOT NULL THEN
    SELECT o.category_id INTO v_cat1 FROM public.xero_tracking_options o
     WHERE o.id = NEW.tracking_option_1_id AND o.org_region = NEW.org_region;
    IF v_cat1 IS NULL THEN
      RAISE EXCEPTION 'Tracking option 1 belongs to another organisation' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.tracking_option_2_id IS NOT NULL THEN
    SELECT o.category_id INTO v_cat2 FROM public.xero_tracking_options o
     WHERE o.id = NEW.tracking_option_2_id AND o.org_region = NEW.org_region;
    IF v_cat2 IS NULL THEN
      RAISE EXCEPTION 'Tracking option 2 belongs to another organisation' USING ERRCODE = '23514';
    END IF;
    IF v_cat2 = v_cat1 THEN
      RAISE EXCEPTION 'The two tracking options must come from different tracking categories' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- A direct write to a line's coding is a finance override; the copy made
  -- by budget_lines_after_write runs one trigger level deeper.
  IF TG_TABLE_NAME = 'budget_line_coding' AND pg_trigger_depth() = 1 THEN
    NEW.source := 'finance_override';
  END IF;

  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- After finance changes a line's coding directly, the line's status follows:
-- overridden while some organisation has an account, needs_coding otherwise.
CREATE OR REPLACE FUNCTION public.budget_line_coding_after_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.line_id ELSE NEW.line_id END;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;                                  -- the category copy, not finance
  END IF;
  UPDATE public.budget_lines l
     SET coding_status = CASE WHEN EXISTS (
           SELECT 1 FROM public.budget_line_coding c
            WHERE c.line_id = v_line AND c.account_id IS NOT NULL)
         THEN 'overridden' ELSE 'needs_coding' END
   WHERE l.id = v_line;
  RETURN NULL;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 7. Triggers
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_budgets_before_write ON public.budgets;
CREATE TRIGGER trg_budgets_before_write
  BEFORE INSERT OR UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.budgets_before_write();

DROP TRIGGER IF EXISTS trg_budgets_after_insert ON public.budgets;
CREATE TRIGGER trg_budgets_after_insert
  AFTER INSERT ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.budgets_after_insert();

DROP TRIGGER IF EXISTS trg_budgets_driver_changed ON public.budgets;
CREATE TRIGGER trg_budgets_driver_changed
  AFTER UPDATE OF driver_value ON public.budgets
  FOR EACH ROW
  WHEN (OLD.driver_value IS DISTINCT FROM NEW.driver_value)
  EXECUTE FUNCTION public.budgets_driver_changed();

DROP TRIGGER IF EXISTS trg_budget_lines_before_write ON public.budget_lines;
CREATE TRIGGER trg_budget_lines_before_write
  BEFORE INSERT OR UPDATE ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.budget_lines_before_write();

DROP TRIGGER IF EXISTS trg_budget_lines_after_write ON public.budget_lines;
CREATE TRIGGER trg_budget_lines_after_write
  AFTER INSERT OR UPDATE OF category_id ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.budget_lines_after_write();

DROP TRIGGER IF EXISTS trg_budget_line_coding_before_write ON public.budget_line_coding;
CREATE TRIGGER trg_budget_line_coding_before_write
  BEFORE INSERT OR UPDATE ON public.budget_line_coding
  FOR EACH ROW EXECUTE FUNCTION public.budget_coding_before_write();

DROP TRIGGER IF EXISTS trg_budget_line_coding_after_write ON public.budget_line_coding;
CREATE TRIGGER trg_budget_line_coding_after_write
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_line_coding
  FOR EACH ROW EXECUTE FUNCTION public.budget_line_coding_after_write();

DROP TRIGGER IF EXISTS trg_budget_category_coding_before_write ON public.budget_category_coding;
CREATE TRIGGER trg_budget_category_coding_before_write
  BEFORE INSERT OR UPDATE ON public.budget_category_coding
  FOR EACH ROW EXECUTE FUNCTION public.budget_coding_before_write();

DROP TRIGGER IF EXISTS trg_budget_categories_touch ON public.budget_categories;
CREATE TRIGGER trg_budget_categories_touch
  BEFORE UPDATE ON public.budget_categories
  FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();

DROP TRIGGER IF EXISTS trg_budget_templates_touch ON public.budget_templates;
CREATE TRIGGER trg_budget_templates_touch
  BEFORE UPDATE ON public.budget_templates
  FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();

DROP TRIGGER IF EXISTS trg_budget_members_touch ON public.budget_members;
CREATE TRIGGER trg_budget_members_touch
  BEFORE UPDATE ON public.budget_members
  FOR EACH ROW EXECUTE FUNCTION public.finance_touch_updated_at();

-- Audit: one generic trigger (277) on every budget table.
DROP TRIGGER IF EXISTS trg_budget_categories_audit ON public.budget_categories;
CREATE TRIGGER trg_budget_categories_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_categories
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_category_coding_audit ON public.budget_category_coding;
CREATE TRIGGER trg_budget_category_coding_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_category_coding
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_templates_audit ON public.budget_templates;
CREATE TRIGGER trg_budget_templates_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_templates
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_template_sections_audit ON public.budget_template_sections;
CREATE TRIGGER trg_budget_template_sections_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_template_sections
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budgets_audit ON public.budgets;
CREATE TRIGGER trg_budgets_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_sections_audit ON public.budget_sections;
CREATE TRIGGER trg_budget_sections_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_sections
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_members_audit ON public.budget_members;
CREATE TRIGGER trg_budget_members_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_members
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_lines_audit ON public.budget_lines;
CREATE TRIGGER trg_budget_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_line_coding_audit ON public.budget_line_coding;
CREATE TRIGGER trg_budget_line_coding_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_line_coding
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_row();


-- ────────────────────────────────────────────────────────────
-- 8. create_budget_from_template()
-- ────────────────────────────────────────────────────────────
-- SECURITY INVOKER: every insert below is checked by the caller's own RLS,
-- so this can create nothing the caller could not create by hand. Inserts
-- the budget and a copy of the template's sections — ZERO lines. The audit
-- row ('create_from_template') is written by the audit trigger.
CREATE OR REPLACE FUNCTION public.create_budget_from_template(
  p_template_id   uuid,
  p_owner_kind    text,
  p_owner_id      uuid,
  p_period_id     uuid,
  p_name          text,
  p_currency      text DEFAULT NULL,
  p_driver_label  text DEFAULT NULL,
  p_driver_value  numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_template  public.budget_templates%ROWTYPE;
  v_id        uuid := gen_random_uuid();
BEGIN
  SELECT * INTO v_template FROM public.budget_templates WHERE id = p_template_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget template not found or not active' USING ERRCODE = '22023';
  END IF;
  IF p_owner_kind = 'outreach_team' THEN
    RAISE EXCEPTION 'Outreach teams keep their own budget for now' USING ERRCODE = '22023';
  END IF;
  IF p_owner_kind IS NULL OR NOT (p_owner_kind = ANY (v_template.applies_to)) THEN
    RAISE EXCEPTION 'This template is not for owner kind %', p_owner_kind USING ERRCODE = '22023';
  END IF;
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'An owner is required' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'A budget name is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fiscal_periods WHERE id = p_period_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Period not found or archived' USING ERRCODE = '22023';
  END IF;

  -- No RETURNING: the caller only becomes a member (and can read the row)
  -- once the AFTER INSERT trigger has run.
  INSERT INTO public.budgets
    (id, name, template_id, template_version, period_id, currency, owner_kind,
     staff_ministry_id, subcategory_id, program_id, event_id,
     driver_label, driver_value)
  VALUES
    (v_id, btrim(p_name), v_template.id, v_template.version, p_period_id,
     coalesce(p_currency, v_template.default_currency), p_owner_kind,
     CASE WHEN p_owner_kind = 'staff_ministry'       THEN p_owner_id END,
     CASE WHEN p_owner_kind = 'ministry_subcategory' THEN p_owner_id END,
     CASE WHEN p_owner_kind = 'program'              THEN p_owner_id END,
     CASE WHEN p_owner_kind = 'event'                THEN p_owner_id END,
     p_driver_label, p_driver_value);

  INSERT INTO public.budget_sections (budget_id, key, label, sort)
  SELECT v_id, s.key, s.label, s.sort
    FROM public.budget_template_sections s
   WHERE s.template_id = v_template.id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_budget_from_template(uuid, text, uuid, uuid, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_budget_from_template(uuid, text, uuid, uuid, text, text, text, numeric) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────
-- 9. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.budget_categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_category_coding   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_template_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_sections          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_lines             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_line_coding       ENABLE ROW LEVEL SECURITY;

-- No DELETE policy anywhere except members and coding: budgets, lines,
-- sections, categories and templates are archived, never deleted.

-- Categories: everyone signed in picks from them; finance curates.
DROP POLICY IF EXISTS "Signed-in users read budget categories" ON public.budget_categories;
CREATE POLICY "Signed-in users read budget categories"
  ON public.budget_categories FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Finance adds budget categories" ON public.budget_categories;
CREATE POLICY "Finance adds budget categories"
  ON public.budget_categories FOR INSERT
  WITH CHECK (public.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance edits budget categories" ON public.budget_categories;
CREATE POLICY "Finance edits budget categories"
  ON public.budget_categories FOR UPDATE
  USING (public.can_manage_budget_codes())
  WITH CHECK (public.can_manage_budget_codes());

-- Category coding: finance only.
DROP POLICY IF EXISTS "Finance reads category coding" ON public.budget_category_coding;
CREATE POLICY "Finance reads category coding"
  ON public.budget_category_coding FOR SELECT
  USING (public.can_view_all_budgets() OR public.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance adds category coding" ON public.budget_category_coding;
CREATE POLICY "Finance adds category coding"
  ON public.budget_category_coding FOR INSERT
  WITH CHECK (public.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance edits category coding" ON public.budget_category_coding;
CREATE POLICY "Finance edits category coding"
  ON public.budget_category_coding FOR UPDATE
  USING (public.can_manage_budget_codes())
  WITH CHECK (public.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance removes category coding" ON public.budget_category_coding;
CREATE POLICY "Finance removes category coding"
  ON public.budget_category_coding FOR DELETE
  USING (public.can_manage_budget_codes());

-- Templates: everyone signed in reads; finance maintains.
DROP POLICY IF EXISTS "Signed-in users read budget templates" ON public.budget_templates;
CREATE POLICY "Signed-in users read budget templates"
  ON public.budget_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Finance adds budget templates" ON public.budget_templates;
CREATE POLICY "Finance adds budget templates"
  ON public.budget_templates FOR INSERT
  WITH CHECK (public.can_edit_all_budgets());

DROP POLICY IF EXISTS "Finance edits budget templates" ON public.budget_templates;
CREATE POLICY "Finance edits budget templates"
  ON public.budget_templates FOR UPDATE
  USING (public.can_edit_all_budgets())
  WITH CHECK (public.can_edit_all_budgets());

DROP POLICY IF EXISTS "Signed-in users read template sections" ON public.budget_template_sections;
CREATE POLICY "Signed-in users read template sections"
  ON public.budget_template_sections FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Finance adds template sections" ON public.budget_template_sections;
CREATE POLICY "Finance adds template sections"
  ON public.budget_template_sections FOR INSERT
  WITH CHECK (public.can_edit_all_budgets());

DROP POLICY IF EXISTS "Finance edits template sections" ON public.budget_template_sections;
CREATE POLICY "Finance edits template sections"
  ON public.budget_template_sections FOR UPDATE
  USING (public.can_edit_all_budgets())
  WITH CHECK (public.can_edit_all_budgets());

-- Budgets.
DROP POLICY IF EXISTS "Finance and members read budgets" ON public.budgets;
CREATE POLICY "Finance and members read budgets"
  ON public.budgets FOR SELECT
  USING (public.can_view_all_budgets() OR public.is_budget_member(id));

DROP POLICY IF EXISTS "Finance and ministry leaders create budgets" ON public.budgets;
CREATE POLICY "Finance and ministry leaders create budgets"
  ON public.budgets FOR INSERT
  WITH CHECK (public.can_create_budget_for(owner_kind, staff_ministry_id, subcategory_id));

DROP POLICY IF EXISTS "Finance edits budgets" ON public.budgets;
CREATE POLICY "Finance edits budgets"
  ON public.budgets FOR UPDATE
  USING (public.can_edit_all_budgets())
  WITH CHECK (public.can_edit_all_budgets());

-- Owners change a live draft, and may submit or archive it — not approve.
DROP POLICY IF EXISTS "Owners edit their draft budgets" ON public.budgets;
CREATE POLICY "Owners edit their draft budgets"
  ON public.budgets FOR UPDATE
  USING (public.is_budget_member(id, 'owner') AND status = 'draft' AND archived_at IS NULL)
  WITH CHECK (public.is_budget_member(id, 'owner') AND status IN ('draft', 'submitted', 'archived'));

-- Sections.
DROP POLICY IF EXISTS "Finance and members read budget sections" ON public.budget_sections;
CREATE POLICY "Finance and members read budget sections"
  ON public.budget_sections FOR SELECT
  USING (public.can_view_all_budgets() OR public.is_budget_member(budget_id));

DROP POLICY IF EXISTS "Budget managers add sections" ON public.budget_sections;
CREATE POLICY "Budget managers add sections"
  ON public.budget_sections FOR INSERT
  WITH CHECK (public.can_manage_budget(budget_id));

DROP POLICY IF EXISTS "Budget managers edit sections" ON public.budget_sections;
CREATE POLICY "Budget managers edit sections"
  ON public.budget_sections FOR UPDATE
  USING (public.can_manage_budget(budget_id))
  WITH CHECK (public.can_manage_budget(budget_id));

-- Members.
DROP POLICY IF EXISTS "Finance and members read budget members" ON public.budget_members;
CREATE POLICY "Finance and members read budget members"
  ON public.budget_members FOR SELECT
  USING (public.can_view_all_budgets() OR public.is_budget_member(budget_id));

DROP POLICY IF EXISTS "Budget managers add members" ON public.budget_members;
CREATE POLICY "Budget managers add members"
  ON public.budget_members FOR INSERT
  WITH CHECK (public.can_manage_budget(budget_id));

DROP POLICY IF EXISTS "Budget managers change members" ON public.budget_members;
CREATE POLICY "Budget managers change members"
  ON public.budget_members FOR UPDATE
  USING (public.can_manage_budget(budget_id))
  WITH CHECK (public.can_manage_budget(budget_id));

DROP POLICY IF EXISTS "Budget managers remove members" ON public.budget_members;
CREATE POLICY "Budget managers remove members"
  ON public.budget_members FOR DELETE
  USING (public.can_manage_budget(budget_id));

-- Lines.
DROP POLICY IF EXISTS "Finance and members read budget lines" ON public.budget_lines;
CREATE POLICY "Finance and members read budget lines"
  ON public.budget_lines FOR SELECT
  USING (public.can_view_all_budgets() OR public.is_budget_member(budget_id));

DROP POLICY IF EXISTS "Budget editors add lines" ON public.budget_lines;
CREATE POLICY "Budget editors add lines"
  ON public.budget_lines FOR INSERT
  WITH CHECK (public.can_edit_budget_lines(budget_id));

DROP POLICY IF EXISTS "Budget editors change lines" ON public.budget_lines;
CREATE POLICY "Budget editors change lines"
  ON public.budget_lines FOR UPDATE
  USING (public.can_edit_budget_lines(budget_id))
  WITH CHECK (public.can_edit_budget_lines(budget_id));

-- Line coding: finance only.
DROP POLICY IF EXISTS "Finance reads line coding" ON public.budget_line_coding;
CREATE POLICY "Finance reads line coding"
  ON public.budget_line_coding FOR SELECT
  USING (public.can_view_all_budgets() OR public.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance adds line coding" ON public.budget_line_coding;
CREATE POLICY "Finance adds line coding"
  ON public.budget_line_coding FOR INSERT
  WITH CHECK (public.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance edits line coding" ON public.budget_line_coding;
CREATE POLICY "Finance edits line coding"
  ON public.budget_line_coding FOR UPDATE
  USING (public.can_manage_budget_codes())
  WITH CHECK (public.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance removes line coding" ON public.budget_line_coding;
CREATE POLICY "Finance removes line coding"
  ON public.budget_line_coding FOR DELETE
  USING (public.can_manage_budget_codes());


-- ────────────────────────────────────────────────────────────
-- 10. Seed: "Not sure yet" and the empty standard team template
-- ────────────────────────────────────────────────────────────
-- No Xero coding is seeded: real categories and their accounts come from
-- Coreen. Existing rows are left alone, so a re-run never undoes an edit.
INSERT INTO public.budget_categories (key, name, sort, help_text)
VALUES ('not_sure_yet', 'Not sure yet', 1000,
        'Pick this if you are not sure where a cost belongs. Finance will sort it.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.budget_templates (key, name, version, applies_to, default_currency, funding_fields)
VALUES (
  'team_standard', 'Team budget (standard)', 1,
  ARRAY['staff_ministry', 'ministry_subcategory', 'program', 'event'],
  'ZAR',
  '[{"key": "funding_goal_cents",     "label": "Funding goal"},
    {"key": "funds_in_hand_cents",    "label": "Funds in hand"},
    {"key": "income_goal_cents",      "label": "Income goal"},
    {"key": "fundraising_goal_cents", "label": "Fundraising goal"}]'::jsonb
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.budget_template_sections (template_id, key, label, help_text, sort)
SELECT t.id, s.key, s.label, s.help_text, s.sort
  FROM public.budget_templates t
 CROSS JOIN (VALUES
   ('overview',        'Overview',        'What this budget is for, who it covers and how it is funded.', 10),
   ('dashboard',       'Dashboard',       'Totals worked out from every line. Nothing to type here.',     20),
   ('variable',        'Variable cost',   'Repeating costs: price each × how many times × how many people or items.', 30),
   ('fixed',           'Fixed cost',      'One-off purchases: price each × quantity.',                     40),
   ('expense_tracker', 'Expense tracker', 'Receipts and spending, once they are connected.',               50),
   ('notes',           'Notes',           'Anything else finance or the team should know.',                60)
 ) AS s(key, label, help_text, sort)
 WHERE t.key = 'team_standard'
ON CONFLICT (template_id, key) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- 11. Comments
-- ────────────────────────────────────────────────────────────
COMMENT ON TABLE public.budget_categories IS
  'Friendly spending categories volunteers pick on a budget line (e.g. "Sound & AV gear"). Each has default Xero coding per organisation in budget_category_coding. Seeded with "Not sure yet" only. Archived, never deleted.';
COMMENT ON COLUMN public.budget_categories.key IS
  'Stable handle for code. ''not_sure_yet'' marks the category that always sends a line to finance''s coding queue.';
COMMENT ON COLUMN public.budget_categories.is_active IS
  'False hides the category from pickers; lines already using it keep it.';

COMMENT ON TABLE public.budget_category_coding IS
  'Default Xero coding for a friendly category, one row per organisation (za / us): an account and up to two tracking options from the 275 mirror. Copied onto each new line. Finance only.';
COMMENT ON COLUMN public.budget_category_coding.account_id IS
  'xero_accounts.id (the Hub''s uuid, not the Xero id). Must be in the same organisation as org_region.';
COMMENT ON COLUMN public.budget_category_coding.tracking_option_1_id IS
  'xero_tracking_options.id. Options 1 and 2 must come from different tracking categories in this organisation.';

COMMENT ON TABLE public.budget_templates IS
  'Budget templates. A template is a list of sections and NEVER has lines, so every budget created from one starts empty. Budgets record the version they were made from and are never re-synced.';
COMMENT ON COLUMN public.budget_templates.applies_to IS
  'Owner kinds the template may be used for. outreach_team is allowed in the type but not offered yet.';
COMMENT ON COLUMN public.budget_templates.funding_fields IS
  'Which funding rows the overview shows: [{key, label}], keys are budgets.*_cents columns.';

COMMENT ON TABLE public.budget_template_sections IS
  'The sections a template copies onto a new budget. Only fixed and variable hold lines (holds_lines).';

COMMENT ON TABLE public.budgets IS
  'One budget for one owner (staff ministry, ministry sub-category, school or event) and one fiscal period. Created by create_budget_from_template(). Money in cents. Archived, never deleted. Members see their own; finance sees all.';
COMMENT ON COLUMN public.budgets.owner_kind IS
  'Which owner column is set: staff_ministry, ministry_subcategory, program, event (or outreach_team, reserved). Exactly one owner column is non-null and it matches this.';
COMMENT ON COLUMN public.budgets.template_version IS
  'The template version this budget was copied from. The budget is never updated when the template changes.';
COMMENT ON COLUMN public.budgets.currency IS
  'ZAR or USD. No currency conversion anywhere.';
COMMENT ON COLUMN public.budgets.status IS
  'draft → submitted → approved, or archived. Only budget.approve holders approve or reopen an approved budget.';
COMMENT ON COLUMN public.budgets.driver_label IS
  'What the budget''s driver counts, e.g. "volunteers".';
COMMENT ON COLUMN public.budgets.driver_value IS
  'The driver''s number, e.g. 8. Lines with uses_driver take it as their multiplier and are recomputed when it changes.';
COMMENT ON COLUMN public.budgets.funding_goal_cents IS
  'Funding row from the old sheet, in cents. Optional.';
COMMENT ON COLUMN public.budgets.archived_at IS
  'Set instead of deleting. Also sets status to archived.';

COMMENT ON TABLE public.budget_sections IS
  'A budget''s sections, copied from its template at creation: overview, dashboard, variable, fixed, expense_tracker, notes. Lines live in fixed and variable only.';

COMMENT ON TABLE public.budget_members IS
  'Who can see or edit ONE budget: owner (header, members, lines), editor (lines while draft), viewer (read). The creator becomes owner automatically.';

COMMENT ON TABLE public.budget_lines IS
  'A cost on a budget. Total = round(amount_cents × frequency × multiplier), computed by trigger. Fixed lines have frequency 1 and a quantity as multiplier. Archived, never deleted; ids are stable so receipts can attach later.';
COMMENT ON COLUMN public.budget_lines.kind IS
  'fixed (one-off purchase) or variable (repeating cost). Must match the section''s key.';
COMMENT ON COLUMN public.budget_lines.category_id IS
  'Friendly category; its default coding is copied onto the line when it is created. Left empty, the line goes to "Not sure yet".';
COMMENT ON COLUMN public.budget_lines.amount_cents IS
  'Price each, in cents of the budget''s currency.';
COMMENT ON COLUMN public.budget_lines.frequency IS
  'How many times (a bare number, 2 decimals). Always 1 on fixed lines.';
COMMENT ON COLUMN public.budget_lines.multiplier IS
  'How many people or items (2 decimals). Set from budgets.driver_value when uses_driver is true.';
COMMENT ON COLUMN public.budget_lines.uses_driver IS
  'True: the multiplier follows the budget''s driver (e.g. 8 volunteers) instead of a typed number.';
COMMENT ON COLUMN public.budget_lines.line_total_cents IS
  'round(amount_cents × frequency × multiplier). Trigger-computed; any value sent by a client is overwritten.';
COMMENT ON COLUMN public.budget_lines.coding_status IS
  'inherited (coding copied from a coded category), overridden (finance set it), needs_coding (Not sure yet, or no account yet — finance''s queue). Only finance changes it by hand.';

COMMENT ON TABLE public.budget_line_coding IS
  'Xero coding of a budget line per organisation: account + up to two tracking options (mirror uuids). Copied from the category when the line is created; only finance changes it. Finance only.';
COMMENT ON COLUMN public.budget_line_coding.source IS
  'category_default (copied from the category) or finance_override (finance wrote it).';

COMMENT ON FUNCTION public.create_budget_from_template(uuid, text, uuid, uuid, text, text, text, numeric) IS
  'Creates an EMPTY budget from a template: the budget row plus a copy of the template''s sections, zero lines. Runs as the caller (SECURITY INVOKER), so RLS decides who may create what. The caller becomes the budget''s owner. Returns the new budget id.';
COMMENT ON FUNCTION public.is_budget_member(uuid, text) IS
  'True when the current user is a member of the budget with at least the given role (viewer < editor < owner).';


-- ============================================================
-- Verify:
--   SELECT key, name FROM public.budget_categories;              -- not_sure_yet only
--   SELECT count(*) FROM public.budget_category_coding;          -- 0 (no codes invented)
--   SELECT t.name, s.key, s.holds_lines FROM public.budget_templates t
--     JOIN public.budget_template_sections s ON s.template_id = t.id ORDER BY s.sort;
--                                        -- six sections, fixed + variable hold lines
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'budget%' AND relkind = 'r';
--                                                                -- all true
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (run 279's rollback first):
--   WARNING: deletes every budget, line, member and coding row. Their
--   history stays in finance_audit_log until 277 is rolled back.
--
--   DROP FUNCTION IF EXISTS public.create_budget_from_template(uuid, text, uuid, uuid, text, text, text, numeric);
--   DROP TABLE IF EXISTS public.budget_line_coding CASCADE;
--   DROP TABLE IF EXISTS public.budget_lines CASCADE;
--   DROP TABLE IF EXISTS public.budget_members CASCADE;
--   DROP TABLE IF EXISTS public.budget_sections CASCADE;
--   DROP TABLE IF EXISTS public.budgets CASCADE;
--   DROP TABLE IF EXISTS public.budget_template_sections CASCADE;
--   DROP TABLE IF EXISTS public.budget_templates CASCADE;
--   DROP TABLE IF EXISTS public.budget_category_coding CASCADE;
--   DROP TABLE IF EXISTS public.budget_categories CASCADE;
--   DROP FUNCTION IF EXISTS public.budget_line_coding_after_write();
--   DROP FUNCTION IF EXISTS public.budget_coding_before_write();
--   DROP FUNCTION IF EXISTS public.budget_lines_after_write();
--   DROP FUNCTION IF EXISTS public.budget_lines_before_write();
--   DROP FUNCTION IF EXISTS public.budget_category_is_coded(uuid);
--   DROP FUNCTION IF EXISTS public.budgets_driver_changed();
--   DROP FUNCTION IF EXISTS public.budgets_after_insert();
--   DROP FUNCTION IF EXISTS public.budgets_before_write();
--   DROP FUNCTION IF EXISTS public.can_create_budget_for(text, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.can_edit_budget_lines(uuid);
--   DROP FUNCTION IF EXISTS public.can_manage_budget(uuid);
--   DROP FUNCTION IF EXISTS public.is_budget_member(uuid, text);
-- ------------------------------------------------------------
