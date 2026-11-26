-- Disposable role-matrix check for migration 329. Not a migration.
-- Stubs the FFSA tables and helpers 329 calls, applies 329 twice, then
-- reads and writes as Missio roles, FFSA staff / admin / super_admin,
-- a contacts.view holder, a pastor of another org, a plain user,
-- the service role, and anon.
--
--   dropdb --if-exists missio_org_phase0 && createdb missio_org_phase0
--   psql -v ON_ERROR_STOP=1 -d missio_org_phase0 -f supabase/tests/missio_org_phase0_rls.sql
--
-- Never point this at a shared or hosted database. service_role is
-- given BYPASSRLS here because that is how Supabase's service role
-- passes the hard wall (there is no policy for it to pass).

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

-- Helpers 329 does not replace. Shaped like production: is_admin is
-- super_admin or admin, and it is NOT a Missio membership.
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

CREATE OR REPLACE FUNCTION public.has_role(
  required_role text,
  check_scope_type text DEFAULT NULL,
  check_scope_id uuid DEFAULT NULL
)
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

-- Existing contacts policies, as 005 + 087 left them. 329 must add
-- exactly one SELECT and must not replace these.
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
REVOKE ALL ON public.contacts FROM anon;

CREATE POLICY "Users can read own contact record"
  ON public.contacts FOR SELECT
  USING (id = public.get_my_contact_id());

CREATE POLICY "Admins and staff can read all contacts"
  ON public.contacts FOR SELECT
  USING (
    public.has_any_role(ARRAY['super_admin', 'admin', 'staff', 'events_admin'])
    OR public.has_permission('contacts.view')
    OR public.has_permission('contacts.read')
  );

CREATE POLICY "Admins can insert contacts"
  ON public.contacts FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('contacts.create')
    OR public.has_permission('contacts.write')
  );

CREATE POLICY "Admins can update contacts"
  ON public.contacts FOR UPDATE
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('contacts.edit')
    OR public.has_permission('contacts.write')
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('contacts.edit')
    OR public.has_permission('contacts.write')
  );

CREATE POLICY "Admins can delete contacts"
  ON public.contacts FOR DELETE
  USING (public.is_admin() OR public.has_permission('contacts.delete'));

-- contact_labels stays as 042 left it: any signed-in user can read,
-- only admin / comms / events_admin can write. The sync trigger has
-- to land rows anyway, because a Missio pastor is none of those.
ALTER TABLE public.contact_labels ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_labels TO authenticated;
REVOKE ALL ON public.contact_labels FROM anon;

CREATE POLICY "Auth users can read contact labels"
  ON public.contact_labels FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and comms can manage contact labels"
  ON public.contact_labels FOR ALL
  USING (public.is_admin() OR public.has_role('comms_admin') OR public.has_role('events_admin'))
  WITH CHECK (public.is_admin() OR public.has_role('comms_admin') OR public.has_role('events_admin'));

ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.labels TO authenticated;
REVOKE ALL ON public.labels FROM anon;
CREATE POLICY "Auth users can read labels"
  ON public.labels FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Hosted Supabase grants new public tables and functions to anon and
-- authenticated. 329 must revoke anon and tighten authenticated.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- The missio label already exists on prod. Looked up by slug.
INSERT INTO public.labels (slug, name) VALUES ('missio', 'Missio');

\ir ../migrations/329_missio_org_phase0.sql
\ir ../migrations/329_missio_org_phase0.sql

-- 046 records an unsubscribe on contact_labels delete, but bails when
-- the delete is nested (pg_trigger_depth() > 1). The sync delete is
-- nested. This stub proves that interaction does not error and does
-- not opt the person out.
CREATE TABLE public.unsubscribes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  label_id uuid REFERENCES public.labels (id) ON DELETE CASCADE,
  source text NOT NULL,
  reason text,
  UNIQUE (contact_id, label_id)
);

CREATE OR REPLACE FUNCTION public.contact_label_removal_records_unsubscribe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  INSERT INTO public.unsubscribes (contact_id, label_id, source, reason)
  VALUES (OLD.contact_id, OLD.label_id, 'staff_manual', 'label removed')
  ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_contact_labels_removal_unsubscribe
  AFTER DELETE ON public.contact_labels
  FOR EACH ROW
  EXECUTE FUNCTION public.contact_label_removal_records_unsubscribe();

-- ── Fixtures ──────────────────────────────────────────────
-- pastor_m  Missio pastor. No FFSA role.
-- hcl_m     Missio house_church_leader. No FFSA role.
-- staff     FFSA staff. No org role.
-- admin     FFSA admin. No org role. Hard wall.
-- sup       FFSA super_admin. No org role. Hard wall.
-- plain     Signed in, no roles, one own contact.
-- pastor_f  Pastor of the ffsa org. No Missio role, no FFSA staff.
-- viewer    contacts.view only. The table-wide grant Missio must not get.

INSERT INTO public.roles (name) VALUES ('staff'), ('admin'), ('super_admin');
INSERT INTO public.permissions (key) VALUES ('contacts.view');

INSERT INTO public.users (id, email) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'pastor-m@test'),
  ('a2222222-2222-2222-2222-222222222222', 'hcl-m@test'),
  ('a3333333-3333-3333-3333-333333333333', 'staff@test'),
  ('a4444444-4444-4444-4444-444444444444', 'admin@test'),
  ('a5555555-5555-5555-5555-555555555555', 'super@test'),
  ('a6666666-6666-6666-6666-666666666666', 'plain@test'),
  ('a7777777-7777-7777-7777-777777777777', 'pastor-f@test'),
  ('a8888888-8888-8888-8888-888888888888', 'viewer@test');

