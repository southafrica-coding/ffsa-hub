-- Disposable role-matrix check for migration 332. Not a migration.
-- Stubs the tables 329 needs, applies 329, 331 and 332 (332 twice),
-- then reads and writes as a Missio pastor, a Missio org admin who
-- is not a pastor, an FFSA admin, an FFSA super_admin, and anon.
--
--   dropdb --if-exists missio_connect_funnel && createdb missio_connect_funnel
--   psql -v ON_ERROR_STOP=1 -d missio_connect_funnel -f supabase/tests/missio_connect_funnel_rls.sql
--
-- Never point this at a shared or hosted database. service_role is
-- given BYPASSRLS here because that is how Supabase's service role
-- passes the hard wall.

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
  phone text,
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_any_role(ARRAY[required_role]);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_any_role(ARRAY['super_admin', 'admin']);
$$;

CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.permissions p ON p.id = up.permission_id
    WHERE up.user_id = auth.uid()
      AND p.key = required_permission
  );
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

INSERT INTO public.labels (slug, name) VALUES ('missio', 'Missio');

\ir ../migrations/329_missio_org_phase0.sql
\ir ../migrations/331_missio_house_churches.sql
\ir ../migrations/332_missio_connect_funnel.sql
\ir ../migrations/332_missio_connect_funnel.sql

UPDATE public.house_churches hc
   SET id = ('00000000-0000-4000-8000-' || lpad(hc.number::text, 12, '0'))::uuid
  FROM public.organisations o
 WHERE o.id = hc.org_id
   AND o.slug = 'missio';

-- Pastors have no contacts grant that returns rows. The not-in-house
-- view still has to show names, which is the owner-rights path.
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.contacts TO authenticated;
REVOKE ALL ON public.contacts FROM anon;
CREATE POLICY "Admins and staff can read all contacts"
  ON public.contacts FOR SELECT
  USING (
    public.has_any_role(ARRAY['super_admin', 'admin', 'staff'])
    OR public.has_permission('contacts.view')
  );

-- ── Fixtures ──────────────────────────────────────────────
-- pastor     Missio pastor. No FFSA role.
-- org_admin  Missio org role admin. Not a pastor.
-- admin      FFSA admin. No org role.
-- sup        FFSA super_admin. No org role.

INSERT INTO public.roles (name) VALUES ('admin'), ('super_admin');

INSERT INTO public.users (id, email) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'pastor@test'),
  ('a9999999-9999-9999-9999-999999999999', 'org-admin@test'),
  ('a4444444-4444-4444-4444-444444444444', 'admin@test'),
  ('a5555555-5555-5555-5555-555555555555', 'super@test');

INSERT INTO public.contacts (id, first_name, last_name, phone, email) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'Label', 'Person', '5550101', 'label@example.test'),
  ('c2222222-2222-2222-2222-222222222222', 'Other', 'Person', '5550102', 'other@example.test'),
  ('c3333333-3333-3333-3333-333333333333', 'Leader', 'Contact', '5550103', 'leader@example.test');

INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM (VALUES
  ('a4444444-4444-4444-4444-444444444444', 'admin'),
  ('a5555555-5555-5555-5555-555555555555', 'super_admin')
) AS v(uid, role)
JOIN public.users u ON u.id = v.uid::uuid
JOIN public.roles r ON r.name = v.role;

INSERT INTO public.org_staff_roles (user_id, org_id, role)
SELECT v.uid::uuid, o.id, v.role
FROM (VALUES
  ('a1111111-1111-1111-1111-111111111111', 'missio', 'pastor'),
  ('a9999999-9999-9999-9999-999999999999', 'missio', 'admin')
) AS v(uid, slug, role)
JOIN public.organisations o ON o.slug = v.slug;

INSERT INTO public.contact_labels (contact_id, label_id, added_via)
SELECT 'c1111111-1111-1111-1111-111111111111', id, 'manual'
FROM public.labels WHERE slug = 'missio';

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

