-- ============================================================
-- FFSA Hub — Migration 278: budgets, templates and copies
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
--   * A line is amount × frequency × multiplier, in CENTS. The total is
--     always computed by a trigger, never taken from the client:
--       line_total_cents = round(amount_cents × frequency × multiplier)
--     A line with uses_driver follows the budget's driver (e.g. 8
--     volunteers): change the driver and those lines move.
--     Fixed lines have frequency 1; their multiplier is the quantity.
--   * Every line carries Xero coding per organisation (za / us): an
--     account and up to two tracking options, pointing at the 275 mirror
--     by uuid. A new line's coding is COPIED from its friendly category.
--     Only finance (budget.manage_codes) changes it after that. A line in
--     "Not sure yet", or whose category has no account yet, is
--     needs_coding and lands in finance's queue. No Xero codes are
--     invented: the only seeded category is "Not sure yet", with no coding.
--   * Nothing is hard-deleted. Budgets and lines are archived
--     (archived_at). Every change is written to finance_audit_log (277).
--
-- Three ways to start a budget — every one gives a DRAFT (or, if asked,
-- submitted) budget, NEVER an approved one:
--
--   1. create_budget_from_template() with the standard "Team budget"
--      template: sections only, ZERO lines (the "Sound – Upstairs" layout:
--      Overview, Dashboard, Variable cost, Fixed cost, Expense tracker,
--      Notes; only Fixed and Variable hold lines). Nothing from the old
--      sheet is imported.
--   2. create_budget_from_template() with a SAVED template. A saved
--      template is made by save_budget_as_template() from any budget: it
--      keeps the sections, lines, amounts, frequencies, multipliers,
--      driver, categories and Xero coding — not approvals, history,
--      actuals or receipts (there are none in the template tables). It is
--      scoped to the budget's owner (that ministry / school / event) and
--      remembers source_budget_id.
--   3. copy_budget_to_period(): last year's / last quarter's budget, copied
--      straight into a new period.
--   The new budget stores source_budget_id and source_template_id, so
--   year-over-year comparison (279's v_budget_yoy) can pair them.
--   Copied coding is re-checked: any account or tracking option that is no
--   longer active in the mirror (archived, or missing from Xero) is dropped
--   from the copy and the line is flagged needs_coding. The line is kept.
--
-- Who sees and does what (RLS + triggers):
--   * Finance — can_view_all_budgets() — sees every budget and template.
--     can_edit_all_budgets() changes any budget that is not approved.
--   * budget_members: owner / editor / viewer of ONE budget see that
--     budget. Editors and owners change its lines while it is a draft;
--     owners also change its header, submit it, archive it, manage its
--     members, save it as a template and copy it to a new period.
--     Whoever creates a budget becomes its owner.
--   * Creating a budget: finance (any owner); a leader of the staff
--     ministry it is for (leads_staff_ministry, 126; for a sub-category, a
--     leader of its parent ministry); the owner of the budget it is copied
--     from; or, from a saved template, someone who owns a live budget of
--     that same owner. Viewers and editors cannot copy.
--   * APPROVAL: only has_permission('budget.approve') — the Budget Approver
--     role from 277, meant for Coreen alone. Not admins, not finance_admin.
--     Only a SUBMITTED budget can be approved; approved_by / approved_at are
--     set by the trigger. An APPROVED budget is frozen for everyone: to
--     change it, the approver reopens it (back to draft) first.
--   * Coding tables are readable by finance only; members see a line's
--     coding_status, never the account codes.
--
-- The Hub never writes to Xero. No sync, actuals or receipts here.
--
-- Only adds new objects; no existing table or row is touched.
--
-- Safe to re-run: tables and indexes are IF NOT EXISTS, functions are
-- CREATE OR REPLACE, triggers, policies and the two late foreign keys are
-- dropped by name before they are created, seed rows are ON CONFLICT DO
-- NOTHING (finance's later edits to the seeded category or template are
-- never overwritten).
--
-- ROLLBACK (summary): drop the eleven tables and the functions this file
-- adds. Full block at the end. Roll back 279 first.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 0. Owner id helper (used by indexes and policies below)
-- ────────────────────────────────────────────────────────────
-- The one owner column that is set, whichever kind it is.
CREATE OR REPLACE FUNCTION public.budget_owner_id(
  p_staff_ministry_id uuid, p_subcategory_id uuid, p_program_id uuid, p_event_id uuid, p_outreach_team_id uuid
)
RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_staff_ministry_id, p_subcategory_id, p_program_id, p_event_id, p_outreach_team_id);
$$;


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
-- 2. Templates — the standard empty one, and saved ones
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.budget_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable handle for built-in templates ('team_standard'). NULL for saved ones.
  key               text UNIQUE,
  name              text NOT NULL CHECK (btrim(name) <> ''),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_active         boolean NOT NULL DEFAULT true,
  applies_to        text[] NOT NULL DEFAULT ARRAY['staff_ministry', 'ministry_subcategory', 'program', 'event'],
  default_currency  text NOT NULL DEFAULT 'ZAR' CHECK (default_currency IN ('ZAR', 'USD')),
  funding_fields    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Scope: NULL owner_kind = usable for any owner (the standard template).
  -- Otherwise only for this one owner.
  owner_kind        text CHECK (owner_kind IN ('staff_ministry', 'ministry_subcategory', 'program', 'event', 'outreach_team')),
  staff_ministry_id uuid REFERENCES public.staff_ministries(id) ON DELETE RESTRICT,
  subcategory_id    uuid REFERENCES public.staff_ministry_subcategories(id) ON DELETE RESTRICT,
  program_id        uuid REFERENCES public.programs(id) ON DELETE RESTRICT,
  event_id          uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  outreach_team_id  uuid REFERENCES public.outreach_teams(id) ON DELETE RESTRICT,
  -- The budget a saved template was made from (FK added after budgets exists).
  source_budget_id  uuid,
  driver_label      text,
  driver_value      numeric(10,2) CHECK (driver_value >= 0),
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz,
  CONSTRAINT budget_templates_applies_to_check
    CHECK (applies_to <@ ARRAY['staff_ministry', 'ministry_subcategory', 'program', 'event', 'outreach_team']),
  CONSTRAINT budget_templates_scope_check CHECK (
    CASE
      WHEN owner_kind IS NULL THEN
        num_nonnulls(staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id) = 0
      ELSE
        num_nonnulls(staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id) = 1
        AND CASE owner_kind
              WHEN 'staff_ministry'       THEN staff_ministry_id IS NOT NULL
              WHEN 'ministry_subcategory' THEN subcategory_id IS NOT NULL
              WHEN 'program'              THEN program_id IS NOT NULL
              WHEN 'event'                THEN event_id IS NOT NULL
              WHEN 'outreach_team'        THEN outreach_team_id IS NOT NULL
            END
    END
  )
);

-- Saved templates: one live template per owner and name.
CREATE UNIQUE INDEX IF NOT EXISTS budget_templates_live_scope_name_key
  ON public.budget_templates (
    owner_kind,
    public.budget_owner_id(staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id),
    lower(btrim(name))
  )
  WHERE archived_at IS NULL AND owner_kind IS NOT NULL;

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
  -- Where this budget came from, for year-over-year comparison.
  source_budget_id        uuid REFERENCES public.budgets(id) ON DELETE RESTRICT,
  source_template_id      uuid REFERENCES public.budget_templates(id) ON DELETE RESTRICT,
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
  ),
  CONSTRAINT budgets_not_own_source_check CHECK (source_budget_id IS DISTINCT FROM id)
);