INSERT INTO public.contacts (id, first_name, last_name) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'Missio', 'Person'),
  ('c2222222-2222-2222-2222-222222222222', 'Ffsa', 'Person'),
  ('c3333333-3333-3333-3333-333333333333', 'Out', 'Sider'),
  ('c4444444-4444-4444-4444-444444444444', 'Plain', 'Own'),
  ('c5555555-5555-5555-5555-555555555555', 'Sync', 'Target'),
  ('c6666666-6666-6666-6666-666666666666', 'Manual', 'Label'),
  ('c7777777-7777-7777-7777-777777777777', 'Move', 'Target');

UPDATE public.users
   SET contact_id = 'c4444444-4444-4444-4444-444444444444'
 WHERE id = 'a6666666-6666-6666-6666-666666666666';

INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM (VALUES
  ('a3333333-3333-3333-3333-333333333333', 'staff'),
  ('a4444444-4444-4444-4444-444444444444', 'admin'),
  ('a5555555-5555-5555-5555-555555555555', 'super_admin')
) AS v(uid, role)
JOIN public.users u ON u.id = v.uid::uuid
JOIN public.roles r ON r.name = v.role;

INSERT INTO public.user_permissions (user_id, permission_id)
SELECT 'a8888888-8888-8888-8888-888888888888', id
FROM public.permissions WHERE key = 'contacts.view';

INSERT INTO public.org_staff_roles (user_id, org_id, role)
SELECT v.uid::uuid, o.id, v.role
FROM (VALUES
  ('a1111111-1111-1111-1111-111111111111', 'missio', 'pastor'),
  ('a2222222-2222-2222-2222-222222222222', 'missio', 'house_church_leader'),
  ('a7777777-7777-7777-7777-777777777777', 'ffsa', 'pastor')
) AS v(uid, slug, role)
JOIN public.organisations o ON o.slug = v.slug;

INSERT INTO public.org_people (org_id, contact_id, campus)
SELECT o.id, v.cid::uuid, 'potch'
FROM (VALUES
  ('missio', 'c1111111-1111-1111-1111-111111111111'),
  ('ffsa', 'c2222222-2222-2222-2222-222222222222')
) AS v(slug, cid)
JOIN public.organisations o ON o.slug = v.slug;

CREATE TEMP TABLE checks (
  n serial PRIMARY KEY,
  label text NOT NULL,
  got text,
  want text,
  ok boolean NOT NULL
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

-- One statement as who. Success returns rows=N. Failure returns err + SQLSTATE.
-- The role switch is local to this call.
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

-- ── Seed shape ────────────────────────────────────────────
SELECT pg_temp.expect(
  'seed: two orgs, missio label linked by slug',
  (SELECT count(*)::text FROM public.organisations o
    JOIN public.labels l ON l.id = o.contact_label_id
    WHERE o.slug = 'missio' AND l.slug = 'missio'),
  '1'
);
SELECT pg_temp.expect(
  'seed: ffsa org has no contact label',
  (SELECT (contact_label_id IS NULL)::text FROM public.organisations WHERE slug = 'ffsa'),
  'true'
);
SELECT pg_temp.expect(
  'seed: no role rows beyond the three fixtures',
  (SELECT count(*)::text FROM public.org_staff_roles),
  '3'
);
SELECT pg_temp.expect(
  'seed: inserting the missio person mirrored the label',
  (SELECT added_via FROM public.contact_labels cl
    JOIN public.labels l ON l.id = cl.label_id
    WHERE cl.contact_id = 'c1111111-1111-1111-1111-111111111111' AND l.slug = 'missio'),
  'org_people_sync'
);
SELECT pg_temp.expect(
  'seed: ffsa person got no label (org has none)',
  (SELECT count(*)::text FROM public.contact_labels
    WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'),
  '0'
);

-- ── Missio pastor ─────────────────────────────────────────
SELECT pg_temp.expect('pastor has_org_role(missio)',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
    $$SELECT public.has_org_role('missio')::text$$),
  'true');
SELECT pg_temp.expect('pastor has_org_role(ffsa) is false',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
    $$SELECT public.has_org_role('ffsa')::text$$),
  'false');
SELECT pg_temp.expect('pastor is not a finance role',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
    $$SELECT public.has_org_role('missio', ARRAY['finance'])::text$$),
  'false');
SELECT pg_temp.expect('pastor sees only Missio org_people',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' ||
           count(*) FILTER (WHERE o.slug = 'missio')::text
    FROM public.org_people op
    JOIN public.organisations o ON o.id = op.org_id
  $$),
  '1/1');
SELECT pg_temp.expect('pastor sees 0 contacts rows, Missio people included',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*) FILTER (
             WHERE id = 'c1111111-1111-1111-1111-111111111111'
           )::text || '/' || count(*)::text
    FROM public.contacts
  $$),
  '0/0');

-- contact_labels is readable by any signed-in user. Put a non-Missio
-- contact_id there so the pastor can copy it, which is the breach.
INSERT INTO public.labels (slug, name) VALUES ('directory', 'Directory');
INSERT INTO public.contact_labels (contact_id, label_id, added_via)
SELECT 'c2222222-2222-2222-2222-222222222222', id, 'manual'
FROM public.labels WHERE slug = 'directory';