-- ── Pastor read and write ─────────────────────────────────
SELECT pg_temp.expect('pastor can insert a manual connect card',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.connect_responses (
      id, org_id, name, phone, email, visit_type, wants_house_church,
      source, matched_contact_id
    )
    SELECT
      'd1111111-1111-4111-8111-111111111111',
      id,
      'Card Name',
      '5550100',
      'card@example.test',
      'first_time',
      true,
      'manual',
      'c1111111-1111-1111-1111-111111111111'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor can read and update that card',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.connect_responses
       SET notes = 'Sat on the left',
           matched_by = 'a1111111-1111-1111-1111-111111111111',
           matched_at = now()
     WHERE id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor update of the card stuck',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT notes || '/' || matched_contact_id::text || '/' || source
    FROM public.connect_responses
    WHERE id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'Sat on the left/c1111111-1111-1111-1111-111111111111/manual');
SELECT pg_temp.expect('pastor can insert an unmatched card',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.connect_responses (
      id, org_id, name, phone, visit_type, source
    )
    SELECT
      'd2222222-2222-4222-8222-222222222222',
      id, 'Walk In', '5550199', 'been_a_while', 'manual'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor cannot insert source qr',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.connect_responses (
      org_id, name, phone, visit_type, source, rate_key_hash
    )
    SELECT id, 'Qr Person', '5550188', 'first_time', 'qr', 'hmac-should-not-land'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
SELECT pg_temp.expect('service role can insert source qr with a rate hash',
  pg_temp.exec('service', $$
    INSERT INTO public.connect_responses (
      id, org_id, name, phone, visit_type, source, rate_key_hash
    )
    SELECT
      'd3333333-3333-4333-8333-333333333333',
      id, 'Qr Fixture', '5550188', 'first_time', 'qr', 'hmac-fixture'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor can read the service-role qr row',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT source || '/' || rate_key_hash
    FROM public.connect_responses
    WHERE id = 'd3333333-3333-4333-8333-333333333333'
  $$),
  'qr/hmac-fixture');
SELECT pg_temp.exec('service', $$
  DELETE FROM public.connect_responses
  WHERE id = 'd3333333-3333-4333-8333-333333333333'
$$);

SELECT pg_temp.expect('pastor can insert a follow-up',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_followups (
      id, org_id, contact_id, connect_response_id, assigned_leader_contact_id
    )
    SELECT
      'e1111111-1111-4111-8111-111111111111',
      id,
      'c1111111-1111-1111-1111-111111111111',
      'd1111111-1111-4111-8111-111111111111',
      'c3333333-3333-3333-3333-333333333333'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('insert wrote one stage_change from nothing to new',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' ||
           min(kind) || '/' ||
           coalesce(min(from_stage), '') || '/' ||
           min(to_stage) || '/' ||
           min(changed_by::text)
    FROM public.missio_followup_stage_history
    WHERE followup_id = 'e1111111-1111-4111-8111-111111111111'
  $$),
  '1/stage_change//new/a1111111-1111-1111-1111-111111111111');
SELECT pg_temp.expect('setting the stage to itself writes no history',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_followups
       SET stage = stage
     WHERE id = 'e1111111-1111-4111-8111-111111111111'
  $$),
  'rows=1');
SELECT pg_temp.expect('history count is still 1 after the no-op stage update',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text
    FROM public.missio_followup_stage_history
    WHERE followup_id = 'e1111111-1111-4111-8111-111111111111'
  $$),
  '1');
SELECT pg_temp.expect('updating the assignees writes no history',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_followups
       SET assigned_leader_contact_id = 'c3333333-3333-3333-3333-333333333333',
           assigned_user_id = 'a1111111-1111-1111-1111-111111111111'
     WHERE id = 'e1111111-1111-4111-8111-111111111111'
  $$),
  'rows=1');
SELECT pg_temp.expect('assignees stuck and history is still 1',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT (
      SELECT assigned_leader_contact_id::text || '/' || assigned_user_id::text
      FROM public.missio_followups
      WHERE id = 'e1111111-1111-4111-8111-111111111111'
    ) || '/' || (
      SELECT count(*)::text
      FROM public.missio_followup_stage_history
      WHERE followup_id = 'e1111111-1111-4111-8111-111111111111'
    )
  $$),
  'c3333333-3333-3333-3333-333333333333/a1111111-1111-1111-1111-111111111111/1');
