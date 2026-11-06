-- DRAFT ONLY. DO NOT APPLY to production.
-- Replaces the unapplied #475 file 278_budgets_core.sql. Same approval rules.
-- One entity (typed FK, including outreach_team_id) and one responsible
-- person: a single budget_members row with role owner. Editors and viewers
-- stay on that same table.
-- One finance org per budget; currency must match that org's record_currency;
-- org, currency and period are frozen on the header. Coding is one row per line
-- and must use that org's Xero region. No outreach import and no ministry-name
-- mapping onto finance_projects. Depends on 295 and on applied 275/290/291.
-- Numbered 296. Once-only; not safe to re-run.

ALTER TABLE public.finance_orgs ADD CONSTRAINT finance_orgs_id_currency_budget_key UNIQUE(id,record_currency);


CREATE OR REPLACE FUNCTION public.budget_owner_id(
  p_staff_ministry_id uuid, p_subcategory_id uuid, p_program_id uuid, p_event_id uuid, p_outreach_team_id uuid
)
RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_staff_ministry_id, p_subcategory_id, p_program_id, p_event_id, p_outreach_team_id);
$$;


CREATE TABLE IF NOT EXISTS public.budget_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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


CREATE TABLE IF NOT EXISTS public.budget_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key               text UNIQUE,
  name              text NOT NULL CHECK (btrim(name) <> ''),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_active         boolean NOT NULL DEFAULT true,
  applies_to        text[] NOT NULL DEFAULT ARRAY['staff_ministry', 'ministry_subcategory', 'program', 'event'],
  org_id            uuid REFERENCES public.finance_orgs(id) ON DELETE RESTRICT,
  default_currency  text NOT NULL DEFAULT 'ZAR' CHECK (default_currency IN ('ZAR', 'USD')),
  funding_fields    jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_kind        text CHECK (owner_kind IN ('staff_ministry', 'ministry_subcategory', 'program', 'event', 'outreach_team')),
  staff_ministry_id uuid REFERENCES public.staff_ministries(id) ON DELETE RESTRICT,
  subcategory_id    uuid REFERENCES public.staff_ministry_subcategories(id) ON DELETE RESTRICT,
  program_id        uuid REFERENCES public.programs(id) ON DELETE RESTRICT,
  event_id          uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  outreach_team_id  uuid REFERENCES public.outreach_teams(id) ON DELETE RESTRICT,
  source_budget_id  uuid,
  driver_label      text,
  driver_value      numeric(10,2) CHECK (driver_value >= 0),
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz,
  CONSTRAINT budget_templates_org_currency_fkey FOREIGN KEY(org_id,default_currency) REFERENCES public.finance_orgs(id,record_currency) ON DELETE RESTRICT,
  CONSTRAINT budget_templates_org_scope_check CHECK ((owner_kind IS NULL AND org_id IS NULL) OR (owner_kind IS NOT NULL AND org_id IS NOT NULL)),
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

CREATE UNIQUE INDEX IF NOT EXISTS budget_templates_live_scope_name_key
  ON public.budget_templates (
    org_id, owner_kind,
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


CREATE TABLE IF NOT EXISTS public.budgets (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL CHECK (btrim(name) <> ''),
  template_id             uuid NOT NULL REFERENCES public.budget_templates(id) ON DELETE RESTRICT,
  template_version        integer NOT NULL,
  org_id                  uuid NOT NULL REFERENCES public.finance_orgs(id) ON DELETE RESTRICT,
  period_id               uuid NOT NULL,
  currency                text NOT NULL CHECK (currency IN ('ZAR', 'USD')),
  owner_kind              text NOT NULL
                          CHECK (owner_kind IN ('staff_ministry', 'ministry_subcategory', 'program', 'event', 'outreach_team')),
  staff_ministry_id       uuid REFERENCES public.staff_ministries(id) ON DELETE RESTRICT,
  subcategory_id          uuid REFERENCES public.staff_ministry_subcategories(id) ON DELETE RESTRICT,
  program_id              uuid REFERENCES public.programs(id) ON DELETE RESTRICT,
  event_id                uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  outreach_team_id        uuid REFERENCES public.outreach_teams(id) ON DELETE RESTRICT,
  source_budget_id        uuid REFERENCES public.budgets(id) ON DELETE RESTRICT,
  source_template_id      uuid REFERENCES public.budget_templates(id) ON DELETE RESTRICT,
  status                  text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'submitted', 'approved', 'archived')),
  driver_label            text,
  driver_value            numeric(10,2) CHECK (driver_value >= 0),
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
  CONSTRAINT budgets_org_currency_fkey FOREIGN KEY(org_id,currency) REFERENCES public.finance_orgs(id,record_currency) ON DELETE RESTRICT,
  CONSTRAINT budgets_period_org_fkey FOREIGN KEY(period_id,org_id) REFERENCES public.fiscal_periods(id,org_id) ON DELETE RESTRICT,
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

CREATE UNIQUE INDEX IF NOT EXISTS budgets_live_owner_period_name_key
  ON public.budgets (
    org_id, owner_kind,
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

ALTER TABLE public.budget_templates DROP CONSTRAINT IF EXISTS budget_templates_source_budget_id_fkey;
ALTER TABLE public.budget_templates ADD CONSTRAINT budget_templates_source_budget_id_fkey
  FOREIGN KEY (source_budget_id) REFERENCES public.budgets(id) ON DELETE RESTRICT;


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

-- One responsible person. Editors and viewers are unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS budget_members_one_responsible_owner
  ON public.budget_members (budget_id)
  WHERE role = 'owner';

CREATE INDEX IF NOT EXISTS idx_budget_members_user ON public.budget_members (user_id);

CREATE TABLE IF NOT EXISTS public.budget_lines (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id                uuid NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  section_id               uuid NOT NULL,
  kind                     text NOT NULL CHECK (kind IN ('fixed', 'variable')),
  name                     text NOT NULL CHECK (btrim(name) <> ''),
  category_id              uuid NOT NULL REFERENCES public.budget_categories(id) ON DELETE RESTRICT,
  amount_cents             bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  frequency                numeric(10,2) NOT NULL DEFAULT 1 CHECK (frequency >= 0),
  multiplier               numeric(10,2) NOT NULL DEFAULT 1 CHECK (multiplier >= 0),
  uses_driver              boolean NOT NULL DEFAULT false,
  line_total_cents         bigint NOT NULL DEFAULT 0,
  sort                     integer NOT NULL DEFAULT 0,
  notes                    text,
  coding_status            text NOT NULL DEFAULT 'needs_coding'
                           CHECK (coding_status IN ('inherited', 'overridden', 'needs_coding')),
  source_line_id           uuid REFERENCES public.budget_lines(id) ON DELETE RESTRICT,
  source_template_line_id  uuid,
  created_by               uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz,
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
  CONSTRAINT budget_line_coding_one_org UNIQUE(line_id),
  CONSTRAINT budget_line_coding_tracking_order_check
    CHECK (tracking_option_2_id IS NULL OR tracking_option_1_id IS NOT NULL),
  CONSTRAINT budget_line_coding_tracking_distinct_check
    CHECK (tracking_option_2_id IS NULL OR tracking_option_2_id <> tracking_option_1_id)
);


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
  CONSTRAINT budget_template_line_coding_one_org UNIQUE(template_line_id),
  CONSTRAINT budget_template_line_coding_tracking_order_check
    CHECK (tracking_option_2_id IS NULL OR tracking_option_1_id IS NOT NULL),
  CONSTRAINT budget_template_line_coding_tracking_distinct_check
    CHECK (tracking_option_2_id IS NULL OR tracking_option_2_id <> tracking_option_1_id)
);