SELECT pg_temp.expect('pastor cannot insert a Missio contact taken from contact_labels',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.org_people (org_id, contact_id)
    SELECT o.id, cl.contact_id
    FROM public.contact_labels cl
    JOIN public.labels l ON l.id = cl.label_id
    JOIN public.organisations o ON o.slug = 'missio'
    WHERE l.slug = 'missio'
      AND cl.contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot insert a non-Missio contact taken from contact_labels',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.org_people (org_id, contact_id)
    SELECT o.id, cl.contact_id
    FROM public.contact_labels cl
    JOIN public.labels l ON l.id = cl.label_id
    JOIN public.organisations o ON o.slug = 'missio'
    WHERE l.slug = 'directory'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot update contact_id',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.org_people
       SET contact_id = 'c2222222-2222-2222-2222-222222222222'
     WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot update org_id',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.org_people
       SET org_id = (SELECT id FROM public.organisations WHERE slug = 'ffsa')
     WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot update created_by',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.org_people
       SET created_by = 'a1111111-1111-1111-1111-111111111111'
     WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot update id',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.org_people
       SET id = gen_random_uuid()
     WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'err 42501');
SELECT pg_temp.expect('failed attach left the Missio row on its own contact',
  (SELECT o.slug || '/' || op.contact_id::text
     FROM public.org_people op
     JOIN public.organisations o ON o.id = op.org_id
    WHERE op.contact_id = 'c1111111-1111-1111-1111-111111111111'),
  'missio/c1111111-1111-1111-1111-111111111111');
SELECT pg_temp.expect('after the failed attach the pastor still sees 0 contacts',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.contacts$$),
  '0');
SELECT pg_temp.expect('pastor cannot delete org_people (no grant)',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.org_people
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'err 42501');
-- Even with the grant, there is no DELETE policy.
GRANT DELETE ON public.org_people TO authenticated;
SELECT pg_temp.expect('pastor cannot delete org_people (no policy)',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.org_people
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'rows=0');
REVOKE DELETE ON public.org_people FROM authenticated;
SELECT pg_temp.expect('pastor delete left the Missio person in place',
  (SELECT count(*)::text FROM public.org_people
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'),
  '1');
SELECT pg_temp.expect('pastor cannot write org_staff_roles (no grant)',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.org_staff_roles (user_id, org_id, role)
    SELECT 'a3333333-3333-3333-3333-333333333333', id, 'team_leader'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
GRANT INSERT, UPDATE, DELETE ON public.org_staff_roles TO authenticated;
SELECT pg_temp.expect('pastor cannot insert org_staff_roles (no policy)',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.org_staff_roles (user_id, org_id, role)
    SELECT 'a3333333-3333-3333-3333-333333333333', id, 'team_leader'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot update org_staff_roles (no policy)',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.org_staff_roles SET campus = 'jhb'
    WHERE user_id = 'a1111111-1111-1111-1111-111111111111'
  $$),
  'rows=0');
SELECT pg_temp.expect('pastor cannot delete org_staff_roles (no policy)',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.org_staff_roles
    WHERE user_id = 'a2222222-2222-2222-2222-222222222222'
  $$),
  'rows=0');
REVOKE INSERT, UPDATE, DELETE ON public.org_staff_roles FROM authenticated;
SELECT pg_temp.expect('pastor cannot insert contacts',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.contacts (first_name, last_name) VALUES ('New', 'Contact')
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot update contacts',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.contacts SET first_name = 'Hacked'
    WHERE id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'rows=0');
SELECT pg_temp.expect('pastor sees both Missio staff rows',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text FROM public.org_staff_roles r
    JOIN public.organisations o ON o.id = r.org_id
    WHERE o.slug = 'missio'
  $$),
  '2');
SELECT pg_temp.expect('pastor does not see the other org''s staff row',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text FROM public.org_staff_roles r
    JOIN public.organisations o ON o.id = r.org_id
    WHERE o.slug = 'ffsa'
  $$),
  '0');

-- ── Missio house church leader ────────────────────────────
SELECT pg_temp.expect('house church leader can read Missio org_people',
  pg_temp.scalar('a2222222-2222-2222-2222-222222222222', $$
    SELECT count(*)::text FROM public.org_people op
    JOIN public.organisations o ON o.id = op.org_id
    WHERE o.slug = 'missio'
  $$),
  '1');
SELECT pg_temp.expect('house church leader sees 0 contacts rows, Missio people included',
  pg_temp.scalar('a2222222-2222-2222-2222-222222222222',
    $$SELECT count(*)::text FROM public.contacts$$),
  '0');
SELECT pg_temp.expect('house church leader sees 0 ffsa org_people',
  pg_temp.scalar('a2222222-2222-2222-2222-222222222222', $$
    SELECT count(*)::text FROM public.org_people op
    JOIN public.organisations o ON o.id = op.org_id
    WHERE o.slug = 'ffsa'
  $$),
  '0');