SELECT pg_temp.expect('pastor can move the stage to contacted',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_followups
       SET stage = 'contacted'
     WHERE id = 'e1111111-1111-4111-8111-111111111111'
  $$),
  'rows=1');
SELECT pg_temp.expect('stage change wrote from new to contacted',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' ||
           count(*) FILTER (
             WHERE kind = 'stage_change' AND from_stage = 'new' AND to_stage = 'contacted'
           )::text
    FROM public.missio_followup_stage_history
    WHERE followup_id = 'e1111111-1111-4111-8111-111111111111'
  $$),
  '2/1');
SELECT pg_temp.expect('pastor can insert a note',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_followup_stage_history (followup_id, kind, notes)
    VALUES (
      'e1111111-1111-4111-8111-111111111111',
      'note',
      'Called the card'
    )
  $$),
  'rows=1');
SELECT pg_temp.expect('the note is a note, with no to_stage, attributed to the pastor',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT kind || '/' || coalesce(to_stage, '') || '/' || notes || '/' || changed_by::text
    FROM public.missio_followup_stage_history
    WHERE followup_id = 'e1111111-1111-4111-8111-111111111111'
      AND kind = 'note'
  $$),
  'note//Called the card/a1111111-1111-1111-1111-111111111111');
SELECT pg_temp.expect('pastor cannot insert a stage_change row',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_followup_stage_history (followup_id, kind, to_stage)
    VALUES (
      'e1111111-1111-4111-8111-111111111111',
      'stage_change',
      'joined'
    )
  $$),
  'err 42501');
SELECT pg_temp.expect('a note without notes is rejected',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_followup_stage_history (followup_id, kind, notes)
    VALUES ('e1111111-1111-4111-8111-111111111111', 'note', NULL)
  $$),
  'err 23514');
SELECT pg_temp.expect('pastor cannot update history',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_followup_stage_history
       SET notes = 'rewritten'
     WHERE followup_id = 'e1111111-1111-4111-8111-111111111111'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot delete history',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.missio_followup_stage_history
    WHERE followup_id = 'e1111111-1111-4111-8111-111111111111'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot delete a follow-up',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.missio_followups
    WHERE id = 'e1111111-1111-4111-8111-111111111111'
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot delete a connect card',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.connect_responses
    WHERE id = 'd2222222-2222-4222-8222-222222222222'
  $$),
  'err 42501');

-- ── Not in a house, before anyone joins ───────────────────
SELECT pg_temp.expect('pastor sees the labelled person once, with the card folded in',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' ||
           min(source) || '/' ||
           min(connect_response_id::text) || '/' ||
           min(display_name) || '/' ||
           min(phone) || '/' ||
           min(email) || '/' ||
           min(wants_house_church::text) || '/' ||
           min(followup_stage)
    FROM public.missio_not_in_house
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  '1/contact/d1111111-1111-4111-8111-111111111111/Label Person/5550101/label@example.test/true/contacted');
SELECT pg_temp.expect('the matched card is not also a connect_response row',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text
    FROM public.missio_not_in_house
    WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
      AND source = 'connect_response'
  $$),
  '0');
SELECT pg_temp.expect('an unmatched card is its own row',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' || min(display_name) || '/' || min(phone) || '/' ||
           bool_and(contact_id IS NULL)::text || '/' || min(source)
    FROM public.missio_not_in_house
    WHERE connect_response_id = 'd2222222-2222-4222-8222-222222222222'
  $$),
  '1/Walk In/5550199/true/connect_response');
SELECT pg_temp.expect('pastor not-in-house total is the person plus the unmatched card',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.missio_not_in_house$$),
  '2');
SELECT pg_temp.expect('pastor still cannot read the contacts table',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.contacts$$),
  '0');

-- ── Hard wall, while rows exist ───────────────────────────
SELECT pg_temp.expect('HARD WALL admin is_admin() true and sees 0 connect cards',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444', $$
    SELECT public.is_admin()::text || '/' ||
           (SELECT count(*) FROM public.connect_responses)::text
  $$),
  'true/0');
SELECT pg_temp.expect('HARD WALL admin sees 0 follow-ups',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.missio_followups$$),
  '0');