ALTER TABLE public.budget_lines DROP CONSTRAINT IF EXISTS budget_lines_source_template_line_id_fkey;
ALTER TABLE public.budget_lines ADD CONSTRAINT budget_lines_source_template_line_id_fkey
  FOREIGN KEY (source_template_line_id) REFERENCES public.budget_template_lines(id) ON DELETE RESTRICT;


CREATE OR REPLACE FUNCTION finance_private.is_budget_member(p_budget_id uuid, p_min_role text DEFAULT 'viewer')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budget_members m
     WHERE m.budget_id = p_budget_id
       AND m.user_id = auth.uid()
       AND CASE m.role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END
           >= CASE p_min_role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END
  );
$$;

CREATE OR REPLACE FUNCTION finance_private.is_member_of_budget_owner(p_owner_kind text, p_owner_id uuid, p_min_role text DEFAULT 'viewer')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budgets b
     WHERE b.owner_kind = p_owner_kind
       AND public.budget_owner_id(b.staff_ministry_id, b.subcategory_id, b.program_id, b.event_id, b.outreach_team_id) = p_owner_id
       AND b.archived_at IS NULL
       AND finance_private.is_budget_member(b.id, p_min_role)
  );
$$;

CREATE OR REPLACE FUNCTION finance_private.budget_has_owner(p_budget_id uuid, p_owner_kind text, p_owner_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budgets b
     WHERE b.id = p_budget_id
       AND b.owner_kind = p_owner_kind
       AND public.budget_owner_id(b.staff_ministry_id, b.subcategory_id, b.program_id, b.event_id, b.outreach_team_id) = p_owner_id
  );
$$;

