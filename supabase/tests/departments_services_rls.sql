-- Disposable RLS check for migrations 317–320. Not a migration.
-- Builds the slice of schema those files touch, including the membership
-- triggers they must not break, applies the four files twice, then reads
-- and writes as each kind of user.
--
--   dropdb --if-exists departments_services_rls && createdb departments_services_rls
--   psql -v ON_ERROR_STOP=1 -d departments_services_rls -f supabase/tests/departments_services_rls.sql
--
-- Permission stubs deliberately ignore users.is_active (pre-316 is_admin /
-- has_role, pre-316 has_permission that also ignores scope). The policies
-- still have to deny an inactive account.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  is_active boolean NOT NULL DEFAULT true,
  email text,
  first_name text,
  last_name text,
  display_name text,
  preferred_name text
);

CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles (id) ON DELETE CASCADE,
  scope_type text,
  scope_id uuid
);
CREATE UNIQUE INDEX one_unscoped_role_per_user
  ON public.user_roles (user_id, role_id)
  WHERE scope_type IS NULL AND scope_id IS NULL;

CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL
);
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions (id) ON DELETE CASCADE,
  scope_type text,
  scope_id uuid
);
CREATE TABLE public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Ignores is_active on purpose, so a policy that trusts is_admin() alone
-- would let the inactive admin through.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = auth.uid()
       AND r.name IN ('admin', 'super_admin')
       AND ur.scope_type IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(
  required_role text,
  check_scope_type text DEFAULT NULL,
  check_scope_id uuid DEFAULT NULL
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.user_id = auth.uid()
       AND r.name = required_role
       AND (
         ur.scope_type IS NULL
         OR (check_scope_type IS NOT NULL
             AND ur.scope_type = check_scope_type
             AND ur.scope_id IS NOT DISTINCT FROM check_scope_id)
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(required_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin();
$$;

-- Any scope, active or not. Budget reads must not use this for finance.*.
CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_permissions up
      JOIN public.permissions p ON p.id = up.permission_id
     WHERE up.user_id = auth.uid()
       AND p.key = required_permission
  );
$$;

CREATE TABLE public.staff_ministries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  ministry_type text NOT NULL DEFAULT 'main' CHECK (ministry_type IN ('main', 'part_time')),
  cluster text,
  parent_id uuid REFERENCES public.staff_ministries (id),
  purpose text,
  starts_on date,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.staff_ministry_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'member' CHECK (member_role IN ('member', 'leader')),
  is_point_leader boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_ministry_id, user_id)
);
CREATE UNIQUE INDEX one_point_leader_per_staff_ministry
  ON public.staff_ministry_members (staff_ministry_id) WHERE is_point_leader;

-- 205: a subcategory assignment cascades when its membership is deleted.
CREATE TABLE public.staff_ministry_subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_ministry_id uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  name text NOT NULL
);
CREATE TABLE public.staff_ministry_member_subcategories (
  membership_id uuid NOT NULL REFERENCES public.staff_ministry_members (id) ON DELETE CASCADE,
  subcategory_id uuid NOT NULL REFERENCES public.staff_ministry_subcategories (id) ON DELETE CASCADE,
  PRIMARY KEY (membership_id, subcategory_id)
);

CREATE TABLE public.ministries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  staff_ministry_id uuid REFERENCES public.staff_ministries (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.finance_orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL
);
CREATE TABLE public.finance_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.finance_orgs (id),
  name text NOT NULL,
  match_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (org_id, name)
);

CREATE TABLE public.okr_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  is_current boolean NOT NULL DEFAULT false
);
CREATE TABLE public.okr_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.okr_cycles (id),
  staff_ministry_id uuid REFERENCES public.staff_ministries (id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES public.users (id),
  scope text NOT NULL DEFAULT 'ministry',
  title text NOT NULL,
  description text,
  notes text,
  is_archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.org_edit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  action text NOT NULL,
  field text,
  before jsonb,
  after jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Prod triggers the Be Free insert must survive (131, 266, 250).
CREATE OR REPLACE FUNCTION public.sync_leadership_team_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lt_id uuid;
  lt_role_id uuid;
  uid uuid;
BEGIN
  SELECT id INTO lt_id FROM public.staff_ministries WHERE slug = 'leadership_team';
  SELECT id INTO lt_role_id FROM public.roles WHERE name = 'leadership_team';
  IF lt_id IS NULL OR lt_role_id IS NULL THEN RETURN NULL; END IF;
  uid := COALESCE(NEW.user_id, OLD.user_id);
  IF EXISTS (
    SELECT 1 FROM public.staff_ministry_members
     WHERE user_id = uid AND staff_ministry_id = lt_id AND status = 'active'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = uid AND role_id = lt_role_id AND scope_type IS NULL
    ) THEN
      INSERT INTO public.user_roles (user_id, role_id) VALUES (uid, lt_role_id);
    END IF;
  ELSE
    DELETE FROM public.user_roles
     WHERE user_id = uid AND role_id = lt_role_id AND scope_type IS NULL;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.sync_no_ministry_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  NO_MINISTRY_STAFF_ROLES constant text[] := ARRAY['staff'];
  nm_id uuid;
  uid uuid;
  main_cnt int;
  is_staff boolean;
BEGIN
  IF pg_trigger_depth() > 3 THEN RETURN NULL; END IF;
  SELECT id INTO nm_id FROM public.staff_ministries WHERE slug = 'no_ministry';
  IF nm_id IS NULL THEN RETURN NULL; END IF;
  IF COALESCE(NEW.staff_ministry_id, OLD.staff_ministry_id) = nm_id THEN RETURN NULL; END IF;
  uid := COALESCE(NEW.user_id, OLD.user_id);
  SELECT count(*) INTO main_cnt
    FROM public.staff_ministry_members m
    JOIN public.staff_ministries sm ON sm.id = m.staff_ministry_id
   WHERE m.user_id = uid AND m.status = 'active'
     AND sm.ministry_type = 'main' AND sm.id <> nm_id;
  IF main_cnt > 0 THEN
    DELETE FROM public.staff_ministry_members
     WHERE user_id = uid AND staff_ministry_id = nm_id;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = uid AND r.name = ANY (NO_MINISTRY_STAFF_ROLES)
    ) AND EXISTS (
      SELECT 1 FROM public.users u WHERE u.id = uid AND u.is_active
    ) INTO is_staff;
    IF is_staff THEN
      INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status)
      VALUES (nm_id, uid, 'member', 'active')
      ON CONFLICT (staff_ministry_id, user_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.sync_no_ministry_on_staff_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.id = NEW.role_id AND r.name = 'staff') THEN
    RETURN NULL;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.log_org_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := auth.uid();
  old_j jsonb;
  new_j jsonb;
  k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.org_edit_log (table_name, row_id, action, after, actor_id)
      VALUES (TG_TABLE_NAME, NEW.id, 'created', to_jsonb(NEW), actor);
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.org_edit_log (table_name, row_id, action, before, actor_id)
      VALUES (TG_TABLE_NAME, OLD.id, 'deleted', to_jsonb(OLD), actor);
    RETURN NULL;
  END IF;
  old_j := to_jsonb(OLD);
  new_j := to_jsonb(NEW);
  FOR k IN SELECT jsonb_object_keys(new_j) LOOP
    CONTINUE WHEN k IN ('updated_at', 'created_at');
    IF (old_j -> k) IS DISTINCT FROM (new_j -> k) THEN
      INSERT INTO public.org_edit_log (table_name, row_id, action, field, before, after, actor_id)
        VALUES (TG_TABLE_NAME, NEW.id, 'updated', k, old_j -> k, new_j -> k, actor);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE TRIGGER staff_ministry_members_leadership_role
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_ministry_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_leadership_team_role();
CREATE TRIGGER staff_ministry_members_no_ministry_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_ministry_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_no_ministry_membership();
CREATE TRIGGER org_edit_log
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_ministries
  FOR EACH ROW EXECUTE FUNCTION public.log_org_edit();