SELECT pg_temp.expect('HARD WALL admin sees 0 history',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.missio_followup_stage_history$$),
  '0');
SELECT pg_temp.expect('HARD WALL admin sees 0 effective follow-ups',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.missio_followup_effective$$),
  '0');
SELECT pg_temp.expect('HARD WALL admin sees 0 not-in-house rows',
  pg_temp.scalar('a4444444-4444-4444-4444-444444444444',
    $$SELECT count(*)::text FROM public.missio_not_in_house$$),
  '0');
SELECT pg_temp.expect('HARD WALL admin cannot insert a manual card',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    INSERT INTO public.connect_responses (org_id, name, phone, visit_type, source)
    SELECT id, 'Nope', '5550109', 'regular', 'manual'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
SELECT pg_temp.expect('HARD WALL admin cannot insert a follow-up',
  pg_temp.exec('a4444444-4444-4444-4444-444444444444', $$
    INSERT INTO public.missio_followups (org_id, contact_id)
    SELECT id, 'c2222222-2222-2222-2222-222222222222'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 42501');
SELECT pg_temp.expect('HARD WALL super_admin sees 0 connect cards',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.connect_responses$$),
  '0');
SELECT pg_temp.expect('HARD WALL super_admin sees 0 follow-ups',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.missio_followups$$),
  '0');
SELECT pg_temp.expect('HARD WALL super_admin sees 0 history',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.missio_followup_stage_history$$),
  '0');
SELECT pg_temp.expect('HARD WALL super_admin sees 0 effective follow-ups',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.missio_followup_effective$$),
  '0');
SELECT pg_temp.expect('HARD WALL super_admin sees 0 not-in-house rows',
  pg_temp.scalar('a5555555-5555-5555-5555-555555555555',
    $$SELECT count(*)::text FROM public.missio_not_in_house$$),
  '0');
SELECT pg_temp.expect('HARD WALL super_admin cannot update a follow-up',
  pg_temp.exec('a5555555-5555-5555-5555-555555555555', $$
    UPDATE public.missio_followups SET stage = 'joined'
  $$),
  'rows=0');
SELECT pg_temp.expect('Missio org admin is not a pastor and sees 0 connect cards',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999', $$
    SELECT public.has_org_role('missio', ARRAY['admin'])::text || '/' ||
           public.has_org_role('missio', ARRAY['pastor'])::text || '/' ||
           (SELECT count(*) FROM public.connect_responses)::text
  $$),
  'true/false/0');
SELECT pg_temp.expect('Missio org admin sees 0 follow-ups',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999',
    $$SELECT count(*)::text FROM public.missio_followups$$),
  '0');
SELECT pg_temp.expect('Missio org admin sees 0 history',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999',
    $$SELECT count(*)::text FROM public.missio_followup_stage_history$$),
  '0');
SELECT pg_temp.expect('Missio org admin sees 0 effective follow-ups',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999',
    $$SELECT count(*)::text FROM public.missio_followup_effective$$),
  '0');
SELECT pg_temp.expect('Missio org admin sees 0 not-in-house rows',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999',
    $$SELECT count(*)::text FROM public.missio_not_in_house$$),
  '0');
SELECT pg_temp.expect('Missio org admin cannot insert a follow-up',
  pg_temp.exec('a9999999-9999-9999-9999-999999999999', $$
    INSERT INTO public.missio_followups (org_id, connect_response_id)
    SELECT o.id, 'd2222222-2222-4222-8222-222222222222'
    FROM public.organisations o WHERE o.slug = 'missio'
  $$),
  'err 42501');

-- ── Anon ──────────────────────────────────────────────────
SELECT pg_temp.expect('anon cannot read connect cards',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.connect_responses$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot read follow-ups',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_followups$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot read history',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_followup_stage_history$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot read effective follow-ups',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_followup_effective$$),
  'err 42501');
SELECT pg_temp.expect('anon cannot read not-in-house',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_not_in_house$$),
  'err 42501');

-- ── Joined trigger and the view afterwards ────────────────
SELECT pg_temp.expect('an already-ended membership does not mark the follow-up joined',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (
      house_church_id, contact_id, role, ended_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c1111111-1111-1111-1111-111111111111',
      'member',
      current_date
    )
  $$),
  'rows=1');