CREATE OR REPLACE FUNCTION finance_private.can_manage_budget(p_budget_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT finance_private.can_edit_all_budgets() OR finance_private.is_budget_member(p_budget_id, 'owner');
$$;

CREATE OR REPLACE FUNCTION finance_private.can_edit_budget_lines(p_budget_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budgets b
     WHERE b.id = p_budget_id
       AND b.status IN ('draft','submitted') AND b.archived_at IS NULL
       AND (finance_private.can_edit_all_budgets()
            OR (b.status = 'draft' AND b.archived_at IS NULL
                AND finance_private.is_budget_member(p_budget_id, 'editor')))
  );
$$;

CREATE OR REPLACE FUNCTION finance_private.can_edit_budget_sections(p_budget_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budgets b
     WHERE b.id = p_budget_id
       AND b.status IN ('draft','submitted') AND b.archived_at IS NULL
       AND (finance_private.can_edit_all_budgets()
            OR (b.status = 'draft' AND b.archived_at IS NULL
                AND finance_private.is_budget_member(p_budget_id, 'owner')))
  );
$$;

CREATE OR REPLACE FUNCTION finance_private.can_create_budget_for(
  p_owner_kind text, p_staff_ministry_id uuid, p_subcategory_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT finance_private.can_edit_all_budgets()
      OR (p_owner_kind = 'staff_ministry' AND public.leads_staff_ministry(p_staff_ministry_id))
      OR (p_owner_kind = 'ministry_subcategory' AND EXISTS (
            SELECT 1 FROM public.staff_ministry_subcategories s
             WHERE s.id = p_subcategory_id AND public.leads_staff_ministry(s.staff_ministry_id)));
$$;

CREATE OR REPLACE FUNCTION finance_private.can_create_budget_row(
  p_owner_kind text, p_staff_ministry_id uuid, p_subcategory_id uuid, p_program_id uuid,
  p_event_id uuid, p_outreach_team_id uuid, p_source_budget_id uuid, p_source_template_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH o AS (
    SELECT public.budget_owner_id(p_staff_ministry_id, p_subcategory_id, p_program_id, p_event_id, p_outreach_team_id) AS id
  )
  SELECT finance_private.can_create_budget_for(p_owner_kind, p_staff_ministry_id, p_subcategory_id)
      OR (p_source_budget_id IS NOT NULL
          AND finance_private.is_budget_member(p_source_budget_id, 'owner')
          AND finance_private.budget_has_owner(p_source_budget_id, p_owner_kind, (SELECT id FROM o)))
      OR (p_source_template_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.budget_templates t
             WHERE t.id = p_source_template_id
               AND t.owner_kind = p_owner_kind
               AND public.budget_owner_id(t.staff_ministry_id, t.subcategory_id, t.program_id, t.event_id, t.outreach_team_id)
                   = (SELECT id FROM o)
               AND finance_private.is_member_of_budget_owner(p_owner_kind, (SELECT id FROM o), 'owner')));
$$;

CREATE OR REPLACE FUNCTION finance_private.can_see_budget_template(p_template_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budget_templates t
     WHERE t.id = p_template_id
       AND auth.uid() IS NOT NULL
       AND (t.owner_kind IS NULL
            OR finance_private.can_view_all_budgets()
            OR (t.source_budget_id IS NOT NULL AND finance_private.is_budget_member(t.source_budget_id))
            OR finance_private.can_create_budget_for(t.owner_kind, t.staff_ministry_id, t.subcategory_id)
            OR finance_private.is_member_of_budget_owner(
                 t.owner_kind,
                 public.budget_owner_id(t.staff_ministry_id, t.subcategory_id, t.program_id, t.event_id, t.outreach_team_id)))
  );
$$;

CREATE OR REPLACE FUNCTION finance_private.can_manage_budget_template(p_template_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT finance_private.can_edit_all_budgets()
      OR EXISTS (SELECT 1 FROM public.budget_templates t
                  WHERE t.id = p_template_id
                    AND t.source_budget_id IS NOT NULL
                    AND finance_private.can_manage_budget(t.source_budget_id));
$$;



CREATE OR REPLACE FUNCTION finance_private.budget_category_is_coded(p_category_id uuid, p_org_region text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.budget_categories c
      JOIN public.budget_category_coding cc ON cc.category_id = c.id
     WHERE c.id = p_category_id
       AND c.key IS DISTINCT FROM 'not_sure_yet'
       AND cc.org_region=p_org_region
       AND EXISTS(SELECT 1 FROM public.xero_accounts a WHERE a.id=cc.account_id AND a.status='active' AND a.missing_since IS NULL)
  );
$$;

CREATE OR REPLACE FUNCTION finance_private.budget_source_coding(p_source_line_id uuid, p_source_template_line_id uuid)
RETURNS TABLE (org_region text, account_id uuid, tracking_option_1_id uuid,
               tracking_option_2_id uuid, source text, dropped boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
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

REVOKE ALL ON FUNCTION finance_private.budget_source_coding(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION finance_private.budget_copied_coding_status(
  p_source_status text, p_source_line_id uuid, p_source_template_line_id uuid
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
           WHEN p_source_status = 'needs_coding'
             OR coalesce(bool_or(c.dropped), false)
             OR NOT coalesce(bool_or(c.account_id IS NOT NULL), false) THEN 'needs_coding'
           WHEN bool_or(c.source = 'finance_override') THEN 'overridden'
           ELSE 'inherited'
         END
    FROM finance_private.budget_source_coding(p_source_line_id, p_source_template_line_id) c;
$$;

REVOKE ALL ON FUNCTION finance_private.budget_copied_coding_status(text, uuid, uuid) FROM PUBLIC, anon, authenticated;



CREATE OR REPLACE FUNCTION finance_private.budgets_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status_fields text[] := ARRAY['status', 'approved_by', 'approved_at', 'archived_at', 'updated_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(NEW.currency,o.record_currency) INTO NEW.currency FROM public.finance_orgs o WHERE o.id=NEW.org_id AND o.is_active;
    IF NEW.currency IS NULL THEN RAISE EXCEPTION 'Active finance org required' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.fiscal_periods p WHERE p.id=NEW.period_id AND p.org_id=NEW.org_id AND p.archived_at IS NULL) THEN RAISE EXCEPTION 'Active period for selected org required' USING ERRCODE='23514'; END IF;
    IF NEW.owner_kind='outreach_team' THEN RAISE EXCEPTION 'Outreach retains its existing budget model' USING ERRCODE='23514'; END IF;
    IF NEW.source_budget_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.budgets s WHERE s.id=NEW.source_budget_id AND s.org_id=NEW.org_id AND s.owner_kind=NEW.owner_kind AND public.budget_owner_id(s.staff_ministry_id,s.subcategory_id,s.program_id,s.event_id,s.outreach_team_id)=public.budget_owner_id(NEW.staff_ministry_id,NEW.subcategory_id,NEW.program_id,NEW.event_id,NEW.outreach_team_id)) THEN RAISE EXCEPTION 'Source budget has another org/owner' USING ERRCODE='23514'; END IF;
    IF NEW.source_template_id IS NOT NULL AND NEW.source_template_id<>NEW.template_id THEN RAISE EXCEPTION 'Source template must match template_id' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.budget_templates t WHERE t.id=NEW.template_id AND (t.org_id IS NULL OR (t.org_id=NEW.org_id AND t.owner_kind=NEW.owner_kind AND public.budget_owner_id(t.staff_ministry_id,t.subcategory_id,t.program_id,t.event_id,t.outreach_team_id)=public.budget_owner_id(NEW.staff_ministry_id,NEW.subcategory_id,NEW.program_id,NEW.event_id,NEW.outreach_team_id)))) THEN RAISE EXCEPTION 'Template has another org/owner' USING ERRCODE='23514'; END IF;
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

  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.period_id IS DISTINCT FROM OLD.period_id
     OR NEW.owner_kind IS DISTINCT FROM OLD.owner_kind
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
    IF OLD.status = 'approved'
       AND (to_jsonb(NEW) - v_status_fields) IS DISTINCT FROM (to_jsonb(OLD) - v_status_fields) THEN
      RAISE EXCEPTION 'An approved budget cannot be changed. The budget approver must reopen it first'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'draft' AND NOT finance_private.can_edit_all_budgets()
       AND (to_jsonb(NEW) - v_status_fields) IS DISTINCT FROM (to_jsonb(OLD) - v_status_fields) THEN
      RAISE EXCEPTION 'Only finance can change a budget once it is submitted; the approver can only change its status'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.archived_at IS NOT NULL OR NEW.status = 'archived' THEN
    NEW.status := 'archived';
    NEW.archived_at := coalesce(NEW.archived_at, now());
  END IF;

  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF v_uid IS NOT NULL AND NOT finance_private.can_approve_budgets() THEN
      RAISE EXCEPTION 'Only the budget approver can approve a budget' USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'submitted' THEN
      RAISE EXCEPTION 'Only a submitted budget can be approved' USING ERRCODE = '42501';
    END IF;
    NEW.approved_by := v_uid;
    NEW.approved_at := now();
  ELSIF NEW.status <> 'approved' AND OLD.status = 'approved' THEN
    IF v_uid IS NOT NULL AND NOT finance_private.can_approve_budgets() THEN
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

CREATE OR REPLACE FUNCTION finance_private.budgets_after_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_owner uuid := coalesce(auth.uid(), NEW.created_by);
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'A budget needs one responsible owner' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.budget_members (budget_id, user_id, role, added_by)
  VALUES (NEW.id, v_owner, 'owner', auth.uid())
  ON CONFLICT (budget_id, user_id) DO NOTHING;
  RETURN NULL;
END;
$$;

-- The owner row is singular. Hand-off changes that row's user. Editors and
-- viewers can still be added and removed. This is the same members table.
CREATE OR REPLACE FUNCTION finance_private.budget_members_one_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      RAISE EXCEPTION 'The responsible owner stays on the budget. Hand it to someone else by changing that member'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.budget_id IS NULL OR NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'A budget member needs a budget and a user' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'The responsible owner cannot be demoted. Hand the budget on by changing who that member is'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.budget_id IS DISTINCT FROM OLD.budget_id THEN
    RAISE EXCEPTION 'The responsible owner cannot move to another budget' USING ERRCODE = '23514';
  END IF;

  IF NEW.role = 'owner' AND EXISTS (
    SELECT 1 FROM public.budget_members m
     WHERE m.budget_id = NEW.budget_id
       AND m.role = 'owner'
       AND m.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'A budget has one responsible owner' USING ERRCODE = '23505';
  END IF;

  -- The person taking the budget may already be an editor or a viewer.
  IF TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    DELETE FROM public.budget_members
     WHERE budget_id = NEW.budget_id
       AND user_id = NEW.user_id
       AND id IS DISTINCT FROM NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION finance_private.budgets_driver_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.budget_lines
     SET updated_at = now()
   WHERE budget_id = NEW.id AND uses_driver AND archived_at IS NULL;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION finance_private.budget_lines_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
      IF NOT EXISTS(SELECT 1 FROM public.budget_lines sl JOIN public.budgets sb ON sb.id=sl.budget_id JOIN public.budgets tb ON tb.id=NEW.budget_id AND tb.org_id=sb.org_id WHERE sl.id=NEW.source_line_id) THEN RAISE EXCEPTION 'Source line has another org' USING ERRCODE='23514'; END IF;
      SELECT l.coding_status INTO v_status FROM public.budget_lines l WHERE l.id = NEW.source_line_id
         AND (auth.uid() IS NULL OR finance_private.can_view_all_budgets() OR finance_private.is_budget_member(l.budget_id));
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Source line not found' USING ERRCODE = '42501';
      END IF;
      NEW.coding_status := finance_private.budget_copied_coding_status(v_status, NEW.source_line_id, NULL);
    ELSIF NEW.source_template_line_id IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM public.budget_template_lines sl JOIN public.budget_templates st ON st.id=sl.template_id JOIN public.budgets tb ON tb.id=NEW.budget_id AND tb.org_id=st.org_id WHERE sl.id=NEW.source_template_line_id) THEN RAISE EXCEPTION 'Source template line has another org' USING ERRCODE='23514'; END IF;
      SELECT tl.coding_status, tl.template_id INTO v_status, v_tpl
        FROM public.budget_template_lines tl WHERE tl.id = NEW.source_template_line_id;
      IF NOT FOUND OR (auth.uid() IS NOT NULL AND NOT finance_private.can_see_budget_template(v_tpl)) THEN
        RAISE EXCEPTION 'Source template line not found' USING ERRCODE = '42501';
      END IF;
      NEW.coding_status := finance_private.budget_copied_coding_status(v_status, NULL, NEW.source_template_line_id);
    ELSE
      NEW.coding_status := CASE WHEN finance_private.budget_category_is_coded(NEW.category_id,(SELECT o.xero_region FROM public.budgets b JOIN public.finance_orgs o ON o.id=b.org_id WHERE b.id=NEW.budget_id))
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
      NEW.coding_status := CASE WHEN finance_private.budget_category_is_coded(NEW.category_id,(SELECT o.xero_region FROM public.budgets b JOIN public.finance_orgs o ON o.id=b.org_id WHERE b.id=NEW.budget_id))
                                THEN 'inherited' ELSE 'needs_coding' END;
    ELSIF auth.uid() IS NOT NULL AND NOT finance_private.can_manage_budget_codes() THEN
      NEW.coding_status := OLD.coding_status;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION finance_private.budget_lines_after_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
      FROM finance_private.budget_source_coding(NEW.source_line_id, NEW.source_template_line_id) c;
    RETURN NULL;
  END IF;

  INSERT INTO public.budget_line_coding
    (line_id, org_region, account_id, tracking_option_1_id, tracking_option_2_id, source)
  SELECT NEW.id, cc.org_region, CASE WHEN EXISTS(SELECT 1 FROM public.xero_accounts a WHERE a.id=cc.account_id AND a.status='active' AND a.missing_since IS NULL) THEN cc.account_id END,
         CASE WHEN EXISTS(SELECT 1 FROM public.xero_tracking_options o JOIN public.xero_tracking_categories c ON c.id=o.category_id WHERE o.id=cc.tracking_option_1_id AND o.status='active' AND o.missing_since IS NULL AND c.status='active' AND c.missing_since IS NULL) THEN cc.tracking_option_1_id END,
         CASE WHEN EXISTS(SELECT 1 FROM public.xero_tracking_options o1 JOIN public.xero_tracking_categories c1 ON c1.id=o1.category_id JOIN public.xero_tracking_options o2 ON o2.id=cc.tracking_option_2_id JOIN public.xero_tracking_categories c2 ON c2.id=o2.category_id WHERE o1.id=cc.tracking_option_1_id AND o1.status='active' AND o1.missing_since IS NULL AND c1.status='active' AND c1.missing_since IS NULL AND o2.status='active' AND o2.missing_since IS NULL AND c2.status='active' AND c2.missing_since IS NULL) THEN cc.tracking_option_2_id END, 'category_default'
    FROM public.budget_category_coding cc
   WHERE cc.category_id = NEW.category_id AND cc.org_region=(SELECT o.xero_region FROM public.budgets b JOIN public.finance_orgs o ON o.id=b.org_id WHERE b.id=NEW.budget_id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION finance_private.budget_template_lines_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.budget_templates t WHERE t.id=NEW.template_id AND t.org_id IS NOT NULL) THEN RAISE EXCEPTION 'Global templates remain empty; lines require an org-scoped saved template' USING ERRCODE='23514'; END IF;
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
      NEW.coding_status := CASE WHEN finance_private.budget_category_is_coded(NEW.category_id,(SELECT o.xero_region FROM public.budget_templates t JOIN public.finance_orgs o ON o.id=t.org_id WHERE t.id=NEW.template_id))
                                THEN 'inherited' ELSE 'needs_coding' END;
    END IF;
  ELSE
    IF NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.source_line_id IS DISTINCT FROM OLD.source_line_id THEN
      RAISE EXCEPTION 'A template line cannot move or change its source' USING ERRCODE = '42501';
    END IF;
    IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
      NEW.coding_status := CASE WHEN finance_private.budget_category_is_coded(NEW.category_id,(SELECT o.xero_region FROM public.budget_templates t JOIN public.finance_orgs o ON o.id=t.org_id WHERE t.id=NEW.template_id))
                                THEN 'inherited' ELSE 'needs_coding' END;
    ELSIF auth.uid() IS NOT NULL AND NOT finance_private.can_manage_budget_codes() THEN
      NEW.coding_status := OLD.coding_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION finance_private.budget_template_lines_after_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  SELECT NEW.id, cc.org_region, CASE WHEN EXISTS(SELECT 1 FROM public.xero_accounts a WHERE a.id=cc.account_id AND a.status='active' AND a.missing_since IS NULL) THEN cc.account_id END,
         CASE WHEN EXISTS(SELECT 1 FROM public.xero_tracking_options o JOIN public.xero_tracking_categories c ON c.id=o.category_id WHERE o.id=cc.tracking_option_1_id AND o.status='active' AND o.missing_since IS NULL AND c.status='active' AND c.missing_since IS NULL) THEN cc.tracking_option_1_id END,
         CASE WHEN EXISTS(SELECT 1 FROM public.xero_tracking_options o1 JOIN public.xero_tracking_categories c1 ON c1.id=o1.category_id JOIN public.xero_tracking_options o2 ON o2.id=cc.tracking_option_2_id JOIN public.xero_tracking_categories c2 ON c2.id=o2.category_id WHERE o1.id=cc.tracking_option_1_id AND o1.status='active' AND o1.missing_since IS NULL AND c1.status='active' AND c1.missing_since IS NULL AND o2.status='active' AND o2.missing_since IS NULL AND c2.status='active' AND c2.missing_since IS NULL) THEN cc.tracking_option_2_id END, 'category_default'
    FROM public.budget_category_coding cc
   WHERE cc.category_id = NEW.category_id AND cc.org_region=(SELECT o.xero_region FROM public.budget_templates t JOIN public.finance_orgs o ON o.id=t.org_id WHERE t.id=NEW.template_id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION finance_private.budget_coding_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cat1 uuid;
  v_cat2 uuid;
  v_region text;
BEGIN
  IF TG_TABLE_NAME='budget_line_coding' THEN
    SELECT o.xero_region INTO v_region FROM public.budget_lines l JOIN public.budgets b ON b.id=l.budget_id JOIN public.finance_orgs o ON o.id=b.org_id WHERE l.id=NEW.line_id;
  ELSIF TG_TABLE_NAME='budget_template_line_coding' THEN
    SELECT o.xero_region INTO v_region FROM public.budget_template_lines l JOIN public.budget_templates t ON t.id=l.template_id JOIN public.finance_orgs o ON o.id=t.org_id WHERE l.id=NEW.template_line_id;
  ELSE SELECT o.xero_region INTO v_region FROM public.finance_orgs o WHERE o.xero_region=NEW.org_region; END IF;
  IF v_region IS DISTINCT FROM NEW.org_region THEN RAISE EXCEPTION 'Coding must use the budget/template org' USING ERRCODE='23514'; END IF;
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


  IF TG_TABLE_NAME='budget_category_coding' OR pg_trigger_depth()=1 THEN
    IF NEW.account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.xero_accounts a WHERE a.id=NEW.account_id AND a.status='active' AND a.missing_since IS NULL) THEN
      RAISE EXCEPTION 'Account is inactive or missing' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM public.xero_tracking_options o JOIN public.xero_tracking_categories c ON c.id=o.category_id WHERE o.id IN (NEW.tracking_option_1_id,NEW.tracking_option_2_id) AND (o.status<>'active' OR o.missing_since IS NOT NULL OR c.status<>'active' OR c.missing_since IS NOT NULL)) THEN
      RAISE EXCEPTION 'Tracking option/category is inactive or missing' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('budget_line_coding', 'budget_template_line_coding') AND pg_trigger_depth() = 1 THEN
    NEW.source := 'finance_override';
  END IF;

  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION finance_private.budget_line_coding_after_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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


DROP TRIGGER IF EXISTS trg_budgets_before_write ON public.budgets;
CREATE TRIGGER trg_budgets_before_write
  BEFORE INSERT OR UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION finance_private.budgets_before_write();

DROP TRIGGER IF EXISTS trg_budgets_after_insert ON public.budgets;
CREATE TRIGGER trg_budgets_after_insert
  AFTER INSERT ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION finance_private.budgets_after_insert();

DROP TRIGGER IF EXISTS trg_budgets_driver_changed ON public.budgets;
CREATE TRIGGER trg_budgets_driver_changed
  AFTER UPDATE OF driver_value ON public.budgets
  FOR EACH ROW
  WHEN (OLD.driver_value IS DISTINCT FROM NEW.driver_value)
  EXECUTE FUNCTION finance_private.budgets_driver_changed();

DROP TRIGGER IF EXISTS trg_budget_lines_before_write ON public.budget_lines;
CREATE TRIGGER trg_budget_lines_before_write
  BEFORE INSERT OR UPDATE ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_lines_before_write();

DROP TRIGGER IF EXISTS trg_budget_lines_after_write ON public.budget_lines;
CREATE TRIGGER trg_budget_lines_after_write
  AFTER INSERT OR UPDATE OF category_id ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_lines_after_write();

DROP TRIGGER IF EXISTS trg_budget_template_lines_before_write ON public.budget_template_lines;
CREATE TRIGGER trg_budget_template_lines_before_write
  BEFORE INSERT OR UPDATE ON public.budget_template_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_template_lines_before_write();

DROP TRIGGER IF EXISTS trg_budget_template_lines_after_write ON public.budget_template_lines;
CREATE TRIGGER trg_budget_template_lines_after_write
  AFTER INSERT OR UPDATE OF category_id ON public.budget_template_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_template_lines_after_write();

DROP TRIGGER IF EXISTS trg_budget_line_coding_before_write ON public.budget_line_coding;
CREATE TRIGGER trg_budget_line_coding_before_write
  BEFORE INSERT OR UPDATE ON public.budget_line_coding
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_coding_before_write();

DROP TRIGGER IF EXISTS trg_budget_line_coding_after_write ON public.budget_line_coding;
CREATE TRIGGER trg_budget_line_coding_after_write
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_line_coding
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_line_coding_after_write();

DROP TRIGGER IF EXISTS trg_budget_template_line_coding_before_write ON public.budget_template_line_coding;
CREATE TRIGGER trg_budget_template_line_coding_before_write
  BEFORE INSERT OR UPDATE ON public.budget_template_line_coding
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_coding_before_write();

DROP TRIGGER IF EXISTS trg_budget_category_coding_before_write ON public.budget_category_coding;
CREATE TRIGGER trg_budget_category_coding_before_write
  BEFORE INSERT OR UPDATE ON public.budget_category_coding
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_coding_before_write();

DROP TRIGGER IF EXISTS trg_budget_categories_touch ON public.budget_categories;
CREATE TRIGGER trg_budget_categories_touch
  BEFORE UPDATE ON public.budget_categories
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_touch_updated_at();

DROP TRIGGER IF EXISTS trg_budget_templates_touch ON public.budget_templates;
CREATE TRIGGER trg_budget_templates_touch
  BEFORE UPDATE ON public.budget_templates
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_touch_updated_at();

DROP TRIGGER IF EXISTS trg_budget_members_one_owner ON public.budget_members;
CREATE TRIGGER trg_budget_members_one_owner
  BEFORE INSERT OR UPDATE OR DELETE ON public.budget_members
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_members_one_owner();

DROP TRIGGER IF EXISTS trg_budget_members_touch ON public.budget_members;
CREATE TRIGGER trg_budget_members_touch
  BEFORE UPDATE ON public.budget_members
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_touch_updated_at();

DROP TRIGGER IF EXISTS trg_budget_categories_audit ON public.budget_categories;
CREATE TRIGGER trg_budget_categories_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_categories
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_category_coding_audit ON public.budget_category_coding;
CREATE TRIGGER trg_budget_category_coding_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_category_coding
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_templates_audit ON public.budget_templates;
CREATE TRIGGER trg_budget_templates_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_templates
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_template_sections_audit ON public.budget_template_sections;
CREATE TRIGGER trg_budget_template_sections_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_template_sections
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_template_lines_audit ON public.budget_template_lines;
CREATE TRIGGER trg_budget_template_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_template_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_template_line_coding_audit ON public.budget_template_line_coding;
CREATE TRIGGER trg_budget_template_line_coding_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_template_line_coding
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budgets_audit ON public.budgets;
CREATE TRIGGER trg_budgets_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_sections_audit ON public.budget_sections;
CREATE TRIGGER trg_budget_sections_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_sections
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_members_audit ON public.budget_members;
CREATE TRIGGER trg_budget_members_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_members
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_lines_audit ON public.budget_lines;
CREATE TRIGGER trg_budget_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();

DROP TRIGGER IF EXISTS trg_budget_line_coding_audit ON public.budget_line_coding;
CREATE TRIGGER trg_budget_line_coding_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.budget_line_coding
  FOR EACH ROW EXECUTE FUNCTION finance_private.finance_audit_row();



CREATE OR REPLACE FUNCTION public.create_budget_from_template(
  p_template_id   uuid,
  p_owner_kind    text,
  p_owner_id      uuid,
  p_period_id     uuid,
  p_org_id        uuid,
  p_name          text,
  p_currency      text DEFAULT NULL,
  p_driver_label  text DEFAULT NULL,
  p_driver_value  numeric DEFAULT NULL,
  p_submit        boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
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

  INSERT INTO public.budgets
    (id, name, template_id, template_version, period_id, org_id, currency, owner_kind,
     staff_ministry_id, subcategory_id, program_id, event_id,
     source_budget_id, source_template_id, driver_label, driver_value)
  VALUES
    (v_id, btrim(p_name), v_template.id, v_template.version, p_period_id, p_org_id,
     p_currency, p_owner_kind,
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

CREATE OR REPLACE FUNCTION public.copy_budget_to_period(
  p_source_budget_id  uuid,
  p_period_id         uuid,
  p_name              text DEFAULT NULL,
  p_submit            boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_src  public.budgets%ROWTYPE;
  v_id   uuid := gen_random_uuid();
BEGIN
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
    (id, name, template_id, template_version, period_id, org_id, currency, owner_kind,
     staff_ministry_id, subcategory_id, program_id, event_id,
     source_budget_id, source_template_id, driver_label, driver_value,
     funding_goal_cents, income_goal_cents, fundraising_goal_cents, notes)
  VALUES
    (v_id, coalesce(nullif(btrim(p_name), ''), v_src.name), v_src.template_id, v_src.template_version,
     p_period_id, v_src.org_id, v_src.currency, v_src.owner_kind,
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

CREATE OR REPLACE FUNCTION public.save_budget_as_template(
  p_budget_id  uuid,
  p_name       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
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
    (id, key, name, version, is_active, applies_to, org_id, default_currency, funding_fields,
     owner_kind, staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id,
     source_budget_id, driver_label, driver_value, created_by)
  VALUES
    (v_id, NULL, btrim(p_name), 1, true, ARRAY[v_b.owner_kind], v_b.org_id, v_b.currency, coalesce(v_ff, '[]'::jsonb),
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

REVOKE ALL ON FUNCTION public.create_budget_from_template(uuid, text, uuid, uuid, uuid, text, text, text, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_budget_from_template(uuid, text, uuid, uuid, uuid, text, text, text, numeric, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.copy_budget_to_period(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_budget_to_period(uuid, uuid, text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_budget_as_template(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_budget_as_template(uuid, text) TO authenticated, service_role;


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


DROP POLICY IF EXISTS "Signed-in users read budget categories" ON public.budget_categories;
CREATE POLICY "Signed-in users read budget categories"
  ON public.budget_categories FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Finance adds budget categories" ON public.budget_categories;
CREATE POLICY "Finance adds budget categories"
  ON public.budget_categories FOR INSERT
  WITH CHECK (finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance edits budget categories" ON public.budget_categories;
CREATE POLICY "Finance edits budget categories"
  ON public.budget_categories FOR UPDATE
  USING (finance_private.can_manage_budget_codes())
  WITH CHECK (finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance reads category coding" ON public.budget_category_coding;
CREATE POLICY "Finance reads category coding"
  ON public.budget_category_coding FOR SELECT
  USING (finance_private.can_view_all_budgets() OR finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance adds category coding" ON public.budget_category_coding;
CREATE POLICY "Finance adds category coding"
  ON public.budget_category_coding FOR INSERT
  WITH CHECK (finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance edits category coding" ON public.budget_category_coding;
CREATE POLICY "Finance edits category coding"
  ON public.budget_category_coding FOR UPDATE
  USING (finance_private.can_manage_budget_codes())
  WITH CHECK (finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance removes category coding" ON public.budget_category_coding;
CREATE POLICY "Finance removes category coding"
  ON public.budget_category_coding FOR DELETE
  USING (finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Signed-in users read budget templates" ON public.budget_templates;
DROP POLICY IF EXISTS "Read budget templates in scope" ON public.budget_templates;
CREATE POLICY "Read budget templates in scope"
  ON public.budget_templates FOR SELECT
  USING (finance_private.can_see_budget_template(id));

DROP POLICY IF EXISTS "Finance adds budget templates" ON public.budget_templates;
DROP POLICY IF EXISTS "Finance and budget owners save templates" ON public.budget_templates;
CREATE POLICY "Finance and budget owners save templates"
  ON public.budget_templates FOR INSERT
  WITH CHECK (
    finance_private.can_edit_all_budgets()
    OR (source_budget_id IS NOT NULL
        AND finance_private.can_manage_budget(source_budget_id)
        AND finance_private.budget_has_owner(
              source_budget_id, owner_kind,
              public.budget_owner_id(staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id)))
  );

DROP POLICY IF EXISTS "Finance edits budget templates" ON public.budget_templates;
DROP POLICY IF EXISTS "Template managers edit templates" ON public.budget_templates;
CREATE POLICY "Template managers edit templates"
  ON public.budget_templates FOR UPDATE
  USING (finance_private.can_manage_budget_template(id))
  WITH CHECK (finance_private.can_manage_budget_template(id));

DROP POLICY IF EXISTS "Signed-in users read template sections" ON public.budget_template_sections;
DROP POLICY IF EXISTS "Read template sections in scope" ON public.budget_template_sections;
CREATE POLICY "Read template sections in scope"
  ON public.budget_template_sections FOR SELECT
  USING (finance_private.can_see_budget_template(template_id));

DROP POLICY IF EXISTS "Finance adds template sections" ON public.budget_template_sections;
DROP POLICY IF EXISTS "Template managers add sections" ON public.budget_template_sections;
CREATE POLICY "Template managers add sections"
  ON public.budget_template_sections FOR INSERT
  WITH CHECK (finance_private.can_manage_budget_template(template_id));

DROP POLICY IF EXISTS "Finance edits template sections" ON public.budget_template_sections;
DROP POLICY IF EXISTS "Template managers edit sections" ON public.budget_template_sections;
CREATE POLICY "Template managers edit sections"
  ON public.budget_template_sections FOR UPDATE
  USING (finance_private.can_manage_budget_template(template_id))
  WITH CHECK (finance_private.can_manage_budget_template(template_id));

DROP POLICY IF EXISTS "Read template lines in scope" ON public.budget_template_lines;
CREATE POLICY "Read template lines in scope"
  ON public.budget_template_lines FOR SELECT
  USING (finance_private.can_see_budget_template(template_id));

DROP POLICY IF EXISTS "Template managers add lines" ON public.budget_template_lines;
CREATE POLICY "Template managers add lines"
  ON public.budget_template_lines FOR INSERT
  WITH CHECK (finance_private.can_manage_budget_template(template_id));

DROP POLICY IF EXISTS "Template managers edit lines" ON public.budget_template_lines;
CREATE POLICY "Template managers edit lines"
  ON public.budget_template_lines FOR UPDATE
  USING (finance_private.can_manage_budget_template(template_id))
  WITH CHECK (finance_private.can_manage_budget_template(template_id));

DROP POLICY IF EXISTS "Finance reads template line coding" ON public.budget_template_line_coding;
CREATE POLICY "Finance reads template line coding"
  ON public.budget_template_line_coding FOR SELECT
  USING (finance_private.can_view_all_budgets() OR finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance adds template line coding" ON public.budget_template_line_coding;
CREATE POLICY "Finance adds template line coding"
  ON public.budget_template_line_coding FOR INSERT
  WITH CHECK (finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance edits template line coding" ON public.budget_template_line_coding;
CREATE POLICY "Finance edits template line coding"
  ON public.budget_template_line_coding FOR UPDATE
  USING (finance_private.can_manage_budget_codes())
  WITH CHECK (finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance removes template line coding" ON public.budget_template_line_coding;
CREATE POLICY "Finance removes template line coding"
  ON public.budget_template_line_coding FOR DELETE
  USING (finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance and members read budgets" ON public.budgets;
CREATE POLICY "Finance and members read budgets"
  ON public.budgets FOR SELECT
  USING (finance_private.can_view_all_budgets() OR finance_private.is_budget_member(id));

DROP POLICY IF EXISTS "Finance and ministry leaders create budgets" ON public.budgets;
DROP POLICY IF EXISTS "Finance, leaders and budget owners create budgets" ON public.budgets;
CREATE POLICY "Finance, leaders and budget owners create budgets"
  ON public.budgets FOR INSERT
  WITH CHECK (finance_private.can_create_budget_row(
    owner_kind, staff_ministry_id, subcategory_id, program_id, event_id, outreach_team_id,
    source_budget_id, source_template_id));

DROP POLICY IF EXISTS "Finance edits budgets" ON public.budgets;
CREATE POLICY "Finance edits budgets"
  ON public.budgets FOR UPDATE
  USING (finance_private.can_edit_all_budgets())
  WITH CHECK (finance_private.can_edit_all_budgets());

DROP POLICY IF EXISTS "Owners edit their draft budgets" ON public.budgets;
CREATE POLICY "Owners edit their draft budgets"
  ON public.budgets FOR UPDATE
  USING (finance_private.is_budget_member(id, 'owner') AND status = 'draft' AND archived_at IS NULL)
  WITH CHECK (finance_private.is_budget_member(id, 'owner') AND status IN ('draft', 'submitted', 'archived'));

DROP POLICY IF EXISTS "Approver decides on submitted budgets" ON public.budgets;
CREATE POLICY "Approver decides on submitted budgets"
  ON public.budgets FOR UPDATE
  USING (finance_private.can_approve_budgets() AND status IN ('submitted', 'approved') AND archived_at IS NULL)
  WITH CHECK (finance_private.can_approve_budgets() AND status IN ('draft', 'submitted', 'approved'));

DROP POLICY IF EXISTS "Finance and members read budget sections" ON public.budget_sections;
CREATE POLICY "Finance and members read budget sections"
  ON public.budget_sections FOR SELECT
  USING (finance_private.can_view_all_budgets() OR finance_private.is_budget_member(budget_id));

DROP POLICY IF EXISTS "Budget managers add sections" ON public.budget_sections;
CREATE POLICY "Budget managers add sections"
  ON public.budget_sections FOR INSERT
  WITH CHECK (finance_private.can_edit_budget_sections(budget_id));

DROP POLICY IF EXISTS "Budget managers edit sections" ON public.budget_sections;
CREATE POLICY "Budget managers edit sections"
  ON public.budget_sections FOR UPDATE
  USING (finance_private.can_edit_budget_sections(budget_id))
  WITH CHECK (finance_private.can_edit_budget_sections(budget_id));

DROP POLICY IF EXISTS "Finance and members read budget members" ON public.budget_members;
CREATE POLICY "Finance and members read budget members"
  ON public.budget_members FOR SELECT
  USING (finance_private.can_view_all_budgets() OR finance_private.is_budget_member(budget_id));

DROP POLICY IF EXISTS "Budget managers add members" ON public.budget_members;
CREATE POLICY "Budget managers add members"
  ON public.budget_members FOR INSERT
  WITH CHECK (finance_private.can_manage_budget(budget_id));

DROP POLICY IF EXISTS "Budget managers change members" ON public.budget_members;
CREATE POLICY "Budget managers change members"
  ON public.budget_members FOR UPDATE
  USING (finance_private.can_manage_budget(budget_id))
  WITH CHECK (finance_private.can_manage_budget(budget_id));

DROP POLICY IF EXISTS "Budget managers remove members" ON public.budget_members;
CREATE POLICY "Budget managers remove members"
  ON public.budget_members FOR DELETE
  USING (finance_private.can_manage_budget(budget_id));

DROP POLICY IF EXISTS "Finance and members read budget lines" ON public.budget_lines;
CREATE POLICY "Finance and members read budget lines"
  ON public.budget_lines FOR SELECT
  USING (finance_private.can_view_all_budgets() OR finance_private.is_budget_member(budget_id));

DROP POLICY IF EXISTS "Budget editors add lines" ON public.budget_lines;
CREATE POLICY "Budget editors add lines"
  ON public.budget_lines FOR INSERT
  WITH CHECK (finance_private.can_edit_budget_lines(budget_id));

DROP POLICY IF EXISTS "Budget editors change lines" ON public.budget_lines;
CREATE POLICY "Budget editors change lines"
  ON public.budget_lines FOR UPDATE
  USING (finance_private.can_edit_budget_lines(budget_id))
  WITH CHECK (finance_private.can_edit_budget_lines(budget_id));

DROP POLICY IF EXISTS "Finance reads line coding" ON public.budget_line_coding;
CREATE POLICY "Finance reads line coding"
  ON public.budget_line_coding FOR SELECT
  USING (finance_private.can_view_all_budgets() OR finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance adds line coding" ON public.budget_line_coding;
CREATE POLICY "Finance adds line coding"
  ON public.budget_line_coding FOR INSERT
  WITH CHECK (finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance edits line coding" ON public.budget_line_coding;
CREATE POLICY "Finance edits line coding"
  ON public.budget_line_coding FOR UPDATE
  USING (finance_private.can_manage_budget_codes())
  WITH CHECK (finance_private.can_manage_budget_codes());

DROP POLICY IF EXISTS "Finance removes line coding" ON public.budget_line_coding;
CREATE POLICY "Finance removes line coding"
  ON public.budget_line_coding FOR DELETE
  USING (finance_private.can_manage_budget_codes());


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
   ('expense_tracker', 'Expense tracker', 'Spending recorded on this budget, in its currency. Not imported from outreach or Xero.', 50),
   ('notes',           'Notes',           'Anything else finance or the team should know.',                60)
 ) AS s(key, label, help_text, sort)
 WHERE t.key = 'team_standard'
ON CONFLICT (template_id, key) DO NOTHING;


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
  'The one Xero coding row for a template line, in that template''s org region. Copied from the source line and re-checked against the mirror when a budget is made from the template. Finance only.';

COMMENT ON TABLE public.budgets IS
  'One budget for one entity (staff ministry, ministry sub-category, school, event, or outreach team via outreach_team_id), one finance org and one fiscal period. Currency matches that org. One person is the responsible owner. Created by create_budget_from_template() or copy_budget_to_period(); always starts as a draft. Money in cents. Archived, never deleted. Members see their own; finance sees all.';
COMMENT ON COLUMN public.budgets.owner_kind IS
  'Which owner column is set: staff_ministry, ministry_subcategory, program, event (or outreach_team, reserved). Exactly one owner column is non-null and it matches this.';
COMMENT ON COLUMN public.budgets.template_version IS
  'The template version this budget was copied from. The budget is never updated when the template changes.';
COMMENT ON COLUMN public.budgets.source_budget_id IS
  'The earlier budget this one continues: the budget it was copied from, or the one its saved template was made from. Pairs budgets for year-over-year comparison (v_budget_yoy).';
COMMENT ON COLUMN public.budgets.source_template_id IS
  'The template this budget was created from by create_budget_from_template. NULL for a direct copy.';
COMMENT ON COLUMN public.budgets.currency IS
  'The finance org''s record currency (ZAR or USD). Frozen with org_id. No conversion.';
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
  'Who can see or edit ONE budget. Exactly one row has role owner: that person is the responsible owner (header, members, save as template, copy). Hand-off changes that row''s user. Editors change lines while the budget is a draft. Viewers read. Other editors and viewers are not owners.';

COMMENT ON TABLE public.budget_lines IS
  'A cost on a budget. Total = round(amount_cents × frequency × multiplier), computed by trigger. Fixed lines have frequency 1 and a quantity as multiplier. Archived, never deleted.';
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
  'The single Xero coding row for a budget line: account and up to two tracking options (mirror uuids) in the budget org''s region. Copied from that org''s category default, or from the source line / template line for copies. Only finance changes it. A finance project is mapped by copying its xero_tracking_option_id onto a tracking option; names are not matched.';
COMMENT ON COLUMN public.budget_line_coding.source IS
  'category_default (from a category) or finance_override (finance wrote it). Kept as-is when coding is copied.';

COMMENT ON FUNCTION public.create_budget_from_template(uuid, text, uuid, uuid, uuid, text, text, text, numeric, boolean) IS
  'Creates a budget from a template: the standard template gives an EMPTY budget (sections, zero lines); a saved template also gives its lines and coding (inactive Xero rows dropped, line flagged needs_coding). Draft, or submitted when p_submit; never approved. Scoped templates only for their own owner. SECURITY INVOKER: RLS decides who may create what. Returns the new budget id.';
COMMENT ON FUNCTION public.copy_budget_to_period(uuid, uuid, text, boolean) IS
  'Copies a budget the caller can see into another period for the same owner: sections, live lines, driver, goals (not funds in hand) and notes; coding re-checked. Draft, or submitted when p_submit; never approved. Stores source_budget_id. The caller must own the source budget (or be finance / a leader of the owner). SECURITY INVOKER. Returns the new budget id.';
COMMENT ON FUNCTION public.save_budget_as_template(uuid, text) IS
  'Saves a budget as a reusable template scoped to the budget''s owner: sections, live lines, driver, categories and Xero coding — no approvals, history, actuals or receipts. Finance or the budget''s owner. SECURITY INVOKER. Returns the new template id.';
COMMENT ON FUNCTION finance_private.is_budget_member(uuid, text) IS
  'True when the current user is a member of the budget with at least the given role (viewer < editor < owner).';




CREATE INDEX budgets_org_period_idx ON public.budgets(org_id,period_id);
CREATE INDEX budget_templates_org_idx ON public.budget_templates(org_id);
ALTER TABLE public.budget_category_coding ADD CONSTRAINT budget_category_coding_org_fkey FOREIGN KEY(org_region) REFERENCES public.finance_orgs(xero_region) ON DELETE RESTRICT;
-- Template identity may not be switched to another owner/org/source after publication.
CREATE FUNCTION finance_private.budget_template_identity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.org_id,NEW.owner_kind,NEW.staff_ministry_id,NEW.subcategory_id,NEW.program_id,NEW.event_id,NEW.outreach_team_id,NEW.source_budget_id)
 IS DISTINCT FROM ROW(OLD.org_id,OLD.owner_kind,OLD.staff_ministry_id,OLD.subcategory_id,OLD.program_id,OLD.event_id,OLD.outreach_team_id,OLD.source_budget_id) THEN
 RAISE EXCEPTION 'Template identity is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.source_budget_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.budgets b WHERE b.id=NEW.source_budget_id AND b.org_id=NEW.org_id AND b.owner_kind=NEW.owner_kind AND public.budget_owner_id(b.staff_ministry_id,b.subcategory_id,b.program_id,b.event_id,b.outreach_team_id)=public.budget_owner_id(NEW.staff_ministry_id,NEW.subcategory_id,NEW.program_id,NEW.event_id,NEW.outreach_team_id)) THEN
 RAISE EXCEPTION 'Template scope differs from source budget' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER budget_template_identity_guard BEFORE INSERT OR UPDATE ON public.budget_templates FOR EACH ROW EXECUTE FUNCTION finance_private.budget_template_identity_guard();