CREATE TRIGGER org_edit_log
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_ministry_members
  FOR EACH ROW EXECUTE FUNCTION public.log_org_edit();
CREATE TRIGGER user_roles_staff_no_ministry
  AFTER INSERT OR UPDATE OF role_id, user_id ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.sync_no_ministry_on_staff_role();

ALTER TABLE public.staff_ministries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff ministries are readable"
  ON public.staff_ministries FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.staff_ministries TO authenticated;
GRANT SELECT ON public.staff_ministry_members TO authenticated;

-- ── People and homes (Philip is deliberately absent) ────────
INSERT INTO public.roles (name) VALUES
  ('admin'), ('ministry_leader'), ('leadership_team'), ('finance_admin'), ('staff');
INSERT INTO public.permissions (key) VALUES
  ('finance.view'), ('finance.edit'), ('org.manage');

INSERT INTO public.users (id, is_active) VALUES
  ('a1111111-1111-4111-8111-111111111111', true),
  ('a2222222-2222-4222-8222-222222222222', true),
  ('a3333333-3333-4333-8333-333333333333', true),
  ('a4444444-4444-4444-8444-444444444444', true),
  ('b1111111-1111-4111-8111-111111111111', true),
  ('b2222222-2222-4222-8222-222222222222', true),
  ('b3333333-3333-4333-8333-333333333333', false),
  ('c1111111-1111-4111-8111-111111111111', true),
  ('c2222222-2222-4222-8222-222222222222', true),
  ('d1111111-1111-4111-8111-111111111111', true),
  ('d2222222-2222-4222-8222-222222222222', true),
  ('d3333333-3333-4333-8333-333333333333', true),
  ('d4444444-4444-4444-8444-444444444444', true),
  ('d5555555-5555-4555-8555-555555555555', true),
  ('e1111111-1111-4111-8111-111111111111', true),
  ('e2222222-2222-4222-8222-222222222222', true),
  ('e3333333-3333-4333-8333-333333333333', false),
  ('e4444444-4444-4444-8444-444444444444', false),
  ('e5555555-5555-4555-8555-555555555555', true),
  ('e6666666-6666-4666-8666-666666666666', true),
  ('e7777777-7777-4777-8777-777777777777', true);

INSERT INTO public.user_roles (user_id, role_id)
SELECT 'e2222222-2222-4222-8222-222222222222', id FROM public.roles WHERE name = 'admin';
INSERT INTO public.user_roles (user_id, role_id)
SELECT 'e3333333-3333-4333-8333-333333333333', id FROM public.roles WHERE name = 'admin';

INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
SELECT 'd3333333-3333-4333-8333-333333333333', id, NULL, NULL FROM public.permissions WHERE key = 'finance.view';
INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
SELECT 'd4444444-4444-4444-8444-444444444444', id, 'program', '99999999-9999-4999-8999-999999999999'
  FROM public.permissions WHERE key = 'finance.view';
INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
SELECT 'd5555555-5555-4555-8555-555555555555', id, NULL, NULL FROM public.permissions WHERE key = 'finance.edit';
INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
SELECT 'e1111111-1111-4111-8111-111111111111', id, NULL, NULL FROM public.permissions WHERE key = 'org.manage';
INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
SELECT 'e4444444-4444-4444-8444-444444444444', id, NULL, NULL FROM public.permissions WHERE key = 'finance.view';

INSERT INTO public.staff_ministries (name, slug, ministry_type, is_active, cluster, purpose) VALUES
  ('HULC', 'hulk', 'main', true, NULL, NULL),
  ('Missio Church', 'missio_ministry', 'main', true, NULL, NULL),
  ('Donors & Dev', 'donors_dev', 'main', true, 'backbone', NULL),
  ('Finances & Legal', 'finances_legal', 'main', true, 'backbone', NULL),
  ('Media', 'media', 'main', true, NULL, NULL),
  ('Operations', 'operations', 'main', true, NULL, NULL),
  ('Prayer & Worship', 'prayer_and_worship', 'main', true, NULL, NULL),
  ('Leadership Team', 'leadership_team', 'main', true, NULL, NULL),
  ('Training', 'training', 'main', true, NULL, NULL),
  ('Woven', 'woven', 'main', false, NULL, NULL),
  ('Project 54', 'project_54', 'main', true, NULL, NULL),
  ('1040', '1040', 'main', true, NULL, NULL),
  ('No Ministry', 'no_ministry', 'main', true, NULL, NULL);

INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, is_point_leader, status)
SELECT sm.id, v.user_id, v.member_role, v.is_point, 'active'
  FROM (VALUES
    ('hulk', 'a1111111-1111-4111-8111-111111111111'::uuid, 'leader', true),
    ('hulk', 'a2222222-2222-4222-8222-222222222222'::uuid, 'leader', false),
    ('hulk', 'a3333333-3333-4333-8333-333333333333'::uuid, 'leader', false),
    ('hulk', 'a4444444-4444-4444-8444-444444444444'::uuid, 'leader', false),
    ('media', 'b1111111-1111-4111-8111-111111111111'::uuid, 'member', false),
    ('media', 'b2222222-2222-4222-8222-222222222222'::uuid, 'leader', true),
    ('media', 'b3333333-3333-4333-8333-333333333333'::uuid, 'leader', false),
    ('operations', 'c1111111-1111-4111-8111-111111111111'::uuid, 'member', false),
    ('operations', 'c2222222-2222-4222-8222-222222222222'::uuid, 'leader', true),
    ('leadership_team', 'd1111111-1111-4111-8111-111111111111'::uuid, 'member', false),
    ('finances_legal', 'd2222222-2222-4222-8222-222222222222'::uuid, 'member', false),
    ('training', 'e6666666-6666-4666-8666-666666666666'::uuid, 'leader', true),
    ('donors_dev', 'e7777777-7777-4777-8777-777777777777'::uuid, 'member', false)
  ) AS v(slug, user_id, member_role, is_point)
  JOIN public.staff_ministries sm ON sm.slug = v.slug;

CREATE TABLE public.hulk_before AS
SELECT mm.id, mm.staff_ministry_id, mm.user_id, mm.member_role, mm.is_point_leader, mm.status
  FROM public.staff_ministry_members mm
  JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
 WHERE sm.slug = 'hulk';

INSERT INTO public.ministries (name, slug, color, staff_ministry_id)
VALUES ('Be Free', 'be-free', '#abcdef', NULL);

INSERT INTO public.finance_orgs (key, name) VALUES ('npc', 'FFSA NPC'), ('usa', 'FF USA Inc');
INSERT INTO public.finance_projects (org_id, name)
SELECT o.id, v.name
  FROM public.finance_orgs o
  JOIN (VALUES
    ('npc', 'HULC'), ('npc', 'HULC Merch'), ('npc', 'Media'), ('npc', 'Worship & Prayer'),
    ('npc', 'Woven'), ('npc', 'Missio - JHB'), ('npc', '1040 Crossfit'), ('npc', 'Project 54'),
    ('npc', 'Hope Again'),
    ('usa', 'HULC'), ('usa', 'Media'), ('usa', 'Woven'), ('usa', 'Project 54')
  ) AS v(org_key, name) ON o.key = v.org_key;

INSERT INTO public.okr_cycles (name, starts_on, ends_on, is_current) VALUES
  ('2025', '2025-01-01', '2025-12-31', false),
  ('2026', '2026-01-01', '2026-12-31', true);

INSERT INTO public.okr_objectives (cycle_id, staff_ministry_id, scope, title, notes, is_archived)
SELECT c.id, sm.id, 'ministry', 'Current media objective', 'keep', false
  FROM public.okr_cycles c, public.staff_ministries sm
 WHERE c.is_current AND sm.slug = 'media';
INSERT INTO public.okr_objectives (cycle_id, staff_ministry_id, scope, title, notes, is_archived)
SELECT c.id, sm.id, 'ministry', 'Archived media objective', 'drop', true
  FROM public.okr_cycles c, public.staff_ministries sm
 WHERE c.is_current AND sm.slug = 'media';