SELECT pg_temp.expect('stage is still contacted and the person is still not in a house',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT (
      SELECT stage FROM public.missio_followups
      WHERE id = 'e1111111-1111-4111-8111-111111111111'
    ) || '/' || (
      SELECT count(*)::text FROM public.missio_not_in_house
      WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
    )
  $$),
  'contacted/1');
SELECT pg_temp.expect('an active membership marks the existing follow-up joined',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'c1111111-1111-1111-1111-111111111111',
      'member'
    )
  $$),
  'rows=1');
SELECT pg_temp.expect('stored stage is joined and history recorded the change',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT (
      SELECT stage FROM public.missio_followups
      WHERE id = 'e1111111-1111-4111-8111-111111111111'
    ) || '/' || (
      SELECT count(*) FILTER (
        WHERE kind = 'stage_change' AND from_stage = 'contacted' AND to_stage = 'joined'
      )::text
      FROM public.missio_followup_stage_history
      WHERE followup_id = 'e1111111-1111-4111-8111-111111111111'
    )
  $$),
  'joined/1');
SELECT pg_temp.expect('joining a house drops the person from not-in-house',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT (
      SELECT count(*) FROM public.missio_not_in_house
      WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
         OR connect_response_id = 'd1111111-1111-4111-8111-111111111111'
    )::text || '/' || (
      SELECT count(*) FROM public.missio_not_in_house
    )::text
  $$),
  '0/1');
SELECT pg_temp.expect('effective_stage agrees with the stored joined stage',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT stage || '/' || effective_stage
    FROM public.missio_followup_effective
    WHERE id = 'e1111111-1111-4111-8111-111111111111'
  $$),
  'joined/joined');

ALTER TABLE public.house_church_members DISABLE TRIGGER trg_house_church_member_mark_joined;
UPDATE public.missio_followups
   SET stage = 'visited_house'
 WHERE id = 'e1111111-1111-4111-8111-111111111111';
ALTER TABLE public.house_church_members ENABLE TRIGGER trg_house_church_member_mark_joined;

SELECT pg_temp.expect('effective_stage stays joined while the membership is active',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT stage || '/' || effective_stage
    FROM public.missio_followup_effective
    WHERE id = 'e1111111-1111-4111-8111-111111111111'
  $$),
  'visited_house/joined');

SELECT pg_temp.expect('an active membership does not create a follow-up',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.house_church_members (house_church_id, contact_id, role)
    VALUES (
      '00000000-0000-4000-8000-000000000002',
      'c2222222-2222-2222-2222-222222222222',
      'member'
    )
  $$),
  'rows=1');
SELECT pg_temp.expect('Other Person has a membership and no follow-up',
  (SELECT (
      SELECT count(*) FROM public.house_church_members
      WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'
        AND ended_at IS NULL
    )::text || '/' || (
      SELECT count(*) FROM public.missio_followups
      WHERE contact_id = 'c2222222-2222-2222-2222-222222222222'
    )::text),
  '1/0');