SELECT pg_temp.expect('house church leader cannot insert org_people',
  pg_temp.exec('a2222222-2222-2222-2222-222222222222', $$
    INSERT INTO public.org_people (org_id, contact_id)
    SELECT id, 'c7777777-7777-7777-7777-777777777777'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
SELECT pg_temp.expect('house church leader cannot update org_people',
  pg_temp.exec('a2222222-2222-2222-2222-222222222222', $$
    UPDATE public.org_people SET status = 'inactive'
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'rows=0');
SELECT pg_temp.expect('house church leader update did not stick',
  (SELECT status FROM public.org_people
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'),
  'active');
SELECT pg_temp.expect('pastor can update campus, status, joined_at and current_stage',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.org_people
       SET campus = 'jhb',
           status = 'inactive',
           joined_at = DATE '2026-01-15',
           current_stage = 'member'
     WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor field update stuck and kept the sync label',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT campus || '/' || status || '/' || joined_at::text || '/' || current_stage
           || '/' || (
             SELECT count(*)::text FROM public.contact_labels
             WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
           )
    FROM public.org_people
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'jhb/inactive/2026-01-15/member/1');
SELECT pg_temp.expect('pastor field update moved updated_at',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT (updated_at > created_at)::text
    FROM public.org_people
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'true');
SELECT pg_temp.expect('after the field update the pastor still sees 0 contacts',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.contacts$$),
  '0');
UPDATE public.contacts
   SET preferred_name = 'Mo'
 WHERE id = 'c1111111-1111-1111-1111-111111111111';
SELECT pg_temp.expect('pastor sees the Missio person in org_people_directory, with names',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' ||
           min(first_name) || '/' || min(last_name) || '/' ||
           coalesce(min(preferred_name), '')
    FROM public.org_people_directory
    WHERE org_id = (SELECT id FROM public.organisations WHERE slug = 'missio')
  $$),
  '1/Missio/Person/Mo');
SELECT pg_temp.expect('house church leader sees the Missio person in org_people_directory, with names',
  pg_temp.scalar('a2222222-2222-2222-2222-222222222222', $$
    SELECT count(*)::text || '/' ||
           min(first_name) || '/' || min(last_name) || '/' ||
           coalesce(min(preferred_name), '')
    FROM public.org_people_directory
    WHERE org_id = (SELECT id FROM public.organisations WHERE slug = 'missio')
  $$),
  '1/Missio/Person/Mo');
SELECT pg_temp.expect('house church leader sees only their own staff row',
  pg_temp.scalar('a2222222-2222-2222-2222-222222222222', $$
    SELECT count(*)::text || '/' ||
           count(*) FILTER (WHERE user_id = auth.uid())::text
    FROM public.org_staff_roles
  $$),
  '1/1');

-- ── FFSA staff (unchanged directory, no org wall) ─────────
SELECT pg_temp.expect('FFSA staff has_org_role(missio) is false',
  pg_temp.scalar('a3333333-3333-3333-3333-333333333333',
    $$SELECT public.has_org_role('missio')::text$$),
  'false');
SELECT pg_temp.expect('FFSA staff sees no org_people',
  pg_temp.scalar('a3333333-3333-3333-3333-333333333333',
    $$SELECT count(*)::text FROM public.org_people$$),
  '0');
SELECT pg_temp.expect('FFSA staff still sees every contact',
  pg_temp.scalar('a3333333-3333-3333-3333-333333333333',
    $$SELECT count(*)::text FROM public.contacts$$),
  '7');
SELECT pg_temp.expect('FFSA staff cannot insert org_people',
  pg_temp.exec('a3333333-3333-3333-3333-333333333333', $$
    INSERT INTO public.org_people (org_id, contact_id)
    SELECT id, 'c3333333-3333-3333-3333-333333333333'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');

-- ── HARD WALL: FFSA admin ─────────────────────────────────
-- is_admin() is true. That must not open org_people or org_staff_roles.
SELECT pg_temp.expect('HARD WALL admin is_admin() true',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT public.is_admin()::text$$),
  'true');
SELECT pg_temp.expect('HARD WALL admin has_org_role(missio) false',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT public.has_org_role('missio')::text$$),
  'false');
SELECT pg_temp.expect('HARD WALL admin has_org_role_id(missio) false',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444', $$
    SELECT public.has_org_role_id(id)::text
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'false');
SELECT pg_temp.expect('HARD WALL admin sees 0 org_people',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.org_people$$),
  '0');
SELECT pg_temp.expect('HARD WALL admin sees 0 org_staff_roles',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.org_staff_roles$$),
  '0');
SELECT pg_temp.expect('HARD WALL admin still sees every contact',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.contacts$$),
  '7');
SELECT pg_temp.expect('HARD WALL admin cannot insert org_people',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    INSERT INTO public.org_people (org_id, contact_id)
    SELECT id, 'c3333333-3333-3333-3333-333333333333'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
SELECT pg_temp.expect('HARD WALL admin cannot update org_people',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    UPDATE public.org_people SET status = 'inactive'
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'rows=0');
SELECT pg_temp.expect('HARD WALL admin cannot delete org_people (no grant)',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    DELETE FROM public.org_people
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'err 42501');
GRANT DELETE ON public.org_people TO authenticated;
SELECT pg_temp.expect('HARD WALL admin cannot delete org_people (no policy)',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    DELETE FROM public.org_people
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'rows=0');
REVOKE DELETE ON public.org_people FROM authenticated;
GRANT INSERT, UPDATE, DELETE ON public.org_staff_roles TO authenticated;
SELECT pg_temp.expect('HARD WALL admin cannot insert org_staff_roles',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    INSERT INTO public.org_staff_roles (user_id, org_id, role)
    SELECT 'a4444444-4444-4444-4444-444444444444', id, 'admin'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
SELECT pg_temp.expect('HARD WALL admin cannot update org_staff_roles',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    UPDATE public.org_staff_roles SET campus = 'potch'
    WHERE user_id = 'a1111111-1111-1111-1111-111111111111'
  $$),
  'rows=0');
SELECT pg_temp.expect('HARD WALL admin cannot delete org_staff_roles',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    DELETE FROM public.org_staff_roles
    WHERE user_id = 'a1111111-1111-1111-1111-111111111111'
  $$),
  'rows=0');
