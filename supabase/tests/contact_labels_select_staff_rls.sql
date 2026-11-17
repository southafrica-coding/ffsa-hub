-- Disposable check for migration 330. Not a migration.
-- Stubs the CRM tables 042/087 left behind, applies 329 (so the Missio
-- label trigger is the real function) and then 330 twice.
--
--   dropdb --if-exists contact_labels_select_staff && createdb contact_labels_select_staff
--   psql -v ON_ERROR_STOP=1 -d contact_labels_select_staff -f supabase/tests/contact_labels_select_staff_rls.sql
--
-- Never point this at a shared or hosted database. service_role is
-- given BYPASSRLS here because that is how Supabase's service role
-- skips RLS.

\set ON_ERROR_STOP 1

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER ROLE service_role BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email text,
  contact_id uuid
);
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  preferred_name text,
  email text,
  status text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL
);
CREATE TABLE public.contact_labels (
  contact_id uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES public.labels (id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_via text NOT NULL,
  added_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  PRIMARY KEY (contact_id, label_id)
);
CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL
);
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles (id)
);
CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL
);
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions (id)
);

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(required_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.name = ANY (required_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(required_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_role(ARRAY[required_role]);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_any_role(ARRAY['super_admin', 'admin']);
$$;

CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
    WHERE up.user_id = auth.uid()
      AND p.key = required_permission
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_contact_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT contact_id FROM public.users WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.has_any_role(text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_contact_id() TO anon, authenticated, service_role;

-- Contacts SELECT, as 087 left it, plus the own-row policy 087 kept.
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.contacts TO authenticated;
REVOKE ALL ON public.contacts FROM anon;

CREATE POLICY "Users can read own contact record"
  ON public.contacts FOR SELECT
  USING (id = public.get_my_contact_id());

CREATE POLICY "Admins and staff can read all contacts"
  ON public.contacts FOR SELECT
  USING (
    public.has_any_role(ARRAY['super_admin','admin','staff','events_admin'])
    OR public.has_permission('contacts.view')
    OR public.has_permission('contacts.read')
  );

-- contact_labels as 042 left it, before 330.
ALTER TABLE public.contact_labels ENABLE ROW LEVEL SECURITY;
-- Hosted Supabase grants SELECT to anon as well as authenticated. 330
-- does not revoke that grant; anon has no passing SELECT policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_labels TO authenticated;
GRANT SELECT ON public.contact_labels TO anon;
GRANT ALL ON public.contact_labels TO service_role;

CREATE POLICY "Auth users can read contact labels"
  ON public.contact_labels FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and comms can manage contact labels"
  ON public.contact_labels FOR ALL
  USING (public.is_admin() OR public.has_role('comms_admin') OR public.has_role('events_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('comms_admin') OR public.has_role('events_admin'));

-- labels stay on the 042 SELECT. 330 must not replace it.
ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.labels TO authenticated;
REVOKE ALL ON public.labels FROM anon;
CREATE POLICY "Auth users can read labels"
  ON public.labels FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 329's new tables are created by the current role. Grant them the way
-- hosted Supabase does, so service_role can insert org_people.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

INSERT INTO public.labels (slug, name) VALUES ('missio', 'Missio'), ('ffsa-family', 'FFSA Family');

INSERT INTO public.contacts (id, first_name, last_name, email) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'Pat', 'Portal', 'pat@example.test'),
  ('c2222222-2222-2222-2222-222222222222', 'Ada', 'Applicant', 'ada@example.test'),
  ('c3333333-3333-3333-3333-333333333333', 'Sam', 'Secret', 'sam@example.test');

INSERT INTO public.users (id, email, contact_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'pat@example.test', 'c1111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222', 'ada@example.test', 'c2222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333', 'view@example.test', NULL),
  ('55555555-5555-5555-5555-555555555555', 'read@example.test', NULL),
  ('44444444-4444-4444-4444-444444444444', 'staff@example.test', NULL),
  ('66666666-6666-6666-6666-666666666666', 'comms@example.test', NULL);

-- The leak: application provenance visible to any signed-in user before 330.
INSERT INTO public.contact_labels (contact_id, label_id, added_via)
SELECT 'c3333333-3333-3333-3333-333333333333', id, 'application:app-leak'
FROM public.labels WHERE slug = 'ffsa-family';
INSERT INTO public.contact_labels (contact_id, label_id, added_via)
SELECT 'c1111111-1111-1111-1111-111111111111', id, 'application:app-portal'
FROM public.labels WHERE slug = 'ffsa-family';

INSERT INTO public.roles (name) VALUES
  ('staff'), ('comms_admin'), ('events_admin'), ('admin'), ('super_admin');
INSERT INTO public.permissions (key) VALUES ('contacts.view'), ('contacts.read');

INSERT INTO public.user_roles (user_id, role_id)
SELECT '44444444-4444-4444-4444-444444444444', id FROM public.roles WHERE name = 'staff';
INSERT INTO public.user_roles (user_id, role_id)
SELECT '66666666-6666-6666-6666-666666666666', id FROM public.roles WHERE name = 'comms_admin';
INSERT INTO public.user_permissions (user_id, permission_id)
SELECT '33333333-3333-3333-3333-333333333333', id FROM public.permissions WHERE key = 'contacts.view';
INSERT INTO public.user_permissions (user_id, permission_id)
SELECT '55555555-5555-5555-5555-555555555555', id FROM public.permissions WHERE key = 'contacts.read';

\ir ../migrations/329_missio_org_phase0.sql
\ir ../migrations/330_contact_labels_select_staff.sql
\ir ../migrations/330_contact_labels_select_staff.sql

-- Stand-ins for the security_invoker CRM views (049 / 166 / 234). The
-- real views are not created by 329. The join is the part 330 changes:
-- the caller must pass both contacts RLS and contact_labels RLS.
CREATE OR REPLACE VIEW public.v_contact_summary
WITH (security_invoker = true) AS
SELECT
  c.id,
  COALESCE(
    array_agg(cl.added_via) FILTER (WHERE cl.contact_id IS NOT NULL),
    ARRAY[]::text[]
  ) AS added_via
FROM public.contacts c
LEFT JOIN public.contact_labels cl ON cl.contact_id = c.id
GROUP BY c.id;

CREATE OR REPLACE VIEW public.v_campaign_audience
WITH (security_invoker = true) AS
SELECT cl.contact_id, cl.added_via, c.email
FROM public.contact_labels cl
JOIN public.contacts c ON c.id = cl.contact_id;

GRANT SELECT ON public.v_contact_summary, public.v_campaign_audience TO authenticated, service_role;

-- ── Harness (same shape as missio_org_phase0_rls.sql) ────
CREATE TEMP TABLE checks (
  n serial,
  label text,
  got text,
  want text,
  ok boolean
);

CREATE FUNCTION pg_temp.expect(label text, got text, want text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO checks (label, got, want, ok)
  VALUES (label, got, want, got IS NOT DISTINCT FROM want);
  IF got IS DISTINCT FROM want THEN
    RAISE NOTICE 'FAIL %: got [%] want [%]', label, got, want;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.become(who text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF who = 'anon' THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE 'SET LOCAL ROLE anon';
  ELSIF who = 'service' THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE 'SET LOCAL ROLE service_role';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', who, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.exec(who text, stmt text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  PERFORM pg_temp.become(who);
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  RETURN 'rows=' || n;
EXCEPTION WHEN OTHERS THEN
  RETURN 'err ' || SQLSTATE;
END;
$$;

CREATE FUNCTION pg_temp.scalar(who text, stmt text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM pg_temp.become(who);
  EXECUTE stmt INTO v;
  EXECUTE 'RESET ROLE';
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN 'err ' || SQLSTATE;
END;
$$;

-- Broad policy is gone. The staff policy replaced it. Run twice, so
-- the name is still singular.
SELECT pg_temp.expect('broad authenticated SELECT policy is gone',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contact_labels'
      AND policyname = 'Auth users can read contact labels'),
  '0');
SELECT pg_temp.expect('staff SELECT policy exists once',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contact_labels'
      AND policyname = 'Staff can read contact labels'),
  '1');
SELECT pg_temp.expect('write policy was not replaced',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contact_labels'
      AND policyname = 'Admins and comms can manage contact labels'),
  '1');
SELECT pg_temp.expect('labels SELECT policy was not replaced',
  (SELECT policyname || ' ' || qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'labels'
      AND cmd = 'SELECT'),
  'Auth users can read labels (auth.uid() IS NOT NULL)');

-- Portal user and applicant see no contact_labels rows, including the
-- portal user's own application tag.
SELECT pg_temp.expect('portal user sees 0 contact_labels',
  pg_temp.scalar('11111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.contact_labels$$),
  '0');
SELECT pg_temp.expect('applicant sees 0 contact_labels',
  pg_temp.scalar('22222222-2222-2222-2222-222222222222',
    $$SELECT count(*)::text FROM public.contact_labels$$),
  '0');
SELECT pg_temp.expect('anon sees 0 contact_labels',
  pg_temp.scalar('anon',
    $$SELECT count(*)::text FROM public.contact_labels$$),
  '0');

SELECT pg_temp.expect('contacts.view sees the application tag',
  pg_temp.scalar('33333333-3333-3333-3333-333333333333', $$
    SELECT count(*)::text FROM public.contact_labels
    WHERE added_via = 'application:app-leak'
  $$),
  '1');
SELECT pg_temp.expect('contacts.read sees the application tag',
  pg_temp.scalar('55555555-5555-5555-5555-555555555555', $$
    SELECT count(*)::text FROM public.contact_labels
    WHERE added_via = 'application:app-leak'
  $$),
  '1');
SELECT pg_temp.expect('staff role sees the application tag',
  pg_temp.scalar('44444444-4444-4444-4444-444444444444', $$
    SELECT count(*)::text FROM public.contact_labels
    WHERE added_via = 'application:app-leak'
  $$),
  '1');
-- Residual, not removed: the 042 FOR ALL policy still selects for comms_admin.
SELECT pg_temp.expect('comms_admin still sees rows via the manage policy',
  pg_temp.scalar('66666666-6666-6666-6666-666666666666', $$
    SELECT count(*)::text FROM public.contact_labels
    WHERE added_via = 'application:app-leak'
  $$),
  '1');

SELECT pg_temp.expect('service role still sees both tags',
  pg_temp.scalar('service',
    $$SELECT count(*)::text FROM public.contact_labels$$),
  '2');

-- security_invoker views: portal sees their own contact and no label;
-- contacts.view sees the leak through the audience view.
SELECT pg_temp.expect('portal contact summary has no added_via',
  pg_temp.scalar('11111111-1111-1111-1111-111111111111', $$
    SELECT coalesce(array_length(added_via, 1), 0)::text
    FROM public.v_contact_summary
    WHERE id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  '0');
SELECT pg_temp.expect('portal audience view is empty',
  pg_temp.scalar('11111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.v_campaign_audience$$),
  '0');
SELECT pg_temp.expect('contacts.view audience view includes the leak',
  pg_temp.scalar('33333333-3333-3333-3333-333333333333', $$
    SELECT count(*)::text FROM public.v_campaign_audience
    WHERE added_via = 'application:app-leak'
  $$),
  '1');

-- labels stayed open to any signed-in user.
SELECT pg_temp.expect('portal can still read labels',
  pg_temp.scalar('11111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.labels$$),
  '2');

-- Missio sync: service-role insert/delete on org_people still mirrors.
SELECT pg_temp.expect('service role insert org_people',
  pg_temp.exec('service', $$
    INSERT INTO public.org_people (org_id, contact_id)
    SELECT id, 'c2222222-2222-2222-2222-222222222222'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('sync trigger added org_people_sync',
  (SELECT added_via FROM public.contact_labels cl
    JOIN public.labels l ON l.id = cl.label_id
    WHERE cl.contact_id = 'c2222222-2222-2222-2222-222222222222'
      AND l.slug = 'missio'),
  'org_people_sync');
SELECT pg_temp.expect('portal still sees 0 after the sync insert',
  pg_temp.scalar('11111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.contact_labels$$),
  '0');
SELECT pg_temp.expect('contacts.view sees the synced label',
  pg_temp.scalar('33333333-3333-3333-3333-333333333333', $$
    SELECT count(*)::text FROM public.contact_labels
    WHERE added_via = 'org_people_sync'
  $$),
  '1');
SELECT pg_temp.expect('service role delete org_people',
  pg_temp.exec('service', $$
    DELETE FROM public.org_people
    WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'
  $$),
  'rows=1');
SELECT pg_temp.expect('sync trigger removed org_people_sync',
  (SELECT count(*)::text FROM public.contact_labels
    WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'
      AND added_via = 'org_people_sync'),
  '0');
SELECT pg_temp.expect('application tag survived the org delete',
  (SELECT count(*)::text FROM public.contact_labels
    WHERE added_via = 'application:app-leak'),
  '1');

DO $$
DECLARE
  n_pass int;
  n_fail int;
  rec record;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok)
    INTO n_pass, n_fail
  FROM checks;
  RAISE NOTICE 'contact_labels_select_staff_rls: % passed, % failed', n_pass, n_fail;
  IF n_fail > 0 THEN
    FOR rec IN SELECT n, label, got, want FROM checks WHERE NOT ok ORDER BY n LOOP
      RAISE WARNING 'FAIL %: % got [%] want [%]', rec.n, rec.label, rec.got, rec.want;
    END LOOP;
    RAISE EXCEPTION '% check(s) failed', n_fail;
  END IF;
END $$;