-- ── Subject check and partial uniques ─────────────────────
SELECT pg_temp.expect('a follow-up needs a contact or a card',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_followups (org_id)
    SELECT id FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 23514');
SELECT pg_temp.expect('the same contact cannot have two open follow-ups',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_followups (org_id, contact_id)
    SELECT id, 'c1111111-1111-1111-1111-111111111111'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 23505');
SELECT pg_temp.expect('a card alone is a valid follow-up subject',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_followups (id, org_id, connect_response_id)
    SELECT
      'e2222222-2222-4222-8222-222222222222',
      id,
      'd2222222-2222-4222-8222-222222222222'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('the same card cannot have two follow-ups',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_followups (org_id, connect_response_id)
    SELECT id, 'd2222222-2222-4222-8222-222222222222'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'err 23505');

-- ── Shape ─────────────────────────────────────────────────
SELECT pg_temp.expect('rate_key_hash and visit_type both exist',
  (SELECT string_agg(attname, ',' ORDER BY attname)
     FROM pg_attribute
    WHERE attrelid = 'public.connect_responses'::regclass
      AND attname IN ('rate_key_hash', 'visit_type')
      AND NOT attisdropped),
  'rate_key_hash,visit_type');
SELECT pg_temp.expect('rate limit index is on rate_key_hash, created_at',
  (SELECT (indexdef LIKE '%rate_key_hash%' AND indexdef LIKE '%created_at%')::text
     FROM pg_indexes
    WHERE indexname = 'connect_responses_rate_key_created_idx'),
  'true');
SELECT pg_temp.expect('not-in-house is owner-rights and a security barrier',
  (SELECT (
      'security_invoker=false' = ANY (reloptions)
      AND 'security_barrier=true' = ANY (reloptions)
    )::text
     FROM pg_class
    WHERE oid = 'public.missio_not_in_house'::regclass),
  'true');
SELECT pg_temp.expect('not-in-house is owned by postgres',
  (SELECT pg_get_userbyid(relowner)
     FROM pg_class
    WHERE oid = 'public.missio_not_in_house'::regclass),
  'postgres');
SELECT pg_temp.expect('effective follow-up view is security_invoker',
  (SELECT ('security_invoker=true' = ANY (reloptions))::text
     FROM pg_class
    WHERE oid = 'public.missio_followup_effective'::regclass),
  'true');
SELECT pg_temp.expect('no is_admin, has_role, or contacts permission in these policies',
  (SELECT count(*)::text
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'connect_responses', 'missio_followups', 'missio_followup_stage_history'
      )
      AND (
        coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
          || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
        ~ '(is_admin|has_any_role|has_permission|contacts\.(view|read|write|edit|create|delete))\s*\('
        OR coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
           || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
           ~ '[^a-z_]has_role\s*\('
      )),
  '0');
SELECT pg_temp.expect('not-in-house definition does not call is_admin or has_role',
  (SELECT (
      pg_get_viewdef('public.missio_not_in_house'::regclass) LIKE '%has_org_role%'
      AND pg_get_viewdef('public.missio_not_in_house'::regclass) !~ 'is_admin\s*\('
      AND pg_get_viewdef('public.missio_not_in_house'::regclass) !~ '[^a-z_]has_role\s*\('
    )::text),
  'true');
SELECT pg_temp.expect('connect cards have no delete policy',
  (SELECT count(*)::text
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
    WHERE c.relname = 'connect_responses' AND pol.polcmd = 'd'),
  '0');
SELECT pg_temp.expect('follow-ups have no delete policy',
  (SELECT count(*)::text
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
    WHERE c.relname = 'missio_followups' AND pol.polcmd = 'd'),
  '0');
SELECT pg_temp.expect('history has no update or delete policy',
  (SELECT count(*)::text
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
    WHERE c.relname = 'missio_followup_stage_history'
      AND pol.polcmd IN ('w', 'd')),
  '0');
SELECT pg_temp.expect('anon has no privileges on the tables or the views',
  (SELECT (
      has_table_privilege('anon', 'public.connect_responses', 'SELECT')
      OR has_table_privilege('anon', 'public.missio_followups', 'SELECT')
      OR has_table_privilege('anon', 'public.missio_followup_stage_history', 'SELECT')
      OR has_table_privilege('anon', 'public.missio_followup_effective', 'SELECT')
      OR has_table_privilege('anon', 'public.missio_not_in_house', 'SELECT')
    )::text),
  'false');
SELECT pg_temp.expect('second apply did not duplicate policies',
  (SELECT count(*)::text
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
    WHERE c.relname IN (
      'connect_responses', 'missio_followups', 'missio_followup_stage_history'
    )),
  '8');

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
  RAISE NOTICE 'missio_connect_funnel_rls: % passed, % failed', n_pass, n_fail;
  IF n_fail > 0 THEN
    FOR rec IN SELECT n, label, got, want FROM checks WHERE NOT ok ORDER BY n LOOP
      RAISE NOTICE '  # % % (got % want %)', rec.n, rec.label, rec.got, rec.want;
    END LOOP;
    RAISE EXCEPTION 'missio_connect_funnel_rls: % checks failed', n_fail;
  END IF;
END $$;