REVOKE INSERT, UPDATE, DELETE ON public.org_staff_roles FROM authenticated;
GRANT INSERT, UPDATE, DELETE ON public.organisations TO authenticated;
SELECT pg_temp.expect('HARD WALL admin cannot insert organisations',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    INSERT INTO public.organisations (slug, name) VALUES ('nope', 'Nope')
  $$),
  'err 42501');
SELECT pg_temp.expect('HARD WALL admin cannot update organisations',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    UPDATE public.organisations SET name = 'Renamed' WHERE slug = 'missio'
  $$),
  'rows=0');
SELECT pg_temp.expect('HARD WALL admin cannot delete organisations',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    DELETE FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=0');
REVOKE INSERT, UPDATE, DELETE ON public.organisations FROM authenticated;

-- ── HARD WALL: FFSA super_admin ───────────────────────────
SELECT pg_temp.expect('HARD WALL super_admin is_admin() true',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT public.is_admin()::text$$),
  'true');
SELECT pg_temp.expect('HARD WALL super_admin has_org_role(missio) false',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT public.has_org_role('missio')::text$$),
  'false');
SELECT pg_temp.expect('HARD WALL super_admin sees 0 org_people',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.org_people$$),
  '0');
SELECT pg_temp.expect('HARD WALL super_admin sees 0 org_staff_roles',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.org_staff_roles$$),
  '0');
SELECT pg_temp.expect('HARD WALL super_admin still sees every contact',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.contacts$$),
  '7');