-- One live budget per owner, period and name.
CREATE UNIQUE INDEX IF NOT EXISTS budgets_live_owner_period_name_key
  ON public.budgets (
    owner_kind,
    public.budget_owner_id(staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id),
    period_id,
    lower(btrim(name))
  )
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_budgets_staff_ministry ON public.budgets (staff_ministry_id) WHERE staff_ministry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_subcategory    ON public.budgets (subcategory_id)    WHERE subcategory_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_program        ON public.budgets (program_id)        WHERE program_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_event          ON public.budgets (event_id)          WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_period         ON public.budgets (period_id);
CREATE INDEX IF NOT EXISTS idx_budgets_source_budget  ON public.budgets (source_budget_id)  WHERE source_budget_id IS NOT NULL;

-- Late foreign key: templates point back at the budget they were saved from.
ALTER TABLE public.budget_templates DROP CONSTRAINT IF EXISTS budget_templates_source_budget_id_fkey;
ALTER TABLE public.budget_templates ADD CONSTRAINT budget_templates_source_budget_id_fkey
  FOREIGN KEY (source_budget_id) REFERENCES public.budgets(id) ON DELETE RESTRICT;


-- ────────────────────────────────────────────────────────────
-- 4. Sections (copied at creation), members, lines, line coding
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
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id                uuid NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  section_id               uuid NOT NULL,
  kind                     text NOT NULL CHECK (kind IN ('fixed', 'variable')),
  name                     text NOT NULL CHECK (btrim(name) <> ''),
  -- NULL on insert means "Not sure yet" (filled by the trigger).
  category_id              uuid NOT NULL REFERENCES public.budget_categories(id) ON DELETE RESTRICT,
  amount_cents             bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  -- A bare number, as in outreach (236): "12" times, no unit.
  frequency                numeric(10,2) NOT NULL DEFAULT 1 CHECK (frequency >= 0),
  multiplier               numeric(10,2) NOT NULL DEFAULT 1 CHECK (multiplier >= 0),
  uses_driver              boolean NOT NULL DEFAULT false,
  -- round(amount_cents × frequency × multiplier). Trigger-computed only.
  line_total_cents         bigint NOT NULL DEFAULT 0,
  sort                     integer NOT NULL DEFAULT 0,
  notes                    text,
  coding_status            text NOT NULL DEFAULT 'needs_coding'
                           CHECK (coding_status IN ('inherited', 'overridden', 'needs_coding')),
  -- Where a copied line came from (at most one). Its coding is copied from
  -- there instead of from the category. FK to template lines added below.
  source_line_id           uuid REFERENCES public.budget_lines(id) ON DELETE RESTRICT,
  source_template_line_id  uuid,
  created_by               uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz,
  -- The section must belong to the same budget and match the line's kind.
  CONSTRAINT budget_lines_section_fkey FOREIGN KEY (section_id, budget_id, kind)
    REFERENCES public.budget_sections (id, budget_id, key) ON DELETE RESTRICT,
  CONSTRAINT budget_lines_fixed_frequency_check CHECK (kind <> 'fixed' OR frequency = 1),
  CONSTRAINT budget_lines_one_source_check CHECK (num_nonnulls(source_line_id, source_template_line_id) <= 1)
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
-- 5. Template lines + their coding (saved templates only)
-- ────────────────────────────────────────────────────────────
-- Planning numbers only. There is deliberately no place here for actuals,
-- receipts, approvals or history.
CREATE TABLE IF NOT EXISTS public.budget_template_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL REFERENCES public.budget_templates(id) ON DELETE RESTRICT,
  kind            text NOT NULL CHECK (kind IN ('fixed', 'variable')),
  name            text NOT NULL CHECK (btrim(name) <> ''),
  category_id     uuid NOT NULL REFERENCES public.budget_categories(id) ON DELETE RESTRICT,
  amount_cents    bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  frequency       numeric(10,2) NOT NULL DEFAULT 1 CHECK (frequency >= 0),
  multiplier      numeric(10,2) NOT NULL DEFAULT 1 CHECK (multiplier >= 0),
  uses_driver     boolean NOT NULL DEFAULT false,
  sort            integer NOT NULL DEFAULT 0,
  notes           text,
  coding_status   text NOT NULL DEFAULT 'needs_coding'
                  CHECK (coding_status IN ('inherited', 'overridden', 'needs_coding')),
  source_line_id  uuid REFERENCES public.budget_lines(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  -- The template must have a section for the line's kind.
  CONSTRAINT budget_template_lines_section_fkey FOREIGN KEY (template_id, kind)
    REFERENCES public.budget_template_sections (template_id, key) ON DELETE RESTRICT,
  CONSTRAINT budget_template_lines_fixed_frequency_check CHECK (kind <> 'fixed' OR frequency = 1)
);

CREATE INDEX IF NOT EXISTS idx_budget_template_lines_template
  ON public.budget_template_lines (template_id, kind, sort)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.budget_template_line_coding (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_line_id      uuid NOT NULL REFERENCES public.budget_template_lines(id) ON DELETE RESTRICT,
  org_region            text NOT NULL CHECK (org_region IN ('za', 'us')),
  account_id            uuid REFERENCES public.xero_accounts(id) ON DELETE RESTRICT,
  tracking_option_1_id  uuid REFERENCES public.xero_tracking_options(id) ON DELETE RESTRICT,
  tracking_option_2_id  uuid REFERENCES public.xero_tracking_options(id) ON DELETE RESTRICT,
  source                text NOT NULL DEFAULT 'finance_override'
                        CHECK (source IN ('category_default', 'finance_override')),
  updated_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_template_line_coding_line_org_key UNIQUE (template_line_id, org_region),
  CONSTRAINT budget_template_line_coding_tracking_order_check
    CHECK (tracking_option_2_id IS NULL OR tracking_option_1_id IS NOT NULL),
  CONSTRAINT budget_template_line_coding_tracking_distinct_check
    CHECK (tracking_option_2_id IS NULL OR tracking_option_2_id <> tracking_option_1_id)
);

-- Late foreign key: budget lines copied from a template line.
ALTER TABLE public.budget_lines DROP CONSTRAINT IF EXISTS budget_lines_source_template_line_id_fkey;
ALTER TABLE public.budget_lines ADD CONSTRAINT budget_lines_source_template_line_id_fkey
  FOREIGN KEY (source_template_line_id) REFERENCES public.budget_template_lines(id) ON DELETE RESTRICT;


-- ────────────────────────────────────────────────────────────
-- 6. Access helpers (SECURITY DEFINER: they read budget_members and
--    budget_templates without tripping those tables' own policies)
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

-- Is the current user a member (at least p_min_role) of some live budget of this owner?
CREATE OR REPLACE FUNCTION public.is_member_of_budget_owner(p_owner_kind text, p_owner_id uuid, p_min_role text DEFAULT 'viewer')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budgets b
     WHERE b.owner_kind = p_owner_kind
       AND public.budget_owner_id(b.staff_ministry_id, b.subcategory_id, b.program_id, b.event_id, b.outreach_team_id) = p_owner_id
       AND b.archived_at IS NULL
       AND public.is_budget_member(b.id, p_min_role)
  );
$$;

