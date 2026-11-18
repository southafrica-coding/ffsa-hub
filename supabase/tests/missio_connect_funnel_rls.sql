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

-- The service-role API inserts org_people before a card or a house
-- membership may point at that contact.
INSERT INTO public.org_people (org_id, contact_id, campus, status)
SELECT o.id, v.cid::uuid, 'potch', 'active'
FROM (VALUES
  ('c1111111-1111-1111-1111-111111111111'),
  ('c3333333-3333-3333-3333-333333333333')
) AS v(cid)
JOIN public.organisations o ON o.slug = 'missio';

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

CREATE FUNCTION pg_temp.fail(who text, stmt text)
RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.become(who);
  EXECUTE stmt;
  EXECUTE 'RESET ROLE';
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
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
SELECT pg_temp.expect('pastor can read and update the allowed card columns',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.connect_responses
       SET notes = 'Sat on the left'
     WHERE id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'rows=1');
SELECT pg_temp.expect('pastor update of the card stuck and matched_by was pinned',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT notes || '/' || matched_contact_id::text || '/' || source || '/' ||
           matched_by::text || '/' || (matched_at IS NOT NULL)::text || '/' ||
           phone || '/' || coalesce(phone_e164, '')
    FROM public.connect_responses
    WHERE id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'Sat on the left/c1111111-1111-1111-1111-111111111111/manual/a1111111-1111-1111-1111-111111111111/true/5550100/');
SELECT pg_temp.expect('pastor cannot change source to qr',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.connect_responses
       SET source = 'qr'
     WHERE id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'err 42501');
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
SELECT pg_temp.expect('service role removes the qr follow-up',
  pg_temp.exec('service', $$
    DELETE FROM public.missio_followups
    WHERE connect_response_id = 'd3333333-3333-4333-8333-333333333333'
  $$),
  'rows=1');
SELECT pg_temp.expect('service role removes the qr card',
  pg_temp.exec('service', $$
    DELETE FROM public.connect_responses
    WHERE id = 'd3333333-3333-4333-8333-333333333333'
  $$),
  'rows=1');

SELECT pg_temp.expect('the first card created one follow-up',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' || min(stage) || '/' || min(contact_id::text)
    FROM public.missio_followups
    WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  '1/new/c1111111-1111-1111-1111-111111111111');
SELECT pg_temp.expect('insert wrote one stage_change from nothing to new',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' ||
           min(kind) || '/' ||
           coalesce(min(from_stage), '') || '/' ||
           min(to_stage) || '/' ||
           min(changed_by::text)
    FROM public.missio_followup_stage_history
    WHERE kind = 'stage_change'
      AND followup_id = (
      SELECT id FROM public.missio_followups
      WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
    )
  $$),
  '1/stage_change//new/a1111111-1111-1111-1111-111111111111');
SELECT pg_temp.expect('setting the stage to itself writes no history',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_followups
       SET stage = stage
     WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'rows=1');
SELECT pg_temp.expect('history count is still 1 after the no-op stage update',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text
    FROM public.missio_followup_stage_history
    WHERE followup_id = (
      SELECT id FROM public.missio_followups
      WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
    )
  $$),
  '2');
SELECT pg_temp.expect('updating the assignees writes no history',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_followups
       SET assigned_leader_contact_id = 'c3333333-3333-3333-3333-333333333333',
           assigned_user_id = 'a1111111-1111-1111-1111-111111111111'
     WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'rows=1');
SELECT pg_temp.expect('assignees stuck and history is still 1',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT (
      SELECT assigned_leader_contact_id::text || '/' || assigned_user_id::text
      FROM public.missio_followups
      WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
    ) || '/' || (
      SELECT count(*)::text
      FROM public.missio_followup_stage_history
      WHERE followup_id = (
      SELECT id FROM public.missio_followups
      WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
    )
    )
  $$),
  'c3333333-3333-3333-3333-333333333333/a1111111-1111-1111-1111-111111111111/2');
SELECT pg_temp.expect('pastor can move the stage to contacted',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_followups
       SET stage = 'contacted'
     WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'rows=1');