INSERT INTO public.okr_objectives (cycle_id, staff_ministry_id, scope, title, notes, is_archived)
SELECT c.id, sm.id, 'ministry', 'Old media objective', 'drop', false
  FROM public.okr_cycles c, public.staff_ministries sm
 WHERE c.name = '2025' AND sm.slug = 'media';
INSERT INTO public.okr_objectives (cycle_id, staff_ministry_id, scope, title, notes, is_archived)
SELECT c.id, sm.id, 'individual', 'Current ops objective', 'keep', false
  FROM public.okr_cycles c, public.staff_ministries sm
 WHERE c.is_current AND sm.slug = 'operations';

GRANT SELECT ON public.okr_cycles, public.okr_objectives TO authenticated;

CREATE TABLE public.t_checks (
  name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text NOT NULL
);
CREATE OR REPLACE FUNCTION public._t(p_name text, p_ok boolean, p_detail text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.t_checks (name, ok, detail) VALUES (p_name, p_ok, p_detail)
  ON CONFLICT (name) DO UPDATE SET ok = EXCLUDED.ok, detail = EXCLUDED.detail;
END $$;
GRANT EXECUTE ON FUNCTION public._t(text, boolean, text) TO PUBLIC;

CREATE TABLE public.pre_apply AS
SELECT
  (SELECT parent_id FROM public.staff_ministries WHERE slug = 'donors_dev') AS donors_parent,
  (SELECT staff_ministry_id FROM public.ministries WHERE slug = 'be-free') AS be_free_link,
  (SELECT updated_at FROM public.ministries WHERE slug = 'be-free') AS be_free_updated,
  (SELECT color FROM public.ministries WHERE slug = 'be-free') AS be_free_color;

-- ── Apply, then again, before Philip exists ────────────────
\ir ../migrations/318_department_homes.sql
\ir ../migrations/319_department_services.sql
\ir ../migrations/320_ministry_rocks.sql
\ir ../migrations/321_department_budgets.sql
UPDATE public.staff_ministries
   SET is_active = false
 WHERE slug IN ('hulk', 'missio_ministry', 'be_free');
\ir ../migrations/318_department_homes.sql
DO $do$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.staff_ministries
   WHERE slug IN ('hulk', 'missio_ministry', 'be_free') AND is_active;
  PERFORM public._t('re-run does not reactivate a deactivated ministry', n = 0, 'n=' || n);
END
$do$;
UPDATE public.staff_ministries
   SET is_active = true
 WHERE slug IN ('hulk', 'missio_ministry', 'be_free');
\ir ../migrations/318_department_homes.sql
\ir ../migrations/319_department_services.sql
\ir ../migrations/320_ministry_rocks.sql
\ir ../migrations/321_department_budgets.sql

DO $do$
DECLARE
  n int;
  finance uuid;
  hulk uuid;
  missio_name text;
  missio_cluster text;
  missio_purpose text;
  hulk_cluster text;
  hulk_purpose text;
  hulk_type text;
  hulk_active boolean;
  donors_parent uuid;
  donors_active boolean;
  be_type text;
  be_active boolean;
  palette_color text;
  palette_link uuid;
  be_id uuid;
BEGIN
  SELECT id INTO finance FROM public.staff_ministries WHERE slug = 'finances_legal';
  SELECT id INTO hulk FROM public.staff_ministries WHERE slug = 'hulk';
  SELECT id INTO be_id FROM public.staff_ministries WHERE slug = 'be_free';

  SELECT count(*) INTO n FROM public.staff_ministries WHERE slug = 'hulk';
  PERFORM public._t('one hulk row', n = 1, 'n=' || n);
  SELECT count(*) INTO n FROM public.staff_ministries WHERE slug = 'missio_ministry';
  PERFORM public._t('one missio row', n = 1, 'n=' || n);

  SELECT name, cluster, purpose, ministry_type, is_active
    INTO missio_name, missio_cluster, missio_purpose, hulk_type, hulk_active
    FROM public.staff_ministries WHERE slug = 'missio_ministry';
  PERFORM public._t('missio name kept', missio_name = 'Missio Church', coalesce(missio_name, 'null'));
  PERFORM public._t('missio cluster alongside', missio_cluster = 'alongside', coalesce(missio_cluster, 'null'));
  PERFORM public._t('missio purpose left null', missio_purpose IS NULL, coalesce(missio_purpose, 'null'));
  PERFORM public._t('missio is main', hulk_type = 'main', coalesce(hulk_type, 'null'));
  PERFORM public._t('missio is active', hulk_active, coalesce(hulk_active::text, 'null'));

  SELECT cluster, purpose, ministry_type, is_active
    INTO hulk_cluster, hulk_purpose, hulk_type, hulk_active
    FROM public.staff_ministries WHERE slug = 'hulk';
  PERFORM public._t('hulk cluster outward', hulk_cluster = 'outward', coalesce(hulk_cluster, 'null'));
  PERFORM public._t('hulk purpose left null', hulk_purpose IS NULL, coalesce(hulk_purpose, 'null'));
  PERFORM public._t('hulk is main and active', hulk_type = 'main' AND hulk_active, hulk_type || '/' || hulk_active::text);

  SELECT count(*) INTO n FROM (
    SELECT id, staff_ministry_id, user_id, member_role, is_point_leader, status FROM public.hulk_before
    EXCEPT
    SELECT mm.id, mm.staff_ministry_id, mm.user_id, mm.member_role, mm.is_point_leader, mm.status
      FROM public.staff_ministry_members mm WHERE mm.staff_ministry_id = hulk
  ) d;
  PERFORM public._t('hulk leaders unchanged', n = 0, 'except=' || n);
  SELECT count(*) INTO n FROM public.staff_ministry_members WHERE staff_ministry_id = hulk AND member_role = 'leader';
  PERFORM public._t('hulk still has 4 leaders', n = 4, 'n=' || n);

  SELECT parent_id, is_active INTO donors_parent, donors_active
    FROM public.staff_ministries WHERE slug = 'donors_dev';
  PERFORM public._t('donors parent is finances', donors_parent = finance, coalesce(donors_parent::text, 'null'));
  PERFORM public._t('donors row still active', donors_active, coalesce(donors_active::text, 'null'));
  SELECT count(*) INTO n FROM public.staff_ministry_members mm
    JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
   WHERE sm.slug = 'donors_dev';
  PERFORM public._t('donors member kept', n = 1, 'n=' || n);
  SELECT count(*) INTO n FROM public.staff_ministry_aliases a
    JOIN public.staff_ministries d ON d.id = a.staff_ministry_id AND d.slug = 'donors_dev'
   WHERE a.resolves_to_id = finance;
  PERFORM public._t('donors alias points at finances', n = 1, 'n=' || n);
  PERFORM public._t(
    'home id resolves donors',
    public.staff_ministry_home_id((SELECT id FROM public.staff_ministries WHERE slug = 'donors_dev')) = finance,
    'home'
  );

  SELECT ministry_type, is_active INTO be_type, be_active
    FROM public.staff_ministries WHERE slug = 'be_free';
  PERFORM public._t('be free is part_time', be_type = 'part_time', coalesce(be_type, 'null'));
  PERFORM public._t('be free is active', be_active, coalesce(be_active::text, 'null'));
  SELECT color, staff_ministry_id INTO palette_color, palette_link
    FROM public.ministries WHERE slug = 'be-free';
  PERFORM public._t('palette color kept', palette_color = '#abcdef', coalesce(palette_color, 'null'));
  PERFORM public._t('palette linked', palette_link = be_id, coalesce(palette_link::text, 'null'));
  SELECT count(*) INTO n FROM public.ministries WHERE slug = 'be-free';
  PERFORM public._t('one palette row', n = 1, 'n=' || n);
  SELECT count(*) INTO n FROM public.staff_ministry_members
   WHERE user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';
  PERFORM public._t('philip skipped when user is absent', n = 0, 'n=' || n);

  SELECT count(*) INTO n FROM public.services;
  PERFORM public._t('eight services', n = 8, 'n=' || n);
  SELECT count(*) INTO n FROM public.service_owners;
  PERFORM public._t('thirty three service grants', n = 33, 'n=' || n);
  SELECT count(*) INTO n FROM public.service_owners so
    JOIN public.staff_ministries sm ON sm.id = so.staff_ministry_id
   WHERE so.service_key = 'gear_hire' AND sm.slug = 'media'
     AND so.capability IN ('own', 'manage');
  PERFORM public._t('gear hire media has own and manage', n = 2, 'n=' || n);
  SELECT count(*) INTO n FROM public.service_owners so
    JOIN public.staff_ministries sm ON sm.id = so.staff_ministry_id
   WHERE so.service_key = 'communications' AND sm.slug = 'hulk' AND so.capability = 'use';
  PERFORM public._t('hulk communications is use', n = 1, 'n=' || n);
  SELECT count(*) INTO n FROM public.service_owners
   WHERE service_key = 'contacts' AND any_point_leader AND staff_ministry_id IS NULL
     AND capability = 'use' AND member_role = 'leader';
  PERFORM public._t('contacts point-leader row is a null ministry', n = 1, 'n=' || n);
  SELECT count(*) INTO n FROM public.service_owners
   WHERE open_to_all AND capability = 'use' AND staff_ministry_id IS NULL
     AND service_key IN ('gear_hire', 'evangelism', 'prayer_room', 'spaces', 'vehicles', 'brand_kit');
  PERFORM public._t('six open_to_all use rows', n = 6, 'n=' || n);
  SELECT count(*) INTO n FROM public.service_owners
   WHERE service_key IN ('communications', 'contacts') AND open_to_all;
  PERFORM public._t('communications and contacts are not open_to_all', n = 0, 'n=' || n);
  SELECT count(*) INTO n FROM public.service_owners WHERE capability = 'moderate';
  PERFORM public._t('no evangelism moderate grant row', n = 0, 'n=' || n);
  PERFORM public._t(
    'gear hire href',
    (SELECT admin_href FROM public.services WHERE service_key = 'gear_hire') = '/bookings/equipment',
    (SELECT admin_href FROM public.services WHERE service_key = 'gear_hire')
  );

  SELECT count(*) INTO n
    FROM public.department_budget_links l
    JOIN public.staff_ministries sm ON sm.id = l.staff_ministry_id AND sm.slug = 'hulk'
    JOIN public.finance_projects fp ON fp.id = l.finance_project_id AND fp.name = 'HULC';
  PERFORM public._t('hulk links only the SA HULC project', n = 1, 'n=' || n);
  SELECT count(*) INTO n
    FROM public.department_budget_links l
    JOIN public.finance_projects fp ON fp.id = l.finance_project_id AND fp.name = 'HULC Merch';
  PERFORM public._t('HULC Merch is not linked', n = 0, 'n=' || n);
  SELECT count(*) INTO n
    FROM public.department_budget_links l
    JOIN public.finance_projects fp ON fp.id = l.finance_project_id AND fp.name = 'Worship & Prayer';
  PERFORM public._t('Worship & Prayer is not linked', n = 0, 'n=' || n);
  SELECT count(*) INTO n
    FROM public.department_budget_links l
    JOIN public.finance_projects fp ON fp.id = l.finance_project_id AND fp.name = 'Missio - JHB';
  PERFORM public._t('Missio - JHB is not linked', n = 0, 'n=' || n);
  SELECT count(*) INTO n
    FROM public.department_budget_links l
    JOIN public.finance_projects fp ON fp.id = l.finance_project_id AND fp.name = '1040 Crossfit';
  PERFORM public._t('1040 Crossfit is not linked', n = 0, 'n=' || n);
  SELECT count(*) INTO n
    FROM public.department_budget_links l
    JOIN public.finance_projects fp ON fp.id = l.finance_project_id AND fp.name = 'Hope Again';
  PERFORM public._t('Hope Again project is not linked without a staff ministry', n = 0, 'n=' || n);
  SELECT count(*) INTO n
    FROM public.department_budget_links l
    JOIN public.staff_ministries sm ON sm.id = l.staff_ministry_id AND sm.slug = 'woven';
  PERFORM public._t('inactive Woven is not linked', n = 0, 'n=' || n);
  SELECT count(*) INTO n
    FROM public.department_budget_links l
    JOIN public.staff_ministries sm ON sm.id = l.staff_ministry_id AND sm.slug = 'media';
  PERFORM public._t('media links the SA project only', n = 1, 'n=' || n);
  SELECT count(*) INTO n
    FROM public.department_budget_links l
    JOIN public.finance_projects fp ON fp.id = l.finance_project_id
    JOIN public.finance_orgs o ON o.id = fp.org_id AND o.key = 'usa';
  PERFORM public._t('no USA org budget link', n = 0, 'n=' || n);
  SELECT count(*) INTO n FROM public.department_budget_links WHERE currency <> 'ZAR';
  PERFORM public._t('every budget link is ZAR', n = 0, 'n=' || n);

  SELECT count(*) INTO n FROM public.department_budget_links
   WHERE finance_project_id IS NOT NULL AND budget_cents = 0 AND spend_cents = 0
     AND year = EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  PERFORM public._t('seeded budget links are zero ZAR in the insert year', n = 3, 'n=' || n);
  SELECT count(*) INTO n FROM public.service_owners
   WHERE open_to_all AND capability <> 'use';
  PERFORM public._t('open_to_all never grants manage', n = 0, 'n=' || n);
  BEGIN
    INSERT INTO public.service_owners (
      service_key, staff_ministry_id, capability, member_role, any_point_leader, open_to_all
    ) VALUES ('gear_hire', NULL, 'manage', NULL, false, true);
    PERFORM public._t('open_to_all manage row is rejected', false, 'inserted');
  EXCEPTION WHEN check_violation THEN
    PERFORM public._t('open_to_all manage row is rejected', true, 'check');
  END;
  SELECT count(*) INTO n FROM public.service_owners so
    JOIN public.staff_ministries sm ON sm.id = so.staff_ministry_id
   WHERE so.service_key = 'brand_kit'
     AND so.capability IN ('own', 'manage')
     AND sm.slug = 'media';
  PERFORM public._t('brand kit own and manage stay with Media', n = 2, 'n=' || n);

  SELECT count(*) INTO n FROM pg_class
   WHERE relname IN (
     'staff_ministry_aliases', 'services', 'service_owners', 'rocks',
     'department_budget_links'
   ) AND relrowsecurity;
  PERFORM public._t('rls enabled on five new tables', n = 5, 'n=' || n);
  PERFORM public._t(
    'rollup is security invoker',
    EXISTS (
      SELECT 1 FROM pg_class
       WHERE relname = 'leadership_ministry_rollup'
         AND 'security_invoker=true' = ANY (reloptions)
    ),
    'options'
  );
  PERFORM public._t(
    'anon cannot select rocks',
    NOT has_table_privilege('anon', 'public.rocks', 'SELECT'),
    'grant'
  );
END
$do$;

-- Philip arrives. A third apply records him and does not duplicate.
INSERT INTO public.users (id, is_active) VALUES
  ('ac7d1c5e-4300-422f-9fad-d50c29a15ca6', true);
\ir ../migrations/318_department_homes.sql

DO $do$
DECLARE
  n int;
  point boolean;
  role text;
BEGIN
  SELECT count(*), bool_or(mm.is_point_leader)
    INTO n, point
    FROM public.staff_ministry_members mm
    JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
   WHERE sm.slug = 'be_free'
     AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'
     AND mm.member_role = 'leader'
     AND mm.status = 'active';
  PERFORM public._t('philip is the be free leader', n = 1, 'n=' || n);
  PERFORM public._t('philip is point leader', point, coalesce(point::text, 'null'));
  SELECT r.name INTO role
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
   WHERE ur.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'
     AND ur.scope_type IS NULL;
  PERFORM public._t('philip holds ministry_leader', role = 'ministry_leader', coalesce(role, 'null'));
  SELECT count(*) INTO n
    FROM public.staff_ministry_members mm
    JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
   WHERE sm.slug = 'no_ministry'
     AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';
  PERFORM public._t('part-time be free did not put philip on no ministry', n = 0, 'n=' || n);
  SELECT count(*) INTO n FROM public.org_edit_log
   WHERE table_name = 'staff_ministry_members' AND action = 'created'
     AND after ->> 'user_id' = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';
  PERFORM public._t('org edit log recorded philip', n >= 1, 'n=' || n);
END
$do$;

\ir ../migrations/318_department_homes.sql

DO $do$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.staff_ministry_members
   WHERE user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';
  PERFORM public._t('re-apply does not duplicate philip', n = 1, 'n=' || n);
  SELECT count(*) INTO n FROM public.user_roles
   WHERE user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';
  PERFORM public._t('re-apply does not duplicate philip role', n = 1, 'n=' || n);
  SELECT count(*) INTO n FROM public.staff_ministry_members mm
    JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
   WHERE sm.slug = 'hulk' AND mm.member_role = 'leader';
  PERFORM public._t('hulk leaders still 4 after philip', n = 4, 'n=' || n);
END
$do$;

-- Rocks, one operations budget for the write checks, then access.
INSERT INTO public.rocks (staff_ministry_id, quarter, title, status, notes)
SELECT id, '2026-Q1', slug || ' rock', 'on_track', 'note'
  FROM public.staff_ministries WHERE slug IN ('media', 'operations');
INSERT INTO public.department_budget_links (staff_ministry_id, budget_cents, currency, notes)
SELECT id, 100000, 'ZAR', 'rls fixture'
  FROM public.staff_ministries WHERE slug = 'operations';

DO $do$
BEGIN
  INSERT INTO public.rocks (staff_ministry_id, quarter, title)
  SELECT id, '2026-Q5', 'bad quarter' FROM public.staff_ministries WHERE slug = 'media';
  PERFORM public._t('quarter 5 rejected', false, 'inserted');
EXCEPTION WHEN check_violation THEN
  PERFORM public._t('quarter 5 rejected', true, 'check');
END
$do$;

DO $do$
BEGIN
  INSERT INTO public.department_budget_links (staff_ministry_id, budget_cents)
  SELECT id, -1 FROM public.staff_ministries WHERE slug = 'media';
  PERFORM public._t('negative budget rejected', false, 'inserted');
EXCEPTION WHEN check_violation THEN
  PERFORM public._t('negative budget rejected', true, 'check');
END
$do$;

-- ── Service use, as the signed-in user ──────────────────────
DO $do$
DECLARE
  ok boolean;
  finance uuid;
  donors uuid;
  n int;
BEGIN
  SELECT id INTO finance FROM public.staff_ministries WHERE slug = 'finances_legal';
  SELECT id INTO donors FROM public.staff_ministries WHERE slug = 'donors_dev';

  PERFORM set_config('request.jwt.claim.sub', 'e5555555-5555-4555-8555-555555555555', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.user_can_use_service('evangelism') INTO ok;
  PERFORM public._t('outsider can use evangelism', ok, ok::text);
  SELECT public.user_can_use_service('contacts') INTO ok;
  PERFORM public._t('outsider cannot use contacts', NOT ok, ok::text);
  SELECT public.user_can_use_service('communications') INTO ok;
  PERFORM public._t('outsider cannot use communications', NOT ok, ok::text);
  SELECT public.can_moderate_evangelism() INTO ok;
  PERFORM public._t('outsider cannot moderate evangelism', NOT ok, ok::text);
  SELECT count(*) INTO n FROM public.service_owners;
  PERFORM public._t('outsider can read service owners', n = 33, 'n=' || n);
  SELECT public.user_can_use_service('gear_hire') INTO ok;
  PERFORM public._t('non-member can use gear hire', ok, ok::text);
  SELECT count(*) INTO n
    FROM public.service_owners so
    JOIN public.staff_ministry_members mm ON mm.staff_ministry_id = so.staff_ministry_id
   WHERE so.service_key = 'gear_hire'
     AND so.capability = 'manage'
     AND mm.user_id = 'e5555555-5555-4555-8555-555555555555'
     AND mm.status = 'active';
  PERFORM public._t('non-member cannot manage gear hire', n = 0, 'n=' || n);
  BEGIN
    INSERT INTO public.service_owners (
      service_key, staff_ministry_id, capability, member_role, any_point_leader, admin_href
    )
    SELECT 'contacts', id, 'use', 'member', false, '/contacts'
      FROM public.staff_ministries WHERE slug = 'training';
    PERFORM public._t('outsider cannot write service owners', false, 'inserted');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM public._t('outsider cannot write service owners', true, 'denied');
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'e6666666-6666-4666-8666-666666666666', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.user_can_use_service('contacts') INTO ok;
  PERFORM public._t('training point leader can use contacts', ok, ok::text);
  SELECT public.user_can_use_service('communications') INTO ok;
  PERFORM public._t('training point leader cannot use communications', NOT ok, ok::text);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.user_can_use_service('contacts') INTO ok;
  PERFORM public._t('media member can use contacts', ok, ok::text);
  SELECT public.can_moderate_evangelism() INTO ok;
  PERFORM public._t('media member can moderate evangelism', ok, ok::text);
  EXECUTE 'RESET ROLE';
  UPDATE public.users SET is_active = false
   WHERE id = 'b1111111-1111-4111-8111-111111111111';
  PERFORM set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.can_moderate_evangelism() INTO ok;
  PERFORM public._t('inactive media member cannot moderate evangelism', NOT ok, ok::text);
  EXECUTE 'RESET ROLE';
  UPDATE public.users SET is_active = true
   WHERE id = 'b1111111-1111-4111-8111-111111111111';

  PERFORM set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.can_moderate_evangelism() INTO ok;
  PERFORM public._t('media leader moderates evangelism', ok, ok::text);
  SELECT public.user_can_use_service('communications') INTO ok;
  PERFORM public._t('media leader can use communications', ok, ok::text);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'c2222222-2222-4222-8222-222222222222', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.can_moderate_evangelism() INTO ok;
  PERFORM public._t('ops leader does not moderate evangelism', NOT ok, ok::text);
  SELECT public.user_can_use_service('spaces') INTO ok;
  PERFORM public._t('ops leader can use spaces', ok, ok::text);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'c1111111-1111-4111-8111-111111111111', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.user_can_use_service('contacts') INTO ok;
  PERFORM public._t('ops member cannot use contacts', NOT ok, ok::text);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.user_can_use_service('communications') INTO ok;
  PERFORM public._t('hulk leader has communications access', ok, ok::text);
  SELECT public.can_moderate_evangelism() INTO ok;
  PERFORM public._t('hulk leader moderates evangelism', ok, ok::text);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.user_can_use_service('gear_hire') INTO ok;
  PERFORM public._t('admin can use gear hire', ok, ok::text);
  SELECT public.can_moderate_evangelism() INTO ok;
  PERFORM public._t('admin can moderate evangelism', ok, ok::text);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'e3333333-3333-4333-8333-333333333333', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.user_can_use_service('evangelism') INTO ok;
  PERFORM public._t('inactive admin cannot use evangelism', NOT ok, ok::text);
  SELECT count(*) INTO n FROM public.services;
  PERFORM public._t('inactive admin cannot read services', n = 0, 'n=' || n);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'e7777777-7777-4777-8777-777777777777', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.user_can_use_service('communications') INTO ok;
  PERFORM public._t('donors member cannot use communications yet', NOT ok, ok::text);
  SELECT count(*) INTO n FROM public.staff_ministry_resolution WHERE slug = 'donors_dev' AND is_folded AND home_slug = 'finances_legal';
  PERFORM public._t('donors resolution is finances', n = 1, 'n=' || n);
  EXECUTE 'RESET ROLE';

  INSERT INTO public.service_owners (
    service_key, staff_ministry_id, capability, member_role, any_point_leader, admin_href
  )
  VALUES ('communications', finance, 'use', 'member', false, '/communications');

  PERFORM set_config('request.jwt.claim.sub', 'e7777777-7777-4777-8777-777777777777', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.user_can_use_service('communications') INTO ok;
  PERFORM public._t('donors member uses finances communications through the alias', ok, ok::text);
  SELECT count(*) INTO n FROM public.ministry_service_access
   WHERE staff_ministry_id = donors AND service_key = 'communications' AND capability = 'use';
  PERFORM public._t('service lookup for donors lists the finances grant', n = 1, 'n=' || n);
  EXECUTE 'RESET ROLE';

  DELETE FROM public.service_owners
   WHERE service_key = 'communications' AND staff_ministry_id = finance AND capability = 'use';

  PERFORM set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.services (service_key, label, admin_href)
  VALUES ('zzz_test', 'Temp', '/zzz');
  PERFORM public._t('org.manage can insert a service', true, 'inserted');
  EXECUTE 'RESET ROLE';
  DELETE FROM public.services WHERE service_key = 'zzz_test';
END
$do$;

-- ── Rocks ───────────────────────────────────────────────────
DO $do$
DECLARE
  media uuid;
  ops uuid;
  n int;
  got text;
BEGIN
  SELECT id INTO media FROM public.staff_ministries WHERE slug = 'media';
  SELECT id INTO ops FROM public.staff_ministries WHERE slug = 'operations';

  PERFORM set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.rocks WHERE staff_ministry_id = media;
  PERFORM public._t('media member reads own rocks', n = 1, 'n=' || n);
  SELECT count(*) INTO n FROM public.rocks WHERE staff_ministry_id = ops;
  PERFORM public._t('media member cannot read ops rocks', n = 0, 'n=' || n);
  SELECT count(*) INTO n FROM public.leadership_ministry_rollup;
  PERFORM public._t('media member cannot read the roll-up', n = 0, 'n=' || n);
  UPDATE public.rocks SET title = 'stolen' WHERE staff_ministry_id = media;
  EXECUTE 'RESET ROLE';
  SELECT r.title INTO got FROM public.rocks r WHERE r.staff_ministry_id = media;
  PERFORM public._t('media member cannot edit a rock', got = 'media rock', coalesce(got, 'null'));

  PERFORM set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.rocks SET notes = 'leader note' WHERE staff_ministry_id = media;
  BEGIN
    UPDATE public.rocks SET staff_ministry_id = ops WHERE staff_ministry_id = media;
    PERFORM public._t('media leader cannot move a rock to ops', false, 'moved');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM public._t('media leader cannot move a rock to ops', true, 'denied');
  END;
  EXECUTE 'RESET ROLE';
  SELECT notes INTO got FROM public.rocks WHERE staff_ministry_id = media;
  PERFORM public._t('media leader edited own rock', got = 'leader note', coalesce(got, 'null'));

  PERFORM set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.rocks;
  PERFORM public._t('leadership reads every rock', n = 2, 'n=' || n);
  SELECT count(*) INTO n FROM public.leadership_ministry_rollup WHERE source = 'rock';
  PERFORM public._t('leadership roll-up lists both rocks', n = 2, 'n=' || n);
  SELECT count(*) INTO n FROM public.leadership_ministry_rollup WHERE source = 'okr_objective';
  PERFORM public._t('leadership roll-up lists current objectives only', n = 2, 'n=' || n);
  SELECT count(*) INTO n FROM public.leadership_ministry_rollup
   WHERE leadership_ministry_rollup.title IN ('Archived media objective', 'Old media objective');
  PERFORM public._t('roll-up hides archived and previous-cycle objectives', n = 0, 'n=' || n);
  UPDATE public.rocks SET title = 'leadership edit' WHERE staff_ministry_id = ops;
  EXECUTE 'RESET ROLE';
  SELECT r.title INTO got FROM public.rocks r WHERE r.staff_ministry_id = ops;
  PERFORM public._t('leadership cannot edit a rock', got = 'operations rock', coalesce(got, 'null'));

  PERFORM set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.leadership_ministry_rollup;
  PERFORM public._t('admin reads the roll-up', n = 4, 'n=' || n);
  UPDATE public.rocks SET status = 'done' WHERE staff_ministry_id = ops;
  EXECUTE 'RESET ROLE';
  SELECT status INTO got FROM public.rocks WHERE staff_ministry_id = ops;
  PERFORM public._t('admin can edit any rock', got = 'done', coalesce(got, 'null'));

  PERFORM set_config('request.jwt.claim.sub', 'e3333333-3333-4333-8333-333333333333', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.rocks;
  PERFORM public._t('inactive admin reads no rocks', n = 0, 'n=' || n);
  BEGIN
    INSERT INTO public.rocks (staff_ministry_id, quarter, title)
    VALUES (media, '2026-Q2', 'inactive insert');
    PERFORM public._t('inactive admin cannot insert a rock', false, 'inserted');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM public._t('inactive admin cannot insert a rock', true, 'denied');
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'b3333333-3333-4333-8333-333333333333', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.rocks;
  PERFORM public._t('inactive leader reads no rocks', n = 0, 'n=' || n);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'e5555555-5555-4555-8555-555555555555', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.rocks;
  PERFORM public._t('outsider reads no rocks', n = 0, 'n=' || n);
  EXECUTE 'RESET ROLE';
  INSERT INTO public.user_roles (user_id, role_id)
  SELECT 'e5555555-5555-4555-8555-555555555555', id
    FROM public.roles WHERE name = 'leadership_team';
  PERFORM set_config('request.jwt.claim.sub', 'e5555555-5555-4555-8555-555555555555', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.rocks;
  PERFORM public._t('leadership role without membership reads no rocks', n = 0, 'n=' || n);
  EXECUTE 'RESET ROLE';
  DELETE FROM public.user_roles
   WHERE user_id = 'e5555555-5555-4555-8555-555555555555';
  UPDATE public.staff_ministries SET is_active = false WHERE slug = 'media';
  PERFORM set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.rocks;
  PERFORM public._t('member of an inactive ministry reads no rocks', n = 0, 'n=' || n);
  EXECUTE 'RESET ROLE';
  UPDATE public.staff_ministries SET is_active = true WHERE slug = 'media';

  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM 1 FROM public.rocks;
    PERFORM public._t('anon cannot read rocks', false, 'read');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM public._t('anon cannot read rocks', true, 'denied');
  END;
  EXECUTE 'RESET ROLE';
END
$do$;

-- ── Budgets ─────────────────────────────────────────────────
DO $do$
DECLARE
  media uuid;
  ops uuid;
  n int;
  amount bigint;
BEGIN
  SELECT id INTO media FROM public.staff_ministries WHERE slug = 'media';
  SELECT id INTO ops FROM public.staff_ministries WHERE slug = 'operations';

  PERFORM set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.department_budget_links WHERE staff_ministry_id = media;
  PERFORM public._t('media leader reads own budget', n = 1, 'n=' || n);
  SELECT count(*) INTO n FROM public.department_budget_links WHERE staff_ministry_id = ops;
  PERFORM public._t('media leader cannot read ops budget', n = 0, 'n=' || n);
  UPDATE public.department_budget_links SET budget_cents = 222 WHERE staff_ministry_id = media;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.department_budget_links
   WHERE staff_ministry_id = media AND budget_cents = 222;
  PERFORM public._t('media leader edited own budget', n = 1, 'n=' || n);

  PERFORM set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.department_budget_links;
  PERFORM public._t('media member cannot read budgets', n = 0, 'n=' || n);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'd3333333-3333-4333-8333-333333333333', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.department_budget_links;
  PERFORM public._t('unscoped finance.view reads every budget', n = 4, 'n=' || n);
  UPDATE public.department_budget_links SET budget_cents = 1 WHERE staff_ministry_id = ops;
  EXECUTE 'RESET ROLE';
  SELECT budget_cents INTO amount FROM public.department_budget_links WHERE notes = 'rls fixture';
  PERFORM public._t('finance.view cannot edit a budget', amount = 100000, coalesce(amount::text, 'null'));

  PERFORM set_config('request.jwt.claim.sub', 'd4444444-4444-4444-8444-444444444444', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.department_budget_links;
  PERFORM public._t('program-scoped finance.view reads no budget', n = 0, 'n=' || n);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'd5555555-5555-4555-8555-555555555555', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.department_budget_links;
  PERFORM public._t('unscoped finance.edit reads every budget', n = 4, 'n=' || n);
  UPDATE public.department_budget_links SET budget_cents = 2 WHERE staff_ministry_id = ops;
  EXECUTE 'RESET ROLE';
  SELECT budget_cents INTO amount FROM public.department_budget_links WHERE notes = 'rls fixture';
  PERFORM public._t('finance.edit cannot edit a department budget', amount = 100000, coalesce(amount::text, 'null'));

  PERFORM set_config('request.jwt.claim.sub', 'd2222222-2222-4222-8222-222222222222', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.department_budget_links;
  PERFORM public._t('finances member reads every budget', n = 4, 'n=' || n);
  SELECT count(*) INTO n FROM public.department_budget_links WHERE finance_project_id IS NOT NULL;
  PERFORM public._t('finances member reads project links', n = 3, 'n=' || n);
  UPDATE public.department_budget_links SET budget_cents = 3 WHERE staff_ministry_id = media;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.department_budget_links
   WHERE staff_ministry_id = media AND budget_cents = 222;
  PERFORM public._t('finances member cannot edit a budget', n = 1, 'n=' || n);

  PERFORM set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.department_budget_links;
  PERFORM public._t('leadership membership does not read budgets', n = 0, 'n=' || n);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'e4444444-4444-4444-8444-444444444444', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.department_budget_links;
  PERFORM public._t('inactive finance.view reads no budget', n = 0, 'n=' || n);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'e5555555-5555-4555-8555-555555555555', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.department_budget_links;
  PERFORM public._t('outsider reads no budget', n = 0, 'n=' || n);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'e3333333-3333-4333-8333-333333333333', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.department_budget_links;
  PERFORM public._t('inactive admin reads no budget', n = 0, 'n=' || n);
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.department_budget_links SET budget_cents = 50 WHERE staff_ministry_id = ops;
  EXECUTE 'RESET ROLE';
  SELECT budget_cents INTO amount FROM public.department_budget_links WHERE notes = 'rls fixture';
  PERFORM public._t('admin can edit any budget', amount = 50, coalesce(amount::text, 'null'));
END
$do$;

-- The table already exists. Dropping the check and pasting 319 again
-- must put the named constraint back.
ALTER TABLE public.service_owners DROP CONSTRAINT service_owners_open_to_all_use_ck;
\ir ../migrations/319_department_services.sql
DO $do$
DECLARE
  ok boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_owners_open_to_all_use_ck'
       AND conrelid = 'public.service_owners'::regclass
  ) THEN
    RAISE EXCEPTION 'replay did not restore service_owners_open_to_all_use_ck';
  END IF;
  BEGIN
    INSERT INTO public.service_owners (
      service_key, staff_ministry_id, capability, member_role, any_point_leader, open_to_all
    ) VALUES ('gear_hire', NULL, 'manage', NULL, false, true);
    ok := false;
  EXCEPTION WHEN check_violation THEN
    ok := true;
  END;
  PERFORM public._t('replay restores the open_to_all use check', ok, ok::text);
END
$do$;

-- Demote Philip, then re-run homes. The membership must stay demoted.
UPDATE public.staff_ministry_members mm
   SET member_role = 'member', is_point_leader = false
  FROM public.staff_ministries sm
 WHERE sm.slug = 'be_free'
   AND mm.staff_ministry_id = sm.id
   AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';
\ir ../migrations/318_department_homes.sql
DO $do$
DECLARE
  role text;
  point boolean;
BEGIN
  SELECT mm.member_role, mm.is_point_leader INTO role, point
    FROM public.staff_ministry_members mm
    JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
   WHERE sm.slug = 'be_free'
     AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';
  PERFORM public._t('re-run does not re-promote Philip', role = 'member' AND point IS FALSE, coalesce(role, 'null'));
END
$do$;

-- Philip stays in Prayer & Worship, a main ministry, so deleting the
-- part-time be_free membership does not put him on No Ministry.
INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status)
SELECT id, 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6', 'member', 'active'
  FROM public.staff_ministries WHERE slug = 'prayer_and_worship';

-- An OKR on be_free is a dependent 318 did not create. The rollback must
-- refuse and leave the schema in place. Then drop that row and roll back.
INSERT INTO public.okr_objectives (cycle_id, staff_ministry_id, scope, title, is_archived)
SELECT c.id, sm.id, 'ministry', 'do not cascade be_free', false
  FROM public.okr_cycles c, public.staff_ministries sm
 WHERE c.is_current AND sm.slug = 'be_free';

\set ON_ERROR_STOP off
\ir ../rollbacks/318_321_departments_rollback.sql
\set ON_ERROR_STOP on

DO $do$
BEGIN
  IF to_regclass('public.rocks') IS NULL
     OR to_regclass('public.department_budget_links') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.staff_ministries WHERE slug = 'be_free') THEN
    RAISE EXCEPTION 'be_free dependent did not stop the rollback';
  END IF;
  PERFORM public._t(
    'be_free okr stops the rollback',
    EXISTS (SELECT 1 FROM public.staff_ministries WHERE slug = 'be_free'),
    'be_free'
  );
END
$do$;

DELETE FROM public.okr_objectives WHERE title = 'do not cascade be_free';

-- The subcategory lives on Prayer & Worship, so it is not a dependent of
-- the be_free ministry. The join row hangs off Philip's tracked be_free
-- membership, which the rollback would delete.
INSERT INTO public.staff_ministry_subcategories (staff_ministry_id, name)
SELECT id, 'Be Free seat'
  FROM public.staff_ministries WHERE slug = 'prayer_and_worship';
INSERT INTO public.staff_ministry_member_subcategories (membership_id, subcategory_id)
SELECT mm.id, sc.id
  FROM public.staff_ministry_members mm
  JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id AND sm.slug = 'be_free'
  JOIN public.staff_ministry_subcategories sc ON sc.name = 'Be Free seat'
 WHERE mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';

\set ON_ERROR_STOP off
\ir ../rollbacks/318_321_departments_rollback.sql
\set ON_ERROR_STOP on

DO $do$
BEGIN
  IF to_regclass('public.rocks') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.staff_ministries WHERE slug = 'be_free')
     OR NOT EXISTS (
       SELECT 1 FROM public.staff_ministry_member_subcategories sc
         JOIN public.staff_ministry_members mm ON mm.id = sc.membership_id
         JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
        WHERE sm.slug = 'be_free'
          AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'
     ) THEN
    RAISE EXCEPTION 'be_free membership subcategory did not stop the rollback';
  END IF;
  PERFORM public._t(
    'be_free membership subcategory stops the rollback',
    EXISTS (SELECT 1 FROM public.staff_ministries WHERE slug = 'be_free'),
    'be_free'
  );
END
$do$;

DELETE FROM public.staff_ministry_member_subcategories sc
 USING public.staff_ministry_members mm, public.staff_ministries sm
 WHERE sc.membership_id = mm.id
   AND mm.staff_ministry_id = sm.id
   AND sm.slug = 'be_free'
   AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';

-- be_free was not inserted by 318. The membership 318 did insert still
-- has a subcategory, so the membership loop must refuse on its own.
CREATE TEMP TABLE saved_be_free_insert AS
SELECT *
  FROM public.migration_318_changes
 WHERE kind = 'insert'
   AND table_name = 'staff_ministries'
   AND row_id = (SELECT id FROM public.staff_ministries WHERE slug = 'be_free');
DELETE FROM public.migration_318_changes
 WHERE kind = 'insert'
   AND table_name = 'staff_ministries'
   AND row_id = (SELECT id FROM public.staff_ministries WHERE slug = 'be_free');
INSERT INTO public.staff_ministry_member_subcategories (membership_id, subcategory_id)
SELECT mm.id, sc.id
  FROM public.staff_ministry_members mm
  JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id AND sm.slug = 'be_free'
  JOIN public.staff_ministry_subcategories sc ON sc.name = 'Be Free seat'
 WHERE mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';

\set ON_ERROR_STOP off
\ir ../rollbacks/318_321_departments_rollback.sql
\set ON_ERROR_STOP on

DO $do$
BEGIN
  IF to_regclass('public.rocks') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.staff_ministries WHERE slug = 'be_free')
     OR EXISTS (
       SELECT 1 FROM public.migration_318_changes
        WHERE kind = 'insert'
          AND table_name = 'staff_ministries'
          AND row_id = (SELECT id FROM public.staff_ministries WHERE slug = 'be_free')
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.staff_ministry_member_subcategories sc
         JOIN public.staff_ministry_members mm ON mm.id = sc.membership_id
         JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
        WHERE sm.slug = 'be_free'
          AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'
     ) THEN
    RAISE EXCEPTION 'tracked membership subcategory did not stop the rollback';
  END IF;
  PERFORM public._t(
    'tracked membership subcategory stops the rollback without a be_free insert',
    EXISTS (SELECT 1 FROM public.staff_ministries WHERE slug = 'be_free'),
    'be_free'
  );
END
$do$;

DELETE FROM public.staff_ministry_member_subcategories sc
 USING public.staff_ministry_members mm, public.staff_ministries sm
 WHERE sc.membership_id = mm.id
   AND mm.staff_ministry_id = sm.id
   AND sm.slug = 'be_free'
   AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';
INSERT INTO public.migration_318_changes
OVERRIDING SYSTEM VALUE
SELECT * FROM saved_be_free_insert;
DROP TABLE saved_be_free_insert;

-- Prod shape: version is the apply timestamp, name is the file stem.
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  name text
);
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261110094706', '311_evangelism_open_publish_and_moderate'),
  ('20261110180001', '318_department_homes'),
  ('20261110180002', '319_department_services'),
  ('20261110180003', '320_ministry_rocks'),
  ('20261110180004', '321_department_budgets'),
  ('318', NULL),
  ('319', '319_unrelated_name');

\ir ../rollbacks/318_321_departments_rollback.sql

DO $do$
DECLARE
  n int;
  donors_parent uuid;
  link uuid;
  stamp timestamptz;
  prior timestamptz;
  body text;
BEGIN
  SELECT be_free_updated INTO prior FROM public.pre_apply;
  SELECT parent_id INTO donors_parent FROM public.staff_ministries WHERE slug = 'donors_dev';
  PERFORM public._t(
    'rollback clears the donors parent 318 set',
    donors_parent IS NULL,
    coalesce(donors_parent::text, 'null')
  );
  SELECT staff_ministry_id, updated_at INTO link, stamp
    FROM public.ministries WHERE slug = 'be-free';
  PERFORM public._t('rollback clears the be-free link', link IS NULL, coalesce(link::text, 'null'));
  PERFORM public._t(
    'rollback restores the recorded be-free timestamp',
    stamp = prior,
    coalesce(stamp::text, 'null')
  );
  SELECT count(*) INTO n FROM public.staff_ministries WHERE slug = 'be_free';
  PERFORM public._t('rollback removes the be_free ministry 318 inserted', n = 0, 'n=' || n);
  SELECT count(*) INTO n
    FROM public.staff_ministry_members
   WHERE user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6'
     AND staff_ministry_id = (SELECT id FROM public.staff_ministries WHERE slug = 'prayer_and_worship');
  PERFORM public._t('Philip stays in Prayer and Worship', n = 1, 'n=' || n);
  SELECT count(*) INTO n
    FROM public.staff_ministry_members mm
    JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
   WHERE sm.slug = 'no_ministry'
     AND mm.user_id = 'ac7d1c5e-4300-422f-9fad-d50c29a15ca6';
  PERFORM public._t('No Ministry sync does not add Philip', n = 0, 'n=' || n);
  SELECT pg_get_functiondef('public.can_moderate_evangelism()'::regprocedure) INTO body;
  PERFORM public._t(
    'rollback restores can_moderate_evangelism from 311',
    body LIKE '%public.is_admin() OR public.has_permission(''evangelism.moderate'')%'
      AND body NOT LIKE '%staff_ministries%',
    'def'
  );
  PERFORM public._t(
    'rollback clears the can_moderate comment 311 never set',
    obj_description('public.can_moderate_evangelism()'::regprocedure) IS NULL,
    coalesce(obj_description('public.can_moderate_evangelism()'::regprocedure), 'null')
  );
  PERFORM public._t('rocks table is gone', to_regclass('public.rocks') IS NULL, 'reg');
  PERFORM public._t('budget links table is gone', to_regclass('public.department_budget_links') IS NULL, 'reg');
  PERFORM public._t('service owners table is gone', to_regclass('public.service_owners') IS NULL, 'reg');
  SELECT count(*) INTO n
    FROM supabase_migrations.schema_migrations
   WHERE name IN (
     '318_department_homes',
     '319_department_services',
     '320_ministry_rocks',
     '321_department_budgets'
   )
      OR (
        version IN ('318', '319', '320', '321')
        AND (
          name IS NULL
          OR name IN (
            '318_department_homes',
            '319_department_services',
            '320_ministry_rocks',
            '321_department_budgets'
          )
        )
      );
  PERFORM public._t('rollback removes timestamp-style migration rows', n = 0, 'n=' || n);
  SELECT count(*) INTO n
    FROM supabase_migrations.schema_migrations
   WHERE version = '319' AND name = '319_unrelated_name';
  PERFORM public._t('rollback keeps a short version with another name', n = 1, 'n=' || n);
  SELECT count(*) INTO n
    FROM supabase_migrations.schema_migrations
   WHERE version = '20261110094706'
     AND name = '311_evangelism_open_publish_and_moderate';
  PERFORM public._t('rollback keeps the 311 migration row', n = 1, 'n=' || n);
END
$do$;

\ir ../migrations/318_department_homes.sql
\ir ../migrations/319_department_services.sql
\ir ../migrations/320_ministry_rocks.sql
\ir ../migrations/321_department_budgets.sql

DO $do$
DECLARE
  n int;
  linked boolean;
BEGIN
  SELECT count(*) INTO n FROM public.staff_ministries WHERE slug = 'be_free';
  PERFORM public._t('re-apply after rollback recreates be_free', n = 1, 'n=' || n);
  SELECT count(*), bool_or(m.staff_ministry_id IS NOT NULL) INTO n, linked
    FROM public.ministries m WHERE m.slug = 'be-free';
  PERFORM public._t('re-apply after rollback links be-free', n = 1 AND linked, 'n=' || n);
  SELECT count(*) INTO n FROM public.service_owners WHERE open_to_all AND capability = 'use';
  PERFORM public._t('re-apply restores six open_to_all use rows', n = 6, 'n=' || n);

  -- A row 318 inserted, then deliberately deleted, is not recreated.
  UPDATE public.ministries SET staff_ministry_id = NULL WHERE slug = 'be-free';
  DELETE FROM public.staff_ministries WHERE slug = 'be_free';
END
$do$;

\ir ../migrations/318_department_homes.sql

DO $do$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.staff_ministries WHERE slug = 'be_free';
  PERFORM public._t('re-run does not recreate a deleted be_free', n = 0, 'n=' || n);
  SELECT count(*) INTO n FROM public.t_checks WHERE NOT ok;
  IF n > 0 THEN
    RAISE EXCEPTION 'departments services checks failed (%): %', n,
      (SELECT string_agg(name || ' — ' || detail, ' | ' ORDER BY name)
         FROM public.t_checks WHERE NOT ok);
  END IF;
  RAISE NOTICE 'departments services: % checks passed', (SELECT count(*) FROM public.t_checks);
END
$do$;