SELECT pg_temp.expect('HARD WALL super_admin cannot insert org_people',
  pg_temp.exec('a5555555-5555-5555-5555-555555555555', $$
    INSERT INTO public.org_people (org_id, contact_id)
    SELECT id, 'c3333333-3333-3333-3333-333333333333'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
SELECT pg_temp.expect('HARD WALL super_admin cannot update org_people',
  pg_temp.exec('a5555555-5555-5555-5555-555555555555', $$
    UPDATE public.org_people SET status = 'inactive'
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'rows=0');
SELECT pg_temp.expect('HARD WALL super_admin cannot delete org_people',
  pg_temp.exec('a5555555-5555-5555-5555-555555555555', $$
    DELETE FROM public.org_people
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  'err 42501');
GRANT INSERT, UPDATE, DELETE ON public.org_staff_roles TO authenticated;
SELECT pg_temp.expect('HARD WALL super_admin cannot insert org_staff_roles',
  pg_temp.exec('a5555555-5555-5555-5555-555555555555', $$
    INSERT INTO public.org_staff_roles (user_id, org_id, role)
    SELECT 'a5555555-5555-5555-5555-555555555555', id, 'pastor'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
SELECT pg_temp.expect('HARD WALL super_admin cannot update org_staff_roles',
  pg_temp.exec('a5555555-5555-5555-5555-555555555555', $$
    UPDATE public.org_staff_roles SET campus = 'jhb'
  $$),
  'rows=0');
SELECT pg_temp.expect('HARD WALL super_admin cannot delete org_staff_roles',
  pg_temp.exec('a5555555-5555-5555-5555-555555555555', $$
    DELETE FROM public.org_staff_roles
  $$),
  'rows=0');
REVOKE INSERT, UPDATE, DELETE ON public.org_staff_roles FROM authenticated;

-- ── Plain authenticated user ──────────────────────────────
SELECT pg_temp.expect('plain user sees 0 org_people',
  pg_temp.scalar('a6666666-6666-6666-6666-666666666666',
    $$SELECT count(*)::text FROM public.org_people$$),
  '0');
SELECT pg_temp.expect('plain user sees only their own contact',
  pg_temp.scalar('a6666666-6666-6666-6666-666666666666', $$
    SELECT count(*)::text || '/' || min(id::text) FROM public.contacts
  $$),
  '1/c4444444-4444-4444-4444-444444444444');
SELECT pg_temp.expect('HARD WALL admin sees 0 org_people_directory rows',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.org_people_directory$$),
  '0');
SELECT pg_temp.expect('HARD WALL super_admin sees 0 org_people_directory rows',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.org_people_directory$$),
  '0');
SELECT pg_temp.expect('plain user sees 0 org_people_directory rows',
  pg_temp.scalar('a6666666-6666-6666-6666-666666666666',
    $$SELECT count(*)::text FROM public.org_people_directory$$),
  '0');
SELECT pg_temp.expect('plain user has_org_role(missio) false',
  pg_temp.scalar('a6666666-6666-6666-6666-666666666666',
    $$SELECT public.has_org_role('missio')::text$$),
  'false');

-- ── Pastor of the other org ───────────────────────────────
SELECT pg_temp.expect('ffsa pastor sees only ffsa org_people',
  pg_temp.scalar('a7777777-7777-7777-7777-777777777777', $$
    SELECT count(*)::text || '/' ||
           coalesce(string_agg(DISTINCT o.slug, ','), '')
    FROM public.org_people op
    JOIN public.organisations o ON o.id = op.org_id
  $$),
  '1/ffsa');
SELECT pg_temp.expect('ffsa pastor sees 0 contacts rows',
  pg_temp.scalar('a7777777-7777-7777-7777-777777777777',
    $$SELECT count(*)::text FROM public.contacts$$),
  '0');
SELECT pg_temp.expect('ffsa pastor sees 0 Missio rows in org_people_directory',
  pg_temp.scalar('a7777777-7777-7777-7777-777777777777', $$
    SELECT count(*)::text FROM public.org_people_directory
    WHERE org_id = (SELECT id FROM public.organisations WHERE slug = 'missio')
  $$),
  '0');
SELECT pg_temp.expect('ffsa pastor sees their own org in the directory, with names',
  pg_temp.scalar('a7777777-7777-7777-7777-777777777777', $$
    SELECT count(*)::text || '/' || min(first_name) || '/' || min(last_name)
    FROM public.org_people_directory
  $$),
  '1/Ffsa/Person');
SELECT pg_temp.expect('ffsa pastor has_org_role(missio) false',
  pg_temp.scalar('a7777777-7777-7777-7777-777777777777',
    $$SELECT public.has_org_role('missio')::text$$),
  'false');
SELECT pg_temp.expect('ffsa pastor cannot insert a Missio person',
  pg_temp.exec('a7777777-7777-7777-7777-777777777777', $$
    INSERT INTO public.org_people (org_id, contact_id)
    SELECT id, 'c3333333-3333-3333-3333-333333333333'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');

-- ── contacts.view is table-wide and still not an org role ─
SELECT pg_temp.expect('contacts.view holder sees every contact',
  pg_temp.scalar('a8888888-8888-8888-8888-888888888888',
    $$SELECT count(*)::text FROM public.contacts$$),
  '7');
SELECT pg_temp.expect('contacts.view holder sees 0 org_people',
  pg_temp.scalar('a8888888-8888-8888-8888-888888888888',
    $$SELECT count(*)::text FROM public.org_people$$),
  '0');
SELECT pg_temp.expect('contacts.view holder has_org_role(missio) false',
  pg_temp.scalar('a8888888-8888-8888-8888-888888888888',
    $$SELECT public.has_org_role('missio')::text$$),
  'false');

-- ── Organisations are readable, not writable, by signed-in users
SELECT pg_temp.expect('pastor can read both organisations',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.organisations$$),
  '2');
SELECT pg_temp.expect('pastor cannot insert an organisation',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.organisations (slug, name) VALUES ('extra', 'Extra')
  $$),
  'err 42501');

-- ── Service role is the grant path ────────────────────────
SELECT pg_temp.expect('service role can insert an org_staff_roles grant',
  pg_temp.exec('service', $$
    INSERT INTO public.org_staff_roles (user_id, org_id, role)
    SELECT 'a3333333-3333-3333-3333-333333333333', id, 'finance'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('service role can delete that grant again',
  pg_temp.exec('service', $$
    DELETE FROM public.org_staff_roles
    WHERE user_id = 'a3333333-3333-3333-3333-333333333333' AND role = 'finance'
  $$),
  'rows=1');
SELECT pg_temp.expect('service role can insert and remove an organisation',
  pg_temp.exec('service', $$
    INSERT INTO public.organisations (slug, name) VALUES ('probe', 'Probe')
  $$),
  'rows=1');
SELECT pg_temp.exec('service', $$DELETE FROM public.organisations WHERE slug = 'probe'$$);

-- ── Label sync (service role inserts; pastors cannot) ────
SELECT pg_temp.expect('service role can insert org_people',
  pg_temp.exec('service', $$
    INSERT INTO public.org_people (org_id, contact_id)
    SELECT id, 'c5555555-5555-5555-5555-555555555555'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('service role insert stamped org_people_sync',
  (SELECT added_via || '/' || coalesce(added_by::text, 'null')
     FROM public.contact_labels cl
     JOIN public.labels l ON l.id = cl.label_id
    WHERE cl.contact_id = 'c5555555-5555-5555-5555-555555555555'
      AND l.slug = 'missio'),
  'org_people_sync/null');
INSERT INTO public.contact_labels (contact_id, label_id, added_via)
SELECT 'c5555555-5555-5555-5555-555555555555', id, 'manual'
FROM public.labels WHERE slug = 'missio'
ON CONFLICT (contact_id, label_id) DO NOTHING;
SELECT pg_temp.expect('re-adding a synced label by hand keeps org_people_sync',
  (SELECT added_via FROM public.contact_labels cl
    JOIN public.labels l ON l.id = cl.label_id
    WHERE cl.contact_id = 'c5555555-5555-5555-5555-555555555555'
      AND l.slug = 'missio'),
  'org_people_sync');
SELECT pg_temp.expect('after the service insert the pastor still sees 0 contacts',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.contacts$$),
  '0');
SELECT pg_temp.expect('after the service insert the pastor sees the new name in the directory',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT first_name || '/' || last_name || '/' || coalesce(preferred_name, '')
    FROM public.org_people_directory
    WHERE contact_id = 'c5555555-5555-5555-5555-555555555555'
  $$),
  'Sync/Target/');
-- Move the synced contact. Old label goes, new label arrives.
SELECT pg_temp.expect('service role can move org_people onto another contact',
  pg_temp.exec('service', $$
    UPDATE public.org_people
       SET contact_id = 'c7777777-7777-7777-7777-777777777777'
     WHERE contact_id = 'c5555555-5555-5555-5555-555555555555'
  $$),
  'rows=1');
SELECT pg_temp.expect('move removed the sync label from the old contact',
  (SELECT count(*)::text FROM public.contact_labels
    WHERE contact_id = 'c5555555-5555-5555-5555-555555555555'),
  '0');
SELECT pg_temp.expect('move added org_people_sync on the new contact',
  (SELECT added_via FROM public.contact_labels cl
    JOIN public.labels l ON l.id = cl.label_id
    WHERE cl.contact_id = 'c7777777-7777-7777-7777-777777777777'
      AND l.slug = 'missio'),
  'org_people_sync');

-- Service-role delete removes the synced label and does not unsubscribe.
SELECT pg_temp.expect('service role delete of org_people',
  pg_temp.exec('service', $$
    DELETE FROM public.org_people
    WHERE contact_id = 'c7777777-7777-7777-7777-777777777777'
  $$),
  'rows=1');
SELECT pg_temp.expect('delete removed the org_people_sync label',
  (SELECT count(*)::text FROM public.contact_labels
    WHERE contact_id = 'c7777777-7777-7777-7777-777777777777'),
  '0');
SELECT pg_temp.expect('delete did not write an unsubscribe',
  (SELECT count(*)::text FROM public.unsubscribes
    WHERE contact_id = 'c7777777-7777-7777-7777-777777777777'),
  '0');

-- A manual missio label survives the org_people delete.
INSERT INTO public.contact_labels (contact_id, label_id, added_via, added_by)
SELECT 'c6666666-6666-6666-6666-666666666666', id, 'manual', NULL
FROM public.labels WHERE slug = 'missio';
SELECT pg_temp.exec('service', $$
  INSERT INTO public.org_people (org_id, contact_id)
  SELECT id, 'c6666666-6666-6666-6666-666666666666'
  FROM public.organisations WHERE slug = 'missio'
$$);
SELECT pg_temp.expect('sync insert does not overwrite a manual label',
  (SELECT added_via FROM public.contact_labels cl
    JOIN public.labels l ON l.id = cl.label_id
    WHERE cl.contact_id = 'c6666666-6666-6666-6666-666666666666'
      AND l.slug = 'missio'),
  'manual');
SELECT pg_temp.exec('service', $$
  DELETE FROM public.org_people
  WHERE contact_id = 'c6666666-6666-6666-6666-666666666666'
$$);
SELECT pg_temp.expect('manual missio label survives the org_people delete',
  (SELECT added_via FROM public.contact_labels cl
    JOIN public.labels l ON l.id = cl.label_id
    WHERE cl.contact_id = 'c6666666-6666-6666-6666-666666666666'
      AND l.slug = 'missio'),
  'manual');

-- Depth-1 delete still records an unsubscribe, so the stub is live
-- and the sync path is the one that skips it.
INSERT INTO public.contact_labels (contact_id, label_id, added_via)
SELECT 'c3333333-3333-3333-3333-333333333333', id, 'manual'
FROM public.labels WHERE slug = 'missio';
DELETE FROM public.contact_labels
 WHERE contact_id = 'c3333333-3333-3333-3333-333333333333';
SELECT pg_temp.expect('direct label delete still records an unsubscribe',
  (SELECT count(*)::text FROM public.unsubscribes
    WHERE contact_id = 'c3333333-3333-3333-3333-333333333333'),
  '1');

-- Pastor cannot write contact_labels themselves.
SELECT pg_temp.expect('pastor cannot insert contact_labels directly',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.contact_labels (contact_id, label_id, added_via)
    SELECT 'c3333333-3333-3333-3333-333333333333', id, 'manual'
    FROM public.labels WHERE slug = 'missio'
  $$),
  'err 42501');

-- ── Anon ──────────────────────────────────────────────────
SELECT pg_temp.expect('anon cannot read org_people_directory',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.org_people_directory$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot read org_people',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.org_people$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot read org_staff_roles',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.org_staff_roles$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot read organisations',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.organisations$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot read contacts',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.contacts$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot call has_org_role',
  pg_temp.scalar('anon', $$SELECT public.has_org_role('missio')::text$$),
  'err 42501');

-- ── Policy and grant shape ────────────────────────────────
SELECT pg_temp.expect('no is_admin() in org table policies',
  (SELECT count(*)::text
   FROM pg_policy pol
   JOIN pg_class c ON c.oid = pol.polrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('organisations', 'org_staff_roles', 'org_people')
     AND (
       coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ILIKE '%is_admin%'
       OR coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ILIKE '%is_admin%'
     )),
  '0');
SELECT pg_temp.expect('org_people has no DELETE policy',
  (SELECT count(*)::text
   FROM pg_policy pol
   JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'org_people' AND pol.polcmd = 'd'),
  '0');
SELECT pg_temp.expect('org_people has no INSERT policy',
  (SELECT count(*)::text
   FROM pg_policy pol
   JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'org_people' AND pol.polcmd = 'a'),
  '0');
SELECT pg_temp.expect('org_staff_roles has no write policy',
  (SELECT count(*)::text
   FROM pg_policy pol
   JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'org_staff_roles' AND pol.polcmd IN ('a', 'w', 'd', '*')),
  '0');
SELECT pg_temp.expect('organisations has no write policy',
  (SELECT count(*)::text
   FROM pg_policy pol
   JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'organisations' AND pol.polcmd IN ('a', 'w', 'd', '*')),
  '0');
SELECT pg_temp.expect('contacts gained no org policy',
  (SELECT string_agg(pol.polname, ' | ' ORDER BY pol.polname)
   FROM pg_policy pol
   JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'contacts' AND pol.polcmd = 'r'),
  'Admins and staff can read all contacts | Users can read own contact record');
SELECT pg_temp.expect('directory columns are exactly the org fields and three names',
  (SELECT string_agg(attname, ',' ORDER BY attnum)
   FROM pg_attribute
   WHERE attrelid = 'public.org_people_directory'::regclass
     AND attnum > 0 AND NOT attisdropped),
  'id,org_id,contact_id,campus,status,joined_at,current_stage,created_at,updated_at,first_name,last_name,preferred_name');
SELECT pg_temp.expect('directory is owner-rights and a security barrier',
  (SELECT (
      'security_invoker=false' = ANY (reloptions)
      AND 'security_barrier=true' = ANY (reloptions)
    )::text
   FROM pg_class
   WHERE oid = 'public.org_people_directory'::regclass),
  'true');
SELECT pg_temp.expect('directory is owned by postgres',
  (SELECT pg_get_userbyid(relowner)
   FROM pg_class
   WHERE oid = 'public.org_people_directory'::regclass),
  'postgres');
SELECT pg_temp.expect('anon has no privileges on the three tables',
  (SELECT (
      has_table_privilege('anon', 'public.organisations', 'SELECT')
      OR has_table_privilege('anon', 'public.org_staff_roles', 'SELECT')
      OR has_table_privilege('anon', 'public.org_people', 'SELECT')
    )::text),
  'false');
SELECT pg_temp.expect('authenticated cannot insert or delete org_people, or write grants',
  (SELECT (
      has_table_privilege('authenticated', 'public.org_people', 'INSERT')
      OR has_table_privilege('authenticated', 'public.org_people', 'DELETE')
      OR has_table_privilege('authenticated', 'public.org_people', 'UPDATE')
      OR has_table_privilege('authenticated', 'public.org_staff_roles', 'INSERT')
      OR has_table_privilege('authenticated', 'public.organisations', 'INSERT')
    )::text),
  'false');
SELECT pg_temp.expect('authenticated updates only the person fields',
  (SELECT (
      has_column_privilege('authenticated', 'public.org_people', 'campus', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.org_people', 'status', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.org_people', 'joined_at', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.org_people', 'current_stage', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.org_people', 'org_id', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.org_people', 'contact_id', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.org_people', 'id', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.org_people', 'created_by', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.org_people', 'updated_at', 'UPDATE')
    )::text),
  'true');
-- These two views are security_invoker in production (migration 166)
-- and are not created by this disposable database. When they are
-- absent the check records that. When a later run has them, a Missio
-- role must see 0 rows.
SELECT pg_temp.expect(
  'v_contact_summary: absent here, or 0 rows for a Missio pastor',
  CASE
    WHEN to_regclass('public.v_contact_summary') IS NULL
      THEN 'absent'
    ELSE pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
      $$SELECT count(*)::text FROM public.v_contact_summary$$)
  END,
  CASE
    WHEN to_regclass('public.v_contact_summary') IS NULL THEN 'absent'
    ELSE '0'
  END
);
SELECT pg_temp.expect(
  'v_campaign_audience: absent here, or 0 rows for a Missio pastor',
  CASE
    WHEN to_regclass('public.v_campaign_audience') IS NULL
      THEN 'absent'
    ELSE pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
      $$SELECT count(*)::text FROM public.v_campaign_audience$$)
  END,
  CASE
    WHEN to_regclass('public.v_campaign_audience') IS NULL THEN 'absent'
    ELSE '0'
  END
);
DO $$
BEGIN
  IF to_regclass('public.v_contact_summary') IS NULL THEN
    RAISE NOTICE 'note: public.v_contact_summary is not in this disposable database';
  END IF;
  IF to_regclass('public.v_campaign_audience') IS NULL THEN
    RAISE NOTICE 'note: public.v_campaign_audience is not in this disposable database';
  END IF;
END $$;

SELECT pg_temp.expect('second apply did not duplicate the missio org',
  (SELECT count(*)::text FROM public.organisations WHERE slug = 'missio'),
  '1');

-- ── Report ────────────────────────────────────────────────
DO $$
DECLARE
  n_pass int;
  n_fail int;
  rec record;
BEGIN
  SELECT count(*) FILTER (WHERE ok), count(*) FILTER (WHERE NOT ok)
    INTO n_pass, n_fail
  FROM checks;
  RAISE NOTICE 'missio_org_phase0_rls: % passed, % failed', n_pass, n_fail;
  IF n_fail > 0 THEN
    FOR rec IN SELECT n, label, got, want FROM checks WHERE NOT ok ORDER BY n LOOP
      RAISE NOTICE '  # % % (got % want %)', rec.n, rec.label, rec.got, rec.want;
    END LOOP;
    RAISE EXCEPTION 'missio_org_phase0_rls: % checks failed', n_fail;
  END IF;
END $$;