SELECT pg_temp.expect('stage change wrote from new to contacted',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' ||
           count(*) FILTER (
             WHERE kind = 'stage_change' AND from_stage = 'new' AND to_stage = 'contacted'
           )::text
    FROM public.missio_followup_stage_history
    WHERE followup_id = (
      SELECT id FROM public.missio_followups
      WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
    )
  $$),
  '3/1');
SELECT pg_temp.expect('pastor can insert a note',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_followup_stage_history (followup_id, kind, notes)
    SELECT id, 'note', 'Called the card'
    FROM public.missio_followups
    WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'rows=1');
SELECT pg_temp.expect('the note is a note, with no to_stage, attributed to the pastor',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT kind || '/' || coalesce(to_stage, '') || '/' || notes || '/' || changed_by::text
    FROM public.missio_followup_stage_history
    WHERE followup_id = (
      SELECT id FROM public.missio_followups
      WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
    )
      AND kind = 'note'
  $$),
  'note//Called the card/a1111111-1111-1111-1111-111111111111');
SELECT pg_temp.expect('pastor cannot insert a stage_change row',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_followup_stage_history (followup_id, kind, to_stage)
    SELECT id, 'stage_change', 'joined'
    FROM public.missio_followups
    WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'err 42501');
SELECT pg_temp.expect('a note without notes is rejected',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.missio_followup_stage_history (followup_id, kind, notes)
    SELECT id, 'note', NULL
    FROM public.missio_followups
    WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'err 23514');
SELECT pg_temp.expect('pastor cannot update history',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.missio_followup_stage_history
       SET notes = 'rewritten'
     WHERE followup_id = (
      SELECT id FROM public.missio_followups
      WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
    )
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot delete history',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.missio_followup_stage_history
    WHERE followup_id = (
      SELECT id FROM public.missio_followups
      WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
    )
  $$),
  'err 42501');
SELECT pg_temp.expect('pastor cannot delete a follow-up',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    DELETE FROM public.missio_followups
    WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
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
           min(first_name) || '/' || min(last_name) || '/' ||
           min(display_name) || '/' ||
           coalesce(min(phone), '') || '/' ||
           coalesce(min(phone_e164), '') || '/' ||
           min(wants_house_church::text) || '/' ||
           min(followup_stage)
    FROM public.missio_not_in_house
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
  $$),
  '1/contact/d1111111-1111-4111-8111-111111111111/Label/Person/Label Person///true/contacted');
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
           coalesce(min(phone_e164), '') || '/' ||
           bool_and(contact_id IS NULL)::text || '/' || min(source)
    FROM public.missio_not_in_house
    WHERE connect_response_id = 'd2222222-2222-4222-8222-222222222222'
  $$),
  '1/Walk In/5550199//true/connect_response');
SELECT pg_temp.expect('not-in-house lists the person, the unmatched card, and the unhoused org person',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111',
    $$SELECT count(*)::text FROM public.missio_not_in_house$$),
  '3');
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
    SELECT id, 'c3333333-3333-3333-3333-333333333333'
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
      WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
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
      WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
    ) || '/' || (
      SELECT count(*) FILTER (
        WHERE kind = 'stage_change' AND from_stage = 'contacted' AND to_stage = 'joined'
      )::text
      FROM public.missio_followup_stage_history
      WHERE followup_id = (
      SELECT id FROM public.missio_followups
      WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
    )
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
  '0/2');
SELECT pg_temp.expect('effective_stage agrees with the stored joined stage',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT stage || '/' || effective_stage
    FROM public.missio_followup_effective
    WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'joined/joined');

ALTER TABLE public.house_church_members DISABLE TRIGGER trg_house_church_member_mark_joined;
UPDATE public.missio_followups
   SET stage = 'visited_house'
 WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111';
ALTER TABLE public.house_church_members ENABLE TRIGGER trg_house_church_member_mark_joined;

SELECT pg_temp.expect('effective_stage stays joined while the membership is active',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT stage || '/' || effective_stage
    FROM public.missio_followup_effective
    WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  'visited_house/joined');

