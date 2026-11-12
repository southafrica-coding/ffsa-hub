-- Finance prerequisites for draft #475 migrations 295–299.
-- Objects below are copied from the cited migrations on this branch.
-- Owner-FK tables (programs, events, outreach_teams) are id-only stand-ins:
-- their production columns and RLS are omitted. Budget RLS is not stubbed.
-- users omits person_id (production users.person_id is NOT NULL). That does
-- not change budget policies.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 001_phase1_schema.sql roles / user_roles (users trimmed: see header).
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY,
  display_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  display_name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles (id) ON DELETE CASCADE,
  scope_type text CHECK (scope_type IS NULL OR scope_type IN ('program', 'team', 'event')),
  scope_id uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES public.users (id),
  UNIQUE (user_id, role_id, scope_type, scope_id)
);

-- 014_permissions_system.sql
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  key text UNIQUE NOT NULL,
  display_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions (id) ON DELETE CASCADE,
  scope_type text CHECK (scope_type IS NULL OR scope_type IN ('program', 'team', 'event')),
  scope_id uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES public.users (id),
  UNIQUE (user_id, permission_id, scope_type, scope_id)
);

-- 002_rls_policies.sql — has_role, has_any_role, is_admin. Bodies unchanged.
CREATE OR REPLACE FUNCTION public.has_role(
  required_role text,
  check_scope_type text DEFAULT NULL,
  check_scope_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.name = required_role
      AND (
        ur.scope_type IS NULL
        OR (
          check_scope_type IS NOT NULL
          AND ur.scope_type = check_scope_type
          AND ur.scope_id = check_scope_id
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(required_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.name = ANY(required_roles)
      AND ur.scope_type IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(ARRAY['super_admin', 'admin']);
$$;

-- 089_role_permissions_engine.sql table + has_permission body.
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);

CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
    WHERE up.user_id = auth.uid()
      AND p.key = required_permission
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.key = required_permission
  );
$$;

-- 126_staff_ministries.sql tables + leads_staff_ministry. Seed omitted
-- (it reads users.department, which this fixture does not have).
CREATE TABLE IF NOT EXISTS public.staff_ministries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_ministry_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'member' CHECK (member_role IN ('member', 'leader')),
  is_point_leader boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active')),
  added_by uuid REFERENCES public.users (id),
  approved_by uuid REFERENCES public.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_ministry_id, user_id)
);

CREATE OR REPLACE FUNCTION public.leads_staff_ministry(target_ministry_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.staff_ministry_members mm
      WHERE mm.staff_ministry_id = target_ministry_id
        AND mm.user_id = auth.uid()
        AND mm.member_role = 'leader'
        AND mm.status = 'active'
    );
$$;

-- 128_staff_ministry_subcategories.sql table only.
CREATE TABLE IF NOT EXISTS public.staff_ministry_subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_ministry_id, name)
);

-- Owner FK targets. Not the production tables.
CREATE TABLE IF NOT EXISTS public.programs (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  code text UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY,
  title text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.outreach_teams (
  id uuid PRIMARY KEY,
  team_name text NOT NULL
);

-- 290_finance_orgs_and_projects.sql table + read/write policies. Projects omitted.
CREATE TABLE IF NOT EXISTS public.finance_orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key IN ('npc', 'usa')),
  name text NOT NULL,
  xero_region text NOT NULL UNIQUE CHECK (xero_region IN ('za', 'us')),
  record_currency text NOT NULL CHECK (record_currency IN ('ZAR', 'USD')),
  projects_category_name text NOT NULL DEFAULT 'Ministries',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.finance_orgs (key, name, xero_region, record_currency)
VALUES
  ('npc', 'FFSA NPC', 'za', 'ZAR'),
  ('usa', 'FF USA Inc', 'us', 'USD')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.finance_orgs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_orgs FROM anon;

DROP POLICY IF EXISTS "Finance can read finance orgs" ON public.finance_orgs;
CREATE POLICY "Finance can read finance orgs"
  ON public.finance_orgs FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
  );

DROP POLICY IF EXISTS "Admins can add finance orgs" ON public.finance_orgs;
CREATE POLICY "Admins can add finance orgs"
  ON public.finance_orgs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update finance orgs" ON public.finance_orgs;
CREATE POLICY "Admins can update finance orgs"
  ON public.finance_orgs FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 275_xero_code_mirror.sql tables needed by migration 295 triggers and 299 policies.
-- The rest of 275 (sync, other mirror tables, its RLS) is omitted.
CREATE TABLE IF NOT EXISTS public.xero_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_region text NOT NULL CHECK (org_region IN ('za', 'us')),
  tenant_id text NOT NULL,
  xero_account_id text NOT NULL,
  code text,
  name text NOT NULL,
  type text,
  class text,
  tax_type text,
  is_bank boolean NOT NULL DEFAULT false,
  currency_code text,
  description text,
  friendly_name text,
  is_hidden boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  missing_since timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_changed_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb,
  CONSTRAINT xero_accounts_org_tenant_xero_id_key UNIQUE (org_region, tenant_id, xero_account_id)
);

CREATE TABLE IF NOT EXISTS public.xero_tracking_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_region text NOT NULL CHECK (org_region IN ('za', 'us')),
  tenant_id text NOT NULL,
  xero_category_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  missing_since timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_changed_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb,
  CONSTRAINT xero_tracking_categories_org_tenant_xero_id_key UNIQUE (org_region, tenant_id, xero_category_id),
  CONSTRAINT xero_tracking_categories_id_org_tenant_key UNIQUE (id, org_region, tenant_id)
);

CREATE TABLE IF NOT EXISTS public.xero_tracking_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_region text NOT NULL CHECK (org_region IN ('za', 'us')),
  tenant_id text NOT NULL,
  xero_option_id text NOT NULL,
  category_id uuid NOT NULL,
  name text NOT NULL,
  match_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  friendly_name text,
  is_hidden boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  missing_since timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_changed_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb,
  CONSTRAINT xero_tracking_options_org_tenant_xero_id_key UNIQUE (org_region, tenant_id, xero_option_id),
  CONSTRAINT xero_tracking_options_category_org_tenant_fkey
    FOREIGN KEY (category_id, org_region, tenant_id)
    REFERENCES public.xero_tracking_categories (id, org_region, tenant_id)
);

-- Role 295's seed looks up. Must exist before that file runs.
INSERT INTO public.roles (name, display_name, is_system)
VALUES ('finance_admin', 'Finance Admin', true)
ON CONFLICT (name) DO NOTHING;

-- Supabase grants table privileges to authenticated and service_role, then
-- RLS decides rows. Migration 299 later narrows the budget tables. These
-- grants are only for the prerequisite tables above.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.users, public.roles, public.user_roles, public.permissions,
  public.user_permissions, public.role_permissions,
  public.staff_ministries, public.staff_ministry_members, public.staff_ministry_subcategories,
  public.programs, public.events, public.outreach_teams,
  public.finance_orgs, public.xero_accounts, public.xero_tracking_categories, public.xero_tracking_options
TO authenticated, service_role;