-- Does this budget belong to this owner?
CREATE OR REPLACE FUNCTION public.budget_has_owner(p_budget_id uuid, p_owner_kind text, p_owner_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budgets b
     WHERE b.id = p_budget_id
       AND b.owner_kind = p_owner_kind
       AND public.budget_owner_id(b.staff_ministry_id, b.subcategory_id, b.program_id, b.event_id, b.outreach_team_id) = p_owner_id
  );
$$;

-- Header and members: finance, or the budget's owner (the header freeze is
-- in the budgets trigger; sections use can_edit_budget_sections below).
CREATE OR REPLACE FUNCTION public.can_manage_budget(p_budget_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_edit_all_budgets() OR public.is_budget_member(p_budget_id, 'owner');
$$;

-- Lines: never on an approved budget. Finance otherwise; owners and editors
-- only while the budget is a live draft.
CREATE OR REPLACE FUNCTION public.can_edit_budget_lines(p_budget_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budgets b
     WHERE b.id = p_budget_id
       AND b.status <> 'approved'
       AND (public.can_edit_all_budgets()
            OR (b.status = 'draft' AND b.archived_at IS NULL
                AND public.is_budget_member(p_budget_id, 'editor')))
  );
$$;

-- Sections (label, order): never on an approved budget. Finance otherwise;
-- owners only while the budget is a live draft. Same freeze as the header.
CREATE OR REPLACE FUNCTION public.can_edit_budget_sections(p_budget_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budgets b
     WHERE b.id = p_budget_id
       AND b.status <> 'approved'
       AND (public.can_edit_all_budgets()
            OR (b.status = 'draft' AND b.archived_at IS NULL
                AND public.is_budget_member(p_budget_id, 'owner')))
  );
$$;

-- Who may create a budget for an owner from scratch.
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

-- Who may insert this budget row: anyone above, or (for a copy) the owner of
-- the budget it is copied from, or (from a saved template) someone who owns
-- a live budget of the template's owner. The new budget must keep that owner.
CREATE OR REPLACE FUNCTION public.can_create_budget_row(
  p_owner_kind text, p_staff_ministry_id uuid, p_subcategory_id uuid, p_program_id uuid,
  p_event_id uuid, p_outreach_team_id uuid, p_source_budget_id uuid, p_source_template_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH o AS (
    SELECT public.budget_owner_id(p_staff_ministry_id, p_subcategory_id, p_program_id, p_event_id, p_outreach_team_id) AS id
  )
  SELECT public.can_create_budget_for(p_owner_kind, p_staff_ministry_id, p_subcategory_id)
      OR (p_source_budget_id IS NOT NULL
          AND public.is_budget_member(p_source_budget_id, 'owner')
          AND public.budget_has_owner(p_source_budget_id, p_owner_kind, (SELECT id FROM o)))
      OR (p_source_template_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.budget_templates t
             WHERE t.id = p_source_template_id
               AND t.owner_kind = p_owner_kind
               AND public.budget_owner_id(t.staff_ministry_id, t.subcategory_id, t.program_id, t.event_id, t.outreach_team_id)
                   = (SELECT id FROM o)
               AND public.is_member_of_budget_owner(p_owner_kind, (SELECT id FROM o), 'owner')));
$$;

-- Who can see (and so use) a template: anyone signed in for the standard
-- ones; for a saved one, finance, members of its source budget, leaders of
-- its owner, and members of any live budget of the same owner.
CREATE OR REPLACE FUNCTION public.can_see_budget_template(p_template_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budget_templates t
     WHERE t.id = p_template_id
       AND auth.uid() IS NOT NULL
       AND (t.owner_kind IS NULL
            OR public.can_view_all_budgets()
            OR (t.source_budget_id IS NOT NULL AND public.is_budget_member(t.source_budget_id))
            OR public.can_create_budget_for(t.owner_kind, t.staff_ministry_id, t.subcategory_id)
            OR public.is_member_of_budget_owner(
                 t.owner_kind,
                 public.budget_owner_id(t.staff_ministry_id, t.subcategory_id, t.program_id, t.event_id, t.outreach_team_id)))
  );
$$;

-- Who may change a template: finance; for a saved one, also whoever can
-- manage its source budget.
CREATE OR REPLACE FUNCTION public.can_manage_budget_template(p_template_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_edit_all_budgets()
      OR EXISTS (SELECT 1 FROM public.budget_templates t
                  WHERE t.id = p_template_id
                    AND t.source_budget_id IS NOT NULL
                    AND public.can_manage_budget(t.source_budget_id));
$$;


-- ────────────────────────────────────────────────────────────
-- 7. Coding helpers
-- ────────────────────────────────────────────────────────────

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

-- The coding to copy from a budget line or a template line, with every
-- account / tracking option that is no longer active in the mirror
-- (archived, or missing from Xero) taken out. dropped = something was taken
-- out. Finance-only data: not callable by anyone but the trigger functions.
CREATE OR REPLACE FUNCTION public.budget_source_coding(p_source_line_id uuid, p_source_template_line_id uuid)
RETURNS TABLE (org_region text, account_id uuid, tracking_option_1_id uuid,
               tracking_option_2_id uuid, source text, dropped boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH src AS (
    SELECT c.org_region, c.account_id, c.tracking_option_1_id AS t1, c.tracking_option_2_id AS t2, c.source
      FROM public.budget_line_coding c WHERE c.line_id = p_source_line_id
    UNION ALL
    SELECT c.org_region, c.account_id, c.tracking_option_1_id, c.tracking_option_2_id, c.source
      FROM public.budget_template_line_coding c WHERE c.template_line_id = p_source_template_line_id
  ),
  chk AS (
    SELECT s.*,
           (s.account_id IS NULL OR EXISTS (
              SELECT 1 FROM public.xero_accounts a
               WHERE a.id = s.account_id AND a.status = 'active' AND a.missing_since IS NULL)) AS acc_ok,
           (s.t1 IS NULL OR EXISTS (
              SELECT 1 FROM public.xero_tracking_options o
                JOIN public.xero_tracking_categories tc ON tc.id = o.category_id
               WHERE o.id = s.t1 AND o.status = 'active' AND o.missing_since IS NULL
                 AND tc.status = 'active' AND tc.missing_since IS NULL)) AS t1_ok,
           (s.t2 IS NULL OR EXISTS (
              SELECT 1 FROM public.xero_tracking_options o
                JOIN public.xero_tracking_categories tc ON tc.id = o.category_id
               WHERE o.id = s.t2 AND o.status = 'active' AND o.missing_since IS NULL
                 AND tc.status = 'active' AND tc.missing_since IS NULL)) AS t2_ok
      FROM src s
  )
  SELECT org_region,
         CASE WHEN acc_ok THEN account_id END,
         CASE WHEN t1_ok THEN t1 WHEN t2_ok THEN t2 END,     -- keep the survivors in order
         CASE WHEN t1_ok AND t2_ok THEN t2 END,
         source,
         NOT (acc_ok AND t1_ok AND t2_ok)
    FROM chk;
$$;

REVOKE ALL ON FUNCTION public.budget_source_coding(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The coding status a copied line starts with: needs_coding if the source
-- needed coding, if anything was dropped as inactive, or if no org has an
-- account; otherwise overridden when finance had set any of it, else inherited.
CREATE OR REPLACE FUNCTION public.budget_copied_coding_status(
  p_source_status text, p_source_line_id uuid, p_source_template_line_id uuid
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
           WHEN p_source_status = 'needs_coding'
             OR coalesce(bool_or(c.dropped), false)
             OR NOT coalesce(bool_or(c.account_id IS NOT NULL), false) THEN 'needs_coding'
           WHEN bool_or(c.source = 'finance_override') THEN 'overridden'
           ELSE 'inherited'
         END
    FROM public.budget_source_coding(p_source_line_id, p_source_template_line_id) c;
$$;

REVOKE ALL ON FUNCTION public.budget_copied_coding_status(text, uuid, uuid) FROM PUBLIC, anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- 8. Trigger functions
-- ────────────────────────────────────────────────────────────

-- Budgets: who created it, approval rules, things that never change.
CREATE OR REPLACE FUNCTION public.budgets_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status_fields text[] := ARRAY['status', 'approved_by', 'approved_at', 'archived_at', 'updated_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Every new budget is a draft, whatever was sent. Never approved.
    NEW.created_by  := coalesce(v_uid, NEW.created_by);
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
     OR NEW.source_budget_id IS DISTINCT FROM OLD.source_budget_id
     OR NEW.source_template_id IS DISTINCT FROM OLD.source_template_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A budget''s owner, source, template and creator cannot be changed' USING ERRCODE = '42501';
  END IF;

  IF v_uid IS NOT NULL THEN
    -- An approved budget is frozen: only its status may change (reopen / archive).
    IF OLD.status = 'approved'
       AND (to_jsonb(NEW) - v_status_fields) IS DISTINCT FROM (to_jsonb(OLD) - v_status_fields) THEN
      RAISE EXCEPTION 'An approved budget cannot be changed. The budget approver must reopen it first'
        USING ERRCODE = '42501';
    END IF;
    -- Past draft, only finance changes anything but the status. This is what
    -- keeps the approver (when not also finance) to approve / send back.
    IF OLD.status <> 'draft' AND NOT public.can_edit_all_budgets()
       AND (to_jsonb(NEW) - v_status_fields) IS DISTINCT FROM (to_jsonb(OLD) - v_status_fields) THEN
      RAISE EXCEPTION 'Only finance can change a budget once it is submitted; the approver can only change its status'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Archiving: status and archived_at always agree.
  IF NEW.archived_at IS NOT NULL OR NEW.status = 'archived' THEN
    NEW.status := 'archived';
    NEW.archived_at := coalesce(NEW.archived_at, now());
  END IF;

  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF v_uid IS NOT NULL AND NOT public.can_approve_budgets() THEN
      RAISE EXCEPTION 'Only the budget approver can approve a budget' USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'submitted' THEN
      RAISE EXCEPTION 'Only a submitted budget can be approved' USING ERRCODE = '42501';
    END IF;
    NEW.approved_by := v_uid;
    NEW.approved_at := now();
  ELSIF NEW.status <> 'approved' AND OLD.status = 'approved' THEN
    IF v_uid IS NOT NULL AND NOT public.can_approve_budgets() THEN
      RAISE EXCEPTION 'Only the budget approver can reopen or archive an approved budget' USING ERRCODE = '42501';
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

-- Lines: default category, driver, total, coding status, things that never change.
-- SECURITY DEFINER: it reads coding, which members cannot see.
CREATE OR REPLACE FUNCTION public.budget_lines_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver  numeric;
  v_status  text;
  v_tpl     uuid;
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
    NEW.created_by := coalesce(auth.uid(), NEW.created_by);

    IF NEW.source_line_id IS NOT NULL THEN
      -- A copy may only come from a line the caller can see.
      SELECT l.coding_status INTO v_status FROM public.budget_lines l WHERE l.id = NEW.source_line_id
         AND (auth.uid() IS NULL OR public.can_view_all_budgets() OR public.is_budget_member(l.budget_id));
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Source line not found' USING ERRCODE = '42501';
      END IF;
      NEW.coding_status := public.budget_copied_coding_status(v_status, NEW.source_line_id, NULL);
    ELSIF NEW.source_template_line_id IS NOT NULL THEN
      SELECT tl.coding_status, tl.template_id INTO v_status, v_tpl
        FROM public.budget_template_lines tl WHERE tl.id = NEW.source_template_line_id;
      IF NOT FOUND OR (auth.uid() IS NOT NULL AND NOT public.can_see_budget_template(v_tpl)) THEN
        RAISE EXCEPTION 'Source template line not found' USING ERRCODE = '42501';
      END IF;
      NEW.coding_status := public.budget_copied_coding_status(v_status, NULL, NEW.source_template_line_id);
    ELSE
      NEW.coding_status := CASE WHEN public.budget_category_is_coded(NEW.category_id)
                                THEN 'inherited' ELSE 'needs_coding' END;
    END IF;
  ELSE
    IF NEW.budget_id IS DISTINCT FROM OLD.budget_id
       OR NEW.source_line_id IS DISTINCT FROM OLD.source_line_id
       OR NEW.source_template_line_id IS DISTINCT FROM OLD.source_template_line_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'A line cannot move to another budget or change its source or creator' USING ERRCODE = '42501';
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

-- Copy coding onto a new line — from its source line / template line when it
-- is a copy (inactive mirror rows dropped), otherwise from its category —
-- or onto a line whose category changed (unless finance had overridden it).
CREATE OR REPLACE FUNCTION public.budget_lines_after_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.category_id IS NOT DISTINCT FROM OLD.category_id OR OLD.coding_status = 'overridden' THEN
      RETURN NULL;
    END IF;
    DELETE FROM public.budget_line_coding WHERE line_id = NEW.id;
  ELSIF NEW.source_line_id IS NOT NULL OR NEW.source_template_line_id IS NOT NULL THEN
    INSERT INTO public.budget_line_coding
      (line_id, org_region, account_id, tracking_option_1_id, tracking_option_2_id, source)
    SELECT NEW.id, c.org_region, c.account_id, c.tracking_option_1_id, c.tracking_option_2_id, c.source
      FROM public.budget_source_coding(NEW.source_line_id, NEW.source_template_line_id) c;
    RETURN NULL;
  END IF;

  INSERT INTO public.budget_line_coding
    (line_id, org_region, account_id, tracking_option_1_id, tracking_option_2_id, source)
  SELECT NEW.id, cc.org_region, cc.account_id, cc.tracking_option_1_id, cc.tracking_option_2_id, 'category_default'
    FROM public.budget_category_coding cc
   WHERE cc.category_id = NEW.category_id;
  RETURN NULL;
END;
$$;

-- Template lines: default category; a line saved from a budget must come
-- from that template's source budget and keeps the source's coding status.
CREATE OR REPLACE FUNCTION public.budget_template_lines_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.category_id IS NULL THEN
    SELECT id INTO NEW.category_id FROM public.budget_categories WHERE key = 'not_sure_yet';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.source_line_id IS NOT NULL THEN
      SELECT l.coding_status INTO v_status
        FROM public.budget_lines l
        JOIN public.budget_templates t ON t.id = NEW.template_id AND t.source_budget_id = l.budget_id
       WHERE l.id = NEW.source_line_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A template line can only be saved from the template''s own source budget' USING ERRCODE = '42501';
      END IF;
      NEW.coding_status := v_status;
    ELSE
      NEW.coding_status := CASE WHEN public.budget_category_is_coded(NEW.category_id)
                                THEN 'inherited' ELSE 'needs_coding' END;
    END IF;
  ELSE
    IF NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.source_line_id IS DISTINCT FROM OLD.source_line_id THEN
      RAISE EXCEPTION 'A template line cannot move or change its source' USING ERRCODE = '42501';
    END IF;
    IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
      NEW.coding_status := CASE WHEN public.budget_category_is_coded(NEW.category_id)
                                THEN 'inherited' ELSE 'needs_coding' END;
    ELSIF auth.uid() IS NOT NULL AND NOT public.can_manage_budget_codes() THEN
      NEW.coding_status := OLD.coding_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Template line coding: copied from the source line (as it is — re-checked
-- only when a budget is made from the template), else from the category.
CREATE OR REPLACE FUNCTION public.budget_template_lines_after_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN
      RETURN NULL;
    END IF;
    DELETE FROM public.budget_template_line_coding WHERE template_line_id = NEW.id;
  ELSIF NEW.source_line_id IS NOT NULL THEN
    INSERT INTO public.budget_template_line_coding
      (template_line_id, org_region, account_id, tracking_option_1_id, tracking_option_2_id, source)
    SELECT NEW.id, c.org_region, c.account_id, c.tracking_option_1_id, c.tracking_option_2_id, c.source
      FROM public.budget_line_coding c
     WHERE c.line_id = NEW.source_line_id;
    RETURN NULL;
  END IF;

  INSERT INTO public.budget_template_line_coding
    (template_line_id, org_region, account_id, tracking_option_1_id, tracking_option_2_id, source)
  SELECT NEW.id, cc.org_region, cc.account_id, cc.tracking_option_1_id, cc.tracking_option_2_id, 'category_default'
    FROM public.budget_category_coding cc
   WHERE cc.category_id = NEW.category_id;
  RETURN NULL;
END;
$$;

-- Coding rows (all three tables): the account and options belong to the
-- row's organisation, and the two options come from different tracking
-- categories (Xero allows one option per category on a line).
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

  -- A direct write to a line's coding is a finance override; the copies made
  -- by the line triggers run one trigger level deeper.
  IF TG_TABLE_NAME IN ('budget_line_coding', 'budget_template_line_coding') AND pg_trigger_depth() = 1 THEN
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
    RETURN NULL;                                  -- a copy, not finance
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
-- 9. Triggers
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

DROP TRIGGER IF EXISTS trg_budget_template_lines_before_write ON public.budget_template_lines;
CREATE TRIGGER trg_budget_template_lines_before_write
  BEFORE INSERT OR UPDATE ON public.budget_template_lines
  FOR EACH ROW EXECUTE FUNCTION public.budget_template_lines_before_write();

DROP TRIGGER IF EXISTS trg_budget_template_lines_after_write ON public.budget_template_lines;
CREATE TRIGGER trg_budget_template_lines_after_write
  AFTER INSERT OR UPDATE OF category_id ON public.budget_template_lines
  FOR EACH ROW EXECUTE FUNCTION public.budget_template_lines_after_write();

DROP TRIGGER IF EXISTS trg_budget_line_coding_before_write ON public.budget_line_coding;
CREATE TRIGGER trg_budget_line_coding_before_write
  BEFORE INSERT OR UPDATE ON public.budget_line_coding
  FOR EACH ROW EXECUTE FUNCTION public.budget_coding_before_write();

DROP TRIGGER IF EXISTS trg_budget_line_coding_after_write ON public.budget_line_coding;
CREATE TRIGGER trg_budget_line_coding_after_write
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_line_coding
  FOR EACH ROW EXECUTE FUNCTION public.budget_line_coding_after_write();

DROP TRIGGER IF EXISTS trg_budget_template_line_coding_before_write ON public.budget_template_line_coding;
CREATE TRIGGER trg_budget_template_line_coding_before_write
  BEFORE INSERT OR UPDATE ON public.budget_template_line_coding
  FOR EACH ROW EXECUTE FUNCTION public.budget_coding_before_write();

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

DROP TRIGGER IF EXISTS trg_budget_template_lines_audit ON public.budget_template_lines;
CREATE TRIGGER trg_budget_template_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_template_lines
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_template_line_coding_audit ON public.budget_template_line_coding;
CREATE TRIGGER trg_budget_template_line_coding_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_template_line_coding
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
-- 10. Functions people call (all SECURITY INVOKER: every insert below is
--     checked by the caller's own RLS, so they can create nothing the
--     caller could not create by hand; every row they write is audited by
--     the triggers above)
-- ────────────────────────────────────────────────────────────

-- A new budget from a template. Standard template → empty budget. Saved
-- template → its sections and lines (coding re-checked). Draft, or
-- submitted when p_submit; never approved.
CREATE OR REPLACE FUNCTION public.create_budget_from_template(
  p_template_id   uuid,
  p_owner_kind    text,
  p_owner_id      uuid,
  p_period_id     uuid,
  p_name          text,
  p_currency      text DEFAULT NULL,
  p_driver_label  text DEFAULT NULL,
  p_driver_value  numeric DEFAULT NULL,
  p_submit        boolean DEFAULT false
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
  SELECT * INTO v_template FROM public.budget_templates
   WHERE id = p_template_id AND is_active AND archived_at IS NULL;
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
  IF v_template.owner_kind IS NOT NULL
     AND (v_template.owner_kind <> p_owner_kind
          OR public.budget_owner_id(v_template.staff_ministry_id, v_template.subcategory_id, v_template.program_id,
                                    v_template.event_id, v_template.outreach_team_id) <> p_owner_id) THEN
    RAISE EXCEPTION 'This template belongs to another ministry, school or event' USING ERRCODE = '22023';
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
     source_budget_id, source_template_id, driver_label, driver_value)
  VALUES
    (v_id, btrim(p_name), v_template.id, v_template.version, p_period_id,
     coalesce(p_currency, v_template.default_currency), p_owner_kind,
     CASE WHEN p_owner_kind = 'staff_ministry'       THEN p_owner_id END,
     CASE WHEN p_owner_kind = 'ministry_subcategory' THEN p_owner_id END,
     CASE WHEN p_owner_kind = 'program'              THEN p_owner_id END,
     CASE WHEN p_owner_kind = 'event'                THEN p_owner_id END,
     v_template.source_budget_id, v_template.id,
     coalesce(p_driver_label, v_template.driver_label),
     coalesce(p_driver_value, v_template.driver_value));

  INSERT INTO public.budget_sections (budget_id, key, label, sort)
  SELECT v_id, s.key, s.label, s.sort
    FROM public.budget_template_sections s
   WHERE s.template_id = v_template.id;

  -- The standard template has no lines, so this adds nothing for it.
  INSERT INTO public.budget_lines
    (budget_id, section_id, kind, name, category_id, amount_cents, frequency, multiplier,
     uses_driver, sort, notes, source_template_line_id)
  SELECT v_id, s.id, tl.kind, tl.name, tl.category_id, tl.amount_cents, tl.frequency, tl.multiplier,
         tl.uses_driver, tl.sort, tl.notes, tl.id
    FROM public.budget_template_lines tl
    JOIN public.budget_sections s ON s.budget_id = v_id AND s.key = tl.kind
   WHERE tl.template_id = v_template.id AND tl.archived_at IS NULL;

  IF p_submit THEN
    UPDATE public.budgets SET status = 'submitted' WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- Last year's (or quarter's) budget, copied into a new period: same owner,
-- sections, live lines, driver and goals (not funds in hand, notes kept),
-- coding re-checked. Draft, or submitted when p_submit; never approved.
CREATE OR REPLACE FUNCTION public.copy_budget_to_period(
  p_source_budget_id  uuid,
  p_period_id         uuid,
  p_name              text DEFAULT NULL,
  p_submit            boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_src  public.budgets%ROWTYPE;
  v_id   uuid := gen_random_uuid();
BEGIN
  -- RLS: only a budget the caller can see is found.
  SELECT * INTO v_src FROM public.budgets WHERE id = p_source_budget_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget not found' USING ERRCODE = '22023';
  END IF;
  IF v_src.owner_kind = 'outreach_team' THEN
    RAISE EXCEPTION 'Outreach teams keep their own budget for now' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fiscal_periods WHERE id = p_period_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'Period not found or archived' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.budgets
    (id, name, template_id, template_version, period_id, currency, owner_kind,
     staff_ministry_id, subcategory_id, program_id, event_id,
     source_budget_id, source_template_id, driver_label, driver_value,
     funding_goal_cents, income_goal_cents, fundraising_goal_cents, notes)
  VALUES
    (v_id, coalesce(nullif(btrim(p_name), ''), v_src.name), v_src.template_id, v_src.template_version,
     p_period_id, v_src.currency, v_src.owner_kind,
     v_src.staff_ministry_id, v_src.subcategory_id, v_src.program_id, v_src.event_id,
     v_src.id, NULL, v_src.driver_label, v_src.driver_value,
     v_src.funding_goal_cents, v_src.income_goal_cents, v_src.fundraising_goal_cents, v_src.notes);

  INSERT INTO public.budget_sections (budget_id, key, label, sort)
  SELECT v_id, s.key, s.label, s.sort
    FROM public.budget_sections s
   WHERE s.budget_id = v_src.id;

  INSERT INTO public.budget_lines
    (budget_id, section_id, kind, name, category_id, amount_cents, frequency, multiplier,
     uses_driver, sort, notes, source_line_id)
  SELECT v_id, s.id, l.kind, l.name, l.category_id, l.amount_cents, l.frequency, l.multiplier,
         l.uses_driver, l.sort, l.notes, l.id
    FROM public.budget_lines l
    JOIN public.budget_sections s ON s.budget_id = v_id AND s.key = l.kind
   WHERE l.budget_id = v_src.id AND l.archived_at IS NULL;

  IF p_submit THEN
    UPDATE public.budgets SET status = 'submitted' WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- "Save as template": a reusable template scoped to the budget's owner,
-- keeping its sections, live lines, driver, categories and Xero coding.
CREATE OR REPLACE FUNCTION public.save_budget_as_template(
  p_budget_id  uuid,
  p_name       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_b    public.budgets%ROWTYPE;
  v_ff   jsonb;
  v_id   uuid := gen_random_uuid();
BEGIN
  SELECT * INTO v_b FROM public.budgets WHERE id = p_budget_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget not found' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'A template name is required' USING ERRCODE = '22023';
  END IF;
  SELECT t.funding_fields INTO v_ff FROM public.budget_templates t WHERE t.id = v_b.template_id;

  INSERT INTO public.budget_templates
    (id, key, name, version, is_active, applies_to, default_currency, funding_fields,
     owner_kind, staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id,
     source_budget_id, driver_label, driver_value, created_by)
  VALUES
    (v_id, NULL, btrim(p_name), 1, true, ARRAY[v_b.owner_kind], v_b.currency, coalesce(v_ff, '[]'::jsonb),
     v_b.owner_kind, v_b.staff_ministry_id, v_b.subcategory_id, v_b.program_id, v_b.event_id, v_b.outreach_team_id,
     v_b.id, v_b.driver_label, v_b.driver_value, auth.uid());

  INSERT INTO public.budget_template_sections (template_id, key, label, sort)
  SELECT v_id, s.key, s.label, s.sort
    FROM public.budget_sections s
   WHERE s.budget_id = v_b.id;

  INSERT INTO public.budget_template_lines
    (template_id, kind, name, category_id, amount_cents, frequency, multiplier,
     uses_driver, sort, notes, source_line_id)
  SELECT v_id, l.kind, l.name, l.category_id, l.amount_cents, l.frequency, l.multiplier,
         l.uses_driver, l.sort, l.notes, l.id
    FROM public.budget_lines l
   WHERE l.budget_id = v_b.id AND l.archived_at IS NULL;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_budget_from_template(uuid, text, uuid, uuid, text, text, text, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_budget_from_template(uuid, text, uuid, uuid, text, text, text, numeric, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.copy_budget_to_period(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_budget_to_period(uuid, uuid, text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_budget_as_template(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_budget_as_template(uuid, text) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────
-- 11. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.budget_categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_category_coding      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_templates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_template_sections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_template_lines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_template_line_coding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_sections             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_members              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_lines                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_line_coding          ENABLE ROW LEVEL SECURITY;

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

-- Templates: standard ones for everyone signed in; saved ones for their
-- owner's people and finance. Saved by finance, or by the owner of the
-- budget they come from (scoped to that budget's owner).
DROP POLICY IF EXISTS "Signed-in users read budget templates" ON public.budget_templates;
DROP POLICY IF EXISTS "Read budget templates in scope" ON public.budget_templates;
CREATE POLICY "Read budget templates in scope"
  ON public.budget_templates FOR SELECT
  USING (public.can_see_budget_template(id));

DROP POLICY IF EXISTS "Finance adds budget templates" ON public.budget_templates;
DROP POLICY IF EXISTS "Finance and budget owners save templates" ON public.budget_templates;
CREATE POLICY "Finance and budget owners save templates"
  ON public.budget_templates FOR INSERT
  WITH CHECK (
    public.can_edit_all_budgets()
    OR (source_budget_id IS NOT NULL
        AND public.can_manage_budget(source_budget_id)
        AND public.budget_has_owner(
              source_budget_id, owner_kind,
              public.budget_owner_id(staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id)))
  );

DROP POLICY IF EXISTS "Finance edits budget templates" ON public.budget_templates;
DROP POLICY IF EXISTS "Template managers edit templates" ON public.budget_templates;
CREATE POLICY "Template managers edit templates"
  ON public.budget_templates FOR UPDATE
  USING (public.can_manage_budget_template(id))
  WITH CHECK (public.can_manage_budget_template(id));

DROP POLICY IF EXISTS "Signed-in users read template sections" ON public.budget_template_sections;
DROP POLICY IF EXISTS "Read template sections in scope" ON public.budget_template_sections;
CREATE POLICY "Read template sections in scope"
  ON public.budget_template_sections FOR SELECT
  USING (public.can_see_budget_template(template_id));

DROP POLICY IF EXISTS "Finance adds template sections" ON public.budget_template_sections;
DROP POLICY IF EXISTS "Template managers add sections" ON public.budget_template_sections;
CREATE POLICY "Template managers add sections"
  ON public.budget_template_sections FOR INSERT
  WITH CHECK (public.can_manage_budget_template(template_id));

DROP POLICY IF EXISTS "Finance edits template sections" ON public.budget_template_sections;
DROP POLICY IF EXISTS "Template managers edit sections" ON public.budget_template_sections;
CREATE POLICY "Template managers edit sections"
  ON public.budget_template_sections FOR UPDATE
  USING (public.can_manage_budget_template(template_id))
  WITH CHECK (public.can_manage_budget_template(template_id));

DROP POLICY IF EXISTS "Read template lines in scope" ON public.budget_template_lines;
CREATE POLICY "Read template lines in scope"
  ON public.budget_template_lines FOR SELECT
  USING (public.can_see_budget_template(template_id));

DROP POLICY IF EXISTS "Template managers add lines" ON public.budget_template_lines;
CREATE POLICY "Template managers add lines"
  ON public.budget_template_lines FOR INSERT
  WITH CHECK (public.can_manage_budget_template(template_id));

DROP POLICY IF EXISTS "Template managers edit lines" ON public.budget_template_lines;
CREATE POLICY "Template managers edit lines"
  ON public.budget_template_lines FOR UPDATE
  USING (public.can_manage_budget_template(template_id))
  WITH CHECK (public.can_manage_budget_template(template_id));

-- Template line coding: finance only (copies are written by the triggers).
DROP POLICY IF EXISTS "Finance reads template line coding" ON public.budget_template_line_coding;
CREATE POLICY "Finance reads template line coding"
  ON public.budget_template_line_coding FOR SELECT
  USING (public.can_view_all_budgets() OR public.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance adds template line coding" ON public.budget_template_line_coding;
CREATE POLICY "Finance adds template line coding"
  ON public.budget_template_line_coding FOR INSERT
  WITH CHECK (public.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance edits template line coding" ON public.budget_template_line_coding;
CREATE POLICY "Finance edits template line coding"
  ON public.budget_template_line_coding FOR UPDATE
  USING (public.can_manage_budget_codes())
  WITH CHECK (public.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance removes template line coding" ON public.budget_template_line_coding;
CREATE POLICY "Finance removes template line coding"
  ON public.budget_template_line_coding FOR DELETE
  USING (public.can_manage_budget_codes());

-- Budgets.
DROP POLICY IF EXISTS "Finance and members read budgets" ON public.budgets;
CREATE POLICY "Finance and members read budgets"
  ON public.budgets FOR SELECT
  USING (public.can_view_all_budgets() OR public.is_budget_member(id));

DROP POLICY IF EXISTS "Finance and ministry leaders create budgets" ON public.budgets;
DROP POLICY IF EXISTS "Finance, leaders and budget owners create budgets" ON public.budgets;
CREATE POLICY "Finance, leaders and budget owners create budgets"
  ON public.budgets FOR INSERT
  WITH CHECK (public.can_create_budget_row(
    owner_kind, staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id,
    source_budget_id, source_template_id));

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

-- The approver approves, sends back or reopens. The trigger lets someone who
-- is ONLY the approver change the status and nothing else.
DROP POLICY IF EXISTS "Approver decides on submitted budgets" ON public.budgets;
CREATE POLICY "Approver decides on submitted budgets"
  ON public.budgets FOR UPDATE
  USING (public.can_approve_budgets() AND status IN ('submitted', 'approved') AND archived_at IS NULL)
  WITH CHECK (public.can_approve_budgets() AND status IN ('draft', 'submitted', 'approved'));

-- Sections.
DROP POLICY IF EXISTS "Finance and members read budget sections" ON public.budget_sections;
CREATE POLICY "Finance and members read budget sections"
  ON public.budget_sections FOR SELECT
  USING (public.can_view_all_budgets() OR public.is_budget_member(budget_id));

DROP POLICY IF EXISTS "Budget managers add sections" ON public.budget_sections;
CREATE POLICY "Budget managers add sections"
  ON public.budget_sections FOR INSERT
  WITH CHECK (public.can_edit_budget_sections(budget_id));

DROP POLICY IF EXISTS "Budget managers edit sections" ON public.budget_sections;
CREATE POLICY "Budget managers edit sections"
  ON public.budget_sections FOR UPDATE
  USING (public.can_edit_budget_sections(budget_id))
  WITH CHECK (public.can_edit_budget_sections(budget_id));

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
-- 12. Seed: "Not sure yet" and the empty standard team template
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
-- 13. Comments
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
  'Budget templates. Built-in ones (key set, e.g. team_standard) have sections only, so a budget made from them starts empty. Saved ones (save_budget_as_template) also have lines and coding, are scoped to one owner and remember source_budget_id. Budgets record the template and version they came from and are never re-synced.';
COMMENT ON COLUMN public.budget_templates.key IS
  'Stable handle for built-in templates (''team_standard''). NULL for templates saved from a budget.';
COMMENT ON COLUMN public.budget_templates.applies_to IS
  'Owner kinds the template may be used for. outreach_team is allowed in the type but not offered yet.';
COMMENT ON COLUMN public.budget_templates.funding_fields IS
  'Which funding rows the overview shows: [{key, label}], keys are budgets.*_cents columns.';
COMMENT ON COLUMN public.budget_templates.owner_kind IS
  'Scope. NULL = any owner may use it (the standard template). Otherwise only this one owner (the matching *_id column), and finance.';
COMMENT ON COLUMN public.budget_templates.source_budget_id IS
  'The budget this template was saved from. Budgets made from the template carry it as their own source_budget_id, for year-over-year comparison.';

COMMENT ON TABLE public.budget_template_sections IS
  'The sections a template copies onto a new budget. Only fixed and variable hold lines (holds_lines).';
COMMENT ON TABLE public.budget_template_lines IS
  'Planning lines of a saved template: amount, frequency, multiplier, driver use, category. No actuals, receipts, approvals or history. Copied onto every budget made from the template.';
COMMENT ON COLUMN public.budget_template_lines.source_line_id IS
  'The budget line this template line was saved from (must belong to the template''s source budget).';
COMMENT ON TABLE public.budget_template_line_coding IS
  'Xero coding of a template line per organisation, copied from the source line as it was. Re-checked against the mirror when a budget is made from the template. Finance only.';

COMMENT ON TABLE public.budgets IS
  'One budget for one owner (staff ministry, ministry sub-category, school or event) and one fiscal period. Created by create_budget_from_template() or copy_budget_to_period(); always starts as a draft. Money in cents. Archived, never deleted. Members see their own; finance sees all.';
COMMENT ON COLUMN public.budgets.owner_kind IS
  'Which owner column is set: staff_ministry, ministry_subcategory, program, event (or outreach_team, reserved). Exactly one owner column is non-null and it matches this.';
COMMENT ON COLUMN public.budgets.template_version IS
  'The template version this budget was copied from. The budget is never updated when the template changes.';
COMMENT ON COLUMN public.budgets.source_budget_id IS
  'The earlier budget this one continues: the budget it was copied from, or the one its saved template was made from. Pairs budgets for year-over-year comparison (v_budget_yoy).';
COMMENT ON COLUMN public.budgets.source_template_id IS
  'The template this budget was created from by create_budget_from_template. NULL for a direct copy.';
COMMENT ON COLUMN public.budgets.currency IS
  'ZAR or USD. No currency conversion anywhere.';
COMMENT ON COLUMN public.budgets.status IS
  'draft → submitted → approved, or archived. New budgets are always drafts. Only budget.approve (Budget Approver role) approves a submitted budget or reopens an approved one; an approved budget cannot be changed until reopened.';
COMMENT ON COLUMN public.budgets.approved_by IS
  'Set by the trigger to the approver when the budget is approved; cleared when it is reopened. Never taken from the client.';
COMMENT ON COLUMN public.budgets.driver_label IS
  'What the budget''s driver counts, e.g. "volunteers".';
COMMENT ON COLUMN public.budgets.driver_value IS
  'The driver''s number, e.g. 8. Lines with uses_driver take it as their multiplier and are recomputed when it changes.';
COMMENT ON COLUMN public.budgets.funding_goal_cents IS
  'Funding row from the old sheet, in cents. Optional.';
COMMENT ON COLUMN public.budgets.archived_at IS
  'Set instead of deleting. Also sets status to archived.';

COMMENT ON TABLE public.budget_sections IS
  'A budget''s sections, copied at creation: overview, dashboard, variable, fixed, expense_tracker, notes. Lines live in fixed and variable only.';

COMMENT ON TABLE public.budget_members IS
  'Who can see or edit ONE budget: owner (header, members, lines, save as template, copy to a new period), editor (lines while draft), viewer (read). The creator becomes owner automatically.';

COMMENT ON TABLE public.budget_lines IS
  'A cost on a budget. Total = round(amount_cents × frequency × multiplier), computed by trigger. Fixed lines have frequency 1 and a quantity as multiplier. Archived, never deleted; ids are stable so receipts can attach later.';
COMMENT ON COLUMN public.budget_lines.kind IS
  'fixed (one-off purchase) or variable (repeating cost). Must match the section''s key.';
COMMENT ON COLUMN public.budget_lines.category_id IS
  'Friendly category; a new line''s coding is copied from it (unless the line is a copy). Left empty, the line goes to "Not sure yet".';
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
  'inherited (coding from a coded category), overridden (finance set it), needs_coding (Not sure yet, no account yet, or a copied account / tracking option is no longer active in Xero — finance''s queue). Only finance changes it by hand.';
COMMENT ON COLUMN public.budget_lines.source_line_id IS
  'The line this one was copied from (copy_budget_to_period). Its coding was copied with inactive mirror rows dropped.';
COMMENT ON COLUMN public.budget_lines.source_template_line_id IS
  'The template line this one was created from (create_budget_from_template with a saved template).';

COMMENT ON TABLE public.budget_line_coding IS
  'Xero coding of a budget line per organisation: account + up to two tracking options (mirror uuids). Copied from the category, or from the source line / template line for copies; only finance changes it. Finance only.';
COMMENT ON COLUMN public.budget_line_coding.source IS
  'category_default (from a category) or finance_override (finance wrote it). Kept as-is when coding is copied.';

COMMENT ON FUNCTION public.create_budget_from_template(uuid, text, uuid, uuid, text, text, text, numeric, boolean) IS
  'Creates a budget from a template: the standard template gives an EMPTY budget (sections, zero lines); a saved template also gives its lines and coding (inactive Xero rows dropped, line flagged needs_coding). Draft, or submitted when p_submit; never approved. Scoped templates only for their own owner. SECURITY INVOKER: RLS decides who may create what. Returns the new budget id.';
COMMENT ON FUNCTION public.copy_budget_to_period(uuid, uuid, text, boolean) IS
  'Copies a budget the caller can see into another period for the same owner: sections, live lines, driver, goals (not funds in hand) and notes; coding re-checked. Draft, or submitted when p_submit; never approved. Stores source_budget_id. The caller must own the source budget (or be finance / a leader of the owner). SECURITY INVOKER. Returns the new budget id.';
COMMENT ON FUNCTION public.save_budget_as_template(uuid, text) IS
  'Saves a budget as a reusable template scoped to the budget''s owner: sections, live lines, driver, categories and Xero coding — no approvals, history, actuals or receipts. Finance or the budget''s owner. SECURITY INVOKER. Returns the new template id.';
COMMENT ON FUNCTION public.is_budget_member(uuid, text) IS
  'True when the current user is a member of the budget with at least the given role (viewer < editor < owner).';


-- ============================================================
-- Verify:
--   SELECT key, name FROM public.budget_categories;              -- not_sure_yet only
--   SELECT count(*) FROM public.budget_category_coding;          -- 0 (no codes invented)
--   SELECT t.name, s.key, s.holds_lines FROM public.budget_templates t
--     JOIN public.budget_template_sections s ON s.template_id = t.id ORDER BY s.sort;
--                                        -- six sections, fixed + variable hold lines
--   SELECT count(*) FROM public.budget_template_lines;           -- 0 (standard template is empty)
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'budget%' AND relkind = 'r';
--                                                                -- all true
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (run 279's rollback first):
--   WARNING: deletes every budget, template, line, member and coding row.
--   Their history stays in finance_audit_log until 277 is rolled back.
--
--   DROP FUNCTION IF EXISTS public.save_budget_as_template(uuid, text);
--   DROP FUNCTION IF EXISTS public.copy_budget_to_period(uuid, uuid, text, boolean);
--   DROP FUNCTION IF EXISTS public.create_budget_from_template(uuid, text, uuid, uuid, text, text, text, numeric, boolean);
--   DROP TABLE IF EXISTS public.budget_line_coding CASCADE;
--   DROP TABLE IF EXISTS public.budget_template_line_coding CASCADE;
--   DROP TABLE IF EXISTS public.budget_lines CASCADE;
--   DROP TABLE IF EXISTS public.budget_template_lines CASCADE;
--   DROP TABLE IF EXISTS public.budget_members CASCADE;
--   DROP TABLE IF EXISTS public.budget_sections CASCADE;
--   DROP TABLE IF EXISTS public.budgets CASCADE;
--   DROP TABLE IF EXISTS public.budget_template_sections CASCADE;
--   DROP TABLE IF EXISTS public.budget_templates CASCADE;
--   DROP TABLE IF EXISTS public.budget_category_coding CASCADE;
--   DROP TABLE IF EXISTS public.budget_categories CASCADE;
--   DROP FUNCTION IF EXISTS public.budget_line_coding_after_write();
--   DROP FUNCTION IF EXISTS public.budget_coding_before_write();
--   DROP FUNCTION IF EXISTS public.budget_template_lines_after_write();
--   DROP FUNCTION IF EXISTS public.budget_template_lines_before_write();
--   DROP FUNCTION IF EXISTS public.budget_lines_after_write();
--   DROP FUNCTION IF EXISTS public.budget_lines_before_write();
--   DROP FUNCTION IF EXISTS public.budget_copied_coding_status(text, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.budget_source_coding(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.budget_category_is_coded(uuid);
--   DROP FUNCTION IF EXISTS public.budgets_driver_changed();
--   DROP FUNCTION IF EXISTS public.budgets_after_insert();
--   DROP FUNCTION IF EXISTS public.budgets_before_write();
--   DROP FUNCTION IF EXISTS public.can_manage_budget_template(uuid);
--   DROP FUNCTION IF EXISTS public.can_see_budget_template(uuid);
--   DROP FUNCTION IF EXISTS public.can_create_budget_row(text, uuid, uuid, uuid, uuid, uuid, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.can_create_budget_for(text, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.can_edit_budget_sections(uuid);
--   DROP FUNCTION IF EXISTS public.can_edit_budget_lines(uuid);
--   DROP FUNCTION IF EXISTS public.can_manage_budget(uuid);
--   DROP FUNCTION IF EXISTS public.budget_has_owner(uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.is_member_of_budget_owner(text, uuid, text);
--   DROP FUNCTION IF EXISTS public.is_budget_member(uuid, text);
--   DROP FUNCTION IF EXISTS public.budget_owner_id(uuid, uuid, uuid, uuid, uuid);
-- ------------------------------------------------------------