INSERT INTO public.org_people (org_id, contact_id, campus, status)
SELECT id, 'c2222222-2222-2222-2222-222222222222', 'potch', 'active'
FROM public.organisations WHERE slug = 'missio';
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
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$
    SELECT count(*)::text || '/' || bool_and(contact_id IS NULL)::text || '/' || min(stage)
    FROM public.missio_followups
    WHERE connect_response_id = 'd2222222-2222-4222-8222-222222222222'
  $$),
  '1/true/new');
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

-- ── Phone, attach, and all-role contact guard ─────────────
SELECT pg_temp.expect('082 123 4567 normalizes to +27821234567',
  (SELECT public.missio_phone_e164('082 123 4567')),
  '+27821234567');
SELECT pg_temp.expect('+27 82 123 4567 normalizes to +27821234567',
  (SELECT public.missio_phone_e164('+27 82 123 4567')),
  '+27821234567');
SELECT pg_temp.expect('garbage phone normalizes to null',
  (SELECT (public.missio_phone_e164('garbage') IS NULL)::text),
  'true');
SELECT pg_temp.expect('pastor stores the raw phone and the e164 form',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.connect_responses (
      id, org_id, name, phone, visit_type, source
    )
    SELECT 'd4444444-4444-4444-8444-444444444444', id,
           'Local Phone', '082 123 4567', 'first_time', 'manual'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('the stored card kept the raw phone and the e164 form',
  (SELECT phone || '/' || phone_e164
     FROM public.connect_responses
    WHERE id = 'd4444444-4444-4444-8444-444444444444'),
  '082 123 4567/+27821234567');
SELECT pg_temp.expect('a repeat card with the same phone attaches',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.connect_responses (
      id, org_id, name, phone, visit_type, source
    )
    SELECT 'd5555555-5555-4555-8555-555555555555', id,
           'Same Phone', '+27 82 123 4567', 'been_a_while', 'manual'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('same phone did not create a second follow-up',
  (SELECT count(DISTINCT h.followup_id)::text || '/' || count(*)::text
     FROM public.missio_followup_stage_history h
    WHERE h.kind = 'connect_card'
      AND h.connect_response_id IN (
        'd4444444-4444-4444-8444-444444444444',
        'd5555555-5555-4555-8555-555555555555'
      )),
  '1/2');
UPDATE public.missio_followups
   SET stage = 'joined'
 WHERE id = (
   SELECT followup_id FROM public.missio_followup_stage_history
   WHERE connect_response_id = 'd4444444-4444-4444-8444-444444444444'
     AND kind = 'connect_card'
 );
SELECT pg_temp.expect('a card after the person joined creates a new follow-up',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.connect_responses (
      id, org_id, name, phone, visit_type, source
    )
    SELECT 'd6666666-6666-4666-8666-666666666666', id,
           'After Join', '082 123 4567', 'regular', 'manual'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('the post-join card has its own open follow-up',
  (SELECT count(DISTINCT h.followup_id)::text || '/' ||
          count(*) FILTER (WHERE f.stage = 'new')::text
     FROM public.missio_followup_stage_history h
     JOIN public.missio_followups f ON f.id = h.followup_id
    WHERE h.kind = 'connect_card'
      AND h.connect_response_id IN (
        'd4444444-4444-4444-8444-444444444444',
        'd6666666-6666-4666-8666-666666666666'
      )),
  '2/1');
SELECT pg_temp.expect('a repeat card for the same matched contact attaches',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    INSERT INTO public.connect_responses (
      id, org_id, name, phone, visit_type, source, matched_contact_id
    )
    SELECT 'd7777777-7777-4777-8777-777777777777', id,
           'Again', '5550111', 'first_time', 'manual',
           'c1111111-1111-1111-1111-111111111111'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('the matched contact still has one open follow-up',
  (SELECT count(*)::text
     FROM public.missio_followups
    WHERE contact_id = 'c1111111-1111-1111-1111-111111111111'
      AND stage <> 'joined'),
  '1');

INSERT INTO public.contacts (id, first_name, last_name)
VALUES ('c5555555-5555-5555-5555-555555555555', 'Outside', 'Person');
SELECT pg_temp.expect('service role cannot match a card to a non-org contact',
  pg_temp.fail('service', $$
    INSERT INTO public.connect_responses (
      org_id, name, phone, visit_type, source, matched_contact_id, matched_by
    )
    SELECT id, 'Outside Card', '5550122', 'first_time', 'manual',
           'c5555555-5555-5555-5555-555555555555',
           'a4444444-4444-4444-4444-444444444444'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  '23503 missio_contact_not_in_org');
SELECT pg_temp.expect('service role cannot open a follow-up for a non-org contact',
  pg_temp.fail('service', $$
    INSERT INTO public.missio_followups (org_id, contact_id)
    SELECT id, 'c5555555-5555-5555-5555-555555555555'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  '23503 missio_contact_not_in_org');
SELECT pg_temp.expect('service role cannot assign a leader who is not in the org',
  pg_temp.fail('service', $$
    INSERT INTO public.missio_followups (org_id, connect_response_id, assigned_leader_contact_id)
    SELECT id, 'd2222222-2222-4222-8222-222222222222',
           'c5555555-5555-5555-5555-555555555555'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  '23503 missio_contact_not_in_org');
SELECT pg_temp.expect('service role keeps the supplied matched_by',
  pg_temp.exec('service', $$
    INSERT INTO public.connect_responses (
      id, org_id, name, phone, visit_type, source,
      matched_contact_id, matched_by, matched_at
    )
    SELECT 'd8888888-8888-4888-8888-888888888888', id,
           'Kept By', '5550133', 'first_time', 'qr',
           'c2222222-2222-2222-2222-222222222222',
           'a4444444-4444-4444-4444-444444444444',
           timestamptz '2000-01-01'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.expect('matched_by stayed and matched_at is now',
  (SELECT matched_by::text || '/' || (matched_at::date = current_date)::text
     FROM public.connect_responses
    WHERE id = 'd8888888-8888-4888-8888-888888888888'),
  'a4444444-4444-4444-4444-444444444444/true');

SELECT pg_temp.expect('an unmatched card can be matched later when the contact is free',
  pg_temp.exec('service', $$
    INSERT INTO public.connect_responses (
      id, org_id, name, phone, visit_type, source
    )
    SELECT 'd9999999-9999-4999-8999-999999999999', id,
           'Late Free', 'not-a-phone', 'first_time', 'manual'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.exec('service', $$
  UPDATE public.connect_responses
     SET matched_contact_id = 'c3333333-3333-3333-3333-333333333333'
   WHERE id = 'd9999999-9999-4999-8999-999999999999'
$$);
SELECT pg_temp.expect('late match set the follow-up contact when nobody else was open',
  (SELECT contact_id::text
     FROM public.missio_followups
    WHERE connect_response_id = 'd9999999-9999-4999-8999-999999999999'),
  'c3333333-3333-3333-3333-333333333333');

SELECT pg_temp.expect('a second unmatched card is staged for the conflict',
  pg_temp.exec('service', $$
    INSERT INTO public.connect_responses (
      id, org_id, name, phone, visit_type, source
    )
    SELECT 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id,
           'Late Clash', 'also-not-a-phone', 'regular', 'manual'
    FROM public.organisations WHERE slug = 'missio'
  $$),
  'rows=1');
SELECT pg_temp.exec('service', $$
  UPDATE public.connect_responses
     SET matched_contact_id = 'c3333333-3333-3333-3333-333333333333'
   WHERE id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
$$);
SELECT pg_temp.expect('late match conflict leaves the card follow-up unmatched',
  (SELECT (contact_id IS NULL)::text
     FROM public.missio_followups
    WHERE connect_response_id = 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'true');
SELECT pg_temp.expect('late match conflict wrote a note on both follow-ups',
  (SELECT count(DISTINCT followup_id)::text
     FROM public.missio_followup_stage_history
    WHERE kind = 'note'
      AND notes = 'A duplicate needs a manual merge.'),
  '2');

CREATE TEMP TABLE leak_log (got text);
GRANT INSERT, SELECT ON leak_log TO authenticated, anon;
CREATE FUNCTION pg_temp.leak(t text)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO leak_log VALUES (t);
  RETURN true;
END $$;
SELECT pg_temp.expect('security barrier returns no rows to a non-pastor',
  pg_temp.scalar('a9999999-9999-9999-9999-999999999999', $$
    SELECT count(*)::text
    FROM public.missio_not_in_house
    WHERE pg_temp.leak(coalesce(display_name, ''))
  $$),
  '0');
SELECT pg_temp.expect('the leak function saw no not-in-house names',
  (SELECT count(*)::text FROM leak_log),
  '0');
SELECT pg_temp.expect('not-in-house has no email column',
  (SELECT count(*)::text
     FROM pg_attribute
    WHERE attrelid = 'public.missio_not_in_house'::regclass
      AND attname = 'email'
      AND NOT attisdropped),
  '0');
SELECT pg_temp.expect('anon still cannot read not-in-house after the extra rows',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_not_in_house$$),
  'err 42501');

SELECT pg_temp.expect('policy text names the outer connect card columns',
  (SELECT bool_and(
      pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%connect_responses.org_id%'
      AND pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%connect_responses.matched_contact_id%'
    )::text
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
    WHERE c.relname = 'connect_responses'
      AND pol.polcmd IN ('a', 'w')
      AND pol.polwithcheck IS NOT NULL
      AND pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%org_people%'),
  'true');
SELECT pg_temp.expect('policy text names the outer follow-up columns',
  (SELECT bool_and(
      pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%missio_followups.org_id%'
      AND pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%missio_followups.contact_id%'
    )::text
     FROM pg_policy pol
     JOIN pg_class c ON c.oid = pol.polrelid
    WHERE c.relname = 'missio_followups'
      AND pol.polcmd IN ('a', 'w')
      AND pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%org_people%'),
  'true');
ALTER TABLE public.connect_responses DISABLE TRIGGER trg_connect_response_guard_contact;
SELECT pg_temp.expect('RLS alone blocks a match to someone outside the org',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$
    UPDATE public.connect_responses
       SET matched_contact_id = 'c5555555-5555-5555-5555-555555555555'
     WHERE id = 'd2222222-2222-4222-8222-222222222222'
  $$),
  'err 42501');
ALTER TABLE public.connect_responses ENABLE TRIGGER trg_connect_response_guard_contact;
SELECT pg_temp.expect('service role cannot assign a hub user with no Missio role',
  pg_temp.fail('service', $$
    UPDATE public.missio_followups
       SET assigned_user_id = 'a4444444-4444-4444-4444-444444444444'
     WHERE connect_response_id = 'd1111111-1111-4111-8111-111111111111'
  $$),
  '23503 missio_user_not_in_org');

SELECT pg_temp.expect('phone +27 with a trunk 0 normalizes',
  (SELECT public.missio_phone_e164('+27 082 123 4567')),
  '+27821234567');
SELECT pg_temp.expect('phone 0027 international prefix normalizes',
  (SELECT public.missio_phone_e164('0027821234567')),
  '+27821234567');
SELECT pg_temp.expect('phone 00 international prefix normalizes a US number',
  (SELECT public.missio_phone_e164('0016162187556')),
  '+16162187556');
SELECT pg_temp.expect('phone extension is ignored',
  (SELECT public.missio_phone_e164('0821234567 ext 12')),
  '+27821234567');
SELECT pg_temp.expect('unknown calling code +999 is null',
  (SELECT (public.missio_phone_e164('+999123456789') IS NULL)::text),
  'true');
SELECT pg_temp.expect('nine-digit 111111111 is the ZA number phone.ts accepts',
  (SELECT public.missio_phone_e164('111111111')),
  '+27111111111');
SELECT pg_temp.expect('ten-digit junk 1111111111 is null',
  (SELECT (public.missio_phone_e164('1111111111') IS NULL)::text),
  'true');

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
