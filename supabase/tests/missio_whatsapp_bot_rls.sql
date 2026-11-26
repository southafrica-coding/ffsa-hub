-- Disposable role-matrix check for migration 397. Not a migration.
-- Stubs the few FFSA objects 396 and 397 reference (organisations,
-- contacts, users, has_org_role_id over a stub org_staff_roles), applies
-- 396 once and 397 twice, then reads and writes as a Missio pastor, a
-- Missio house church leader (not a pastor), a pastor of another org,
-- anon, and the service role.
--
--   dropdb --if-exists missio_whatsapp_bot && createdb missio_whatsapp_bot
--   psql -v ON_ERROR_STOP=1 -d missio_whatsapp_bot -f supabase/tests/missio_whatsapp_bot_rls.sql
--
-- Never point this at a shared or hosted database. service_role is given
-- BYPASSRLS here because that is how Supabase's service role passes a
-- table that has no policy for it. Phone numbers and names are made up.

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

-- Hosted Supabase grants new public tables and functions to anon and
-- authenticated. 396 and 397 must revoke and tighten.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.organisations (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL);
CREATE TABLE public.contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), first_name text);
CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.org_staff_roles (user_id uuid NOT NULL, org_id uuid NOT NULL, role text NOT NULL);

-- Same shape as 329's helper: does the signed-in user hold one of these roles in this org?
CREATE OR REPLACE FUNCTION public.has_org_role_id(p_org_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_staff_roles r
    WHERE r.user_id = auth.uid() AND r.org_id = p_org_id AND r.role = ANY (p_roles)
  );
$$;

INSERT INTO public.organisations (id, slug) VALUES
  ('0a000000-0000-4000-8000-000000000001', 'missio'),
  ('0a000000-0000-4000-8000-000000000002', 'other-church');
INSERT INTO public.users (id) VALUES
  ('a1111111-1111-1111-1111-111111111111'),  -- Missio pastor
  ('a2222222-2222-2222-2222-222222222222'),  -- Missio house church leader
  ('a3333333-3333-3333-3333-333333333333');  -- pastor of another org
INSERT INTO public.org_staff_roles (user_id, org_id, role) VALUES
  ('a1111111-1111-1111-1111-111111111111', '0a000000-0000-4000-8000-000000000001', 'pastor'),
  ('a2222222-2222-2222-2222-222222222222', '0a000000-0000-4000-8000-000000000001', 'house_church_leader'),
  ('a3333333-3333-3333-3333-333333333333', '0a000000-0000-4000-8000-000000000002', 'pastor');
INSERT INTO public.contacts (id, first_name) VALUES ('c0000000-0000-4000-8000-000000000001', 'Fixture');

\ir ../migrations/396_missio_whatsapp.sql
\ir ../migrations/397_missio_whatsapp_bot.sql
\ir ../migrations/397_missio_whatsapp_bot.sql

-- ── Fixtures (as the table owner) ─────────────────────────
INSERT INTO public.missio_whatsapp_threads (id, org_id, phone_e164, wa_id) VALUES
  ('70000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', '+27820000001', '27820000001');
INSERT INTO public.missio_whatsapp_bot_sessions (org_id, thread_id, flow, step) VALUES
  ('0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'serve', 'teams');
INSERT INTO public.missio_whatsapp_bot_outbox (org_id, thread_id, inbound_wamid, inbound_at, purpose) VALUES
  ('0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'wamid.FIXTURE1', now(), 'turn');
INSERT INTO public.missio_serving_interests (id, org_id, thread_id, teams, availability, experience) VALUES
  ('e0000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
   '[{"id": null, "name": "Kids"}]', 'most_sundays', 'yes');

CREATE TEMP TABLE checks (
  n serial PRIMARY KEY,
  label text NOT NULL,
  got text,
  want text,
  ok boolean NOT NULL
);
GRANT ALL ON checks TO PUBLIC;

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
  EXECUTE 'RESET ROLE';
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
  EXECUTE 'RESET ROLE';
  RETURN 'err ' || SQLSTATE;
END;
$$;

-- pastor   a1111111-…  Missio pastor
-- leader   a2222222-…  Missio house church leader, not a pastor
-- outsider a3333333-…  pastor of another org

-- ── Reading ───────────────────────────────────────────────
SELECT pg_temp.expect('pastor reads bot sessions',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$SELECT count(*)::text FROM public.missio_whatsapp_bot_sessions$$), '1');
SELECT pg_temp.expect('pastor reads serving interests',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$SELECT count(*)::text FROM public.missio_serving_interests$$), '1');
SELECT pg_temp.expect('pastor reads the bot mode on a thread',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$SELECT bot_mode FROM public.missio_whatsapp_threads$$), 'on');
SELECT pg_temp.expect('pastor cannot read the outbox',
  pg_temp.scalar('a1111111-1111-1111-1111-111111111111', $$SELECT count(*)::text FROM public.missio_whatsapp_bot_outbox$$), 'err 42501');
SELECT pg_temp.expect('house leader sees no sessions',
  pg_temp.scalar('a2222222-2222-2222-2222-222222222222', $$SELECT count(*)::text FROM public.missio_whatsapp_bot_sessions$$), '0');
SELECT pg_temp.expect('house leader sees no serving interests',
  pg_temp.scalar('a2222222-2222-2222-2222-222222222222', $$SELECT count(*)::text FROM public.missio_serving_interests$$), '0');
SELECT pg_temp.expect('another org''s pastor sees no serving interests',
  pg_temp.scalar('a3333333-3333-3333-3333-333333333333', $$SELECT count(*)::text FROM public.missio_serving_interests$$), '0');
SELECT pg_temp.expect('anon cannot read sessions',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_whatsapp_bot_sessions$$), 'err 42501');
SELECT pg_temp.expect('anon cannot read serving interests',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_serving_interests$$), 'err 42501');
SELECT pg_temp.expect('anon cannot read the outbox',
  pg_temp.scalar('anon', $$SELECT count(*)::text FROM public.missio_whatsapp_bot_outbox$$), 'err 42501');

-- ── Pastors: who has the chat ─────────────────────────────
SELECT pg_temp.expect('pastor takes over (returning id, as the API does)',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_whatsapp_threads
    SET bot_mode = 'paused', bot_handoff_reason = 'pastor', bot_paused_by = 'a3333333-3333-3333-3333-333333333333'
    WHERE id = '70000000-0000-4000-8000-000000000001' RETURNING id$$), 'rows=1');
SELECT pg_temp.expect('the pause is stamped as the pastor who did it, not who they named',
  (SELECT bot_paused_by::text || '/' || (bot_paused_at IS NOT NULL)::text FROM public.missio_whatsapp_threads),
  'a1111111-1111-1111-1111-111111111111/true');
SELECT pg_temp.expect('pastor resumes',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_whatsapp_threads
    SET bot_mode = 'on', bot_handoff_reason = NULL WHERE id = '70000000-0000-4000-8000-000000000001'$$), 'rows=1');
SELECT pg_temp.expect('resume clears who and when',
  (SELECT bot_mode || '/' || coalesce(bot_paused_by::text, '-') || '/' || coalesce(bot_handoff_reason, '-') FROM public.missio_whatsapp_threads),
  'on/-/-');
SELECT pg_temp.expect('pastor still marks read (396)',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_whatsapp_threads SET unread_count = 0, last_read_at = now()$$), 'rows=1');
SELECT pg_temp.expect('pastor cannot lift an opt-out',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_whatsapp_threads SET opted_out_at = NULL$$), 'err 42501');
SELECT pg_temp.expect('pastor cannot set a bad bot mode',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_whatsapp_threads SET bot_mode = 'always'$$), 'err 23514');
SELECT pg_temp.expect('house leader cannot change the bot mode',
  pg_temp.exec('a2222222-2222-2222-2222-222222222222', $$UPDATE public.missio_whatsapp_threads SET bot_mode = 'paused'$$), 'rows=0');
SELECT pg_temp.expect('another org''s pastor cannot change the bot mode',
  pg_temp.exec('a3333333-3333-3333-3333-333333333333', $$UPDATE public.missio_whatsapp_threads SET bot_mode = 'paused'$$), 'rows=0');
SELECT pg_temp.expect('anon cannot change the bot mode',
  pg_temp.exec('anon', $$UPDATE public.missio_whatsapp_threads SET bot_mode = 'paused'$$), 'err 42501');

-- ── Pastors: serving interests ────────────────────────────
SELECT pg_temp.expect('pastor sets an interest''s status',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_serving_interests SET status = 'contacted' WHERE id = 'e0000000-0000-4000-8000-000000000001'$$), 'rows=1');
SELECT pg_temp.expect('pastor cannot rewrite what they said',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_serving_interests SET note = 'changed'$$), 'err 42501');
SELECT pg_temp.expect('pastor cannot move an interest to a person',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_serving_interests SET contact_id = 'c0000000-0000-4000-8000-000000000001'$$), 'err 42501');
SELECT pg_temp.expect('pastor cannot add an interest',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$INSERT INTO public.missio_serving_interests (org_id, teams)
    VALUES ('0a000000-0000-4000-8000-000000000001', '[{"id": null, "name": "Kids"}]')$$), 'err 42501');
SELECT pg_temp.expect('pastor cannot delete an interest',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$DELETE FROM public.missio_serving_interests$$), 'err 42501');
SELECT pg_temp.expect('house leader cannot set a status',
  pg_temp.exec('a2222222-2222-2222-2222-222222222222', $$UPDATE public.missio_serving_interests SET status = 'placed'$$), 'rows=0');
SELECT pg_temp.expect('pastor cannot write a bot session',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$UPDATE public.missio_whatsapp_bot_sessions SET step = 'note'$$), 'err 42501');
SELECT pg_temp.expect('pastor cannot write the outbox',
  pg_temp.exec('a1111111-1111-1111-1111-111111111111', $$INSERT INTO public.missio_whatsapp_bot_outbox (org_id, thread_id, inbound_wamid, inbound_at, purpose)
    VALUES ('0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'wamid.X', now(), 'turn')$$), 'err 42501');

-- ── Privileges ────────────────────────────────────────────
SELECT pg_temp.expect('authenticated has no TRUNCATE / REFERENCES / TRIGGER on the new tables',
  (SELECT count(*)::text FROM information_schema.role_table_grants
    WHERE grantee IN ('authenticated', 'anon', 'PUBLIC')
      AND table_name IN ('missio_whatsapp_bot_sessions', 'missio_whatsapp_bot_outbox', 'missio_serving_interests')
      AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'INSERT', 'DELETE', 'UPDATE')), '0');
SELECT pg_temp.expect('anon has nothing on the new tables',
  (SELECT count(*)::text FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_name IN ('missio_whatsapp_bot_sessions', 'missio_whatsapp_bot_outbox', 'missio_serving_interests')), '0');
SELECT pg_temp.expect('nobody calls the bot stamp directly',
  has_function_privilege('authenticated', 'public.missio_whatsapp_bot_stamp()', 'EXECUTE')::text, 'false');

-- ── Service role (the bot) ────────────────────────────────
SELECT pg_temp.expect('service role hands off (its own values stand)',
  pg_temp.exec('service', $$UPDATE public.missio_whatsapp_threads SET bot_mode = 'handed_off', bot_handoff_reason = 'human', bot_paused_at = now(), bot_paused_by = NULL$$), 'rows=1');
SELECT pg_temp.expect('the same wamid can''t be claimed twice',
  pg_temp.exec('service', $$INSERT INTO public.missio_whatsapp_bot_outbox (org_id, thread_id, inbound_wamid, inbound_at, purpose)
    VALUES ('0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'wamid.FIXTURE1', now(), 'turn')$$), 'err 23505');
SELECT pg_temp.expect('a reply needs a payload',
  pg_temp.exec('service', $$INSERT INTO public.missio_whatsapp_bot_outbox (org_id, thread_id, inbound_wamid, inbound_at, purpose, seq)
    VALUES ('0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'wamid.FIXTURE1', now(), 'reply', 1)$$), 'err 23514');
SELECT pg_temp.expect('only one open session per thread',
  pg_temp.exec('service', $$INSERT INTO public.missio_whatsapp_bot_sessions (org_id, thread_id, flow, step)
    VALUES ('0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'menu', 'main')$$), 'err 23505');
SELECT pg_temp.expect('a closed session makes room for a new one',
  pg_temp.exec('service', $$UPDATE public.missio_whatsapp_bot_sessions SET closed_at = now(), closed_reason = 'handed_off' WHERE closed_at IS NULL$$), 'rows=1');
SELECT pg_temp.expect('…and the new one opens',
  pg_temp.exec('service', $$INSERT INTO public.missio_whatsapp_bot_sessions (org_id, thread_id, flow, step)
    VALUES ('0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'menu', 'main')$$), 'rows=1');
SELECT pg_temp.expect('bot on with a reason is refused',
  pg_temp.exec('service', $$UPDATE public.missio_whatsapp_threads SET bot_mode = 'on', bot_handoff_reason = 'human', bot_paused_at = NULL$$), 'err 23514');
SELECT pg_temp.expect('the bot stores a tapped reply id on an inbound message',
  pg_temp.exec('service', $$INSERT INTO public.missio_whatsapp_messages (org_id, thread_id, direction, kind, wa_type, body, wamid, status, sent_at, wa_reply_id)
    VALUES ('0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'in', 'text', 'interactive', 'I want to serve', 'wamid.IN1', 'received', now(), 'serve')$$), 'rows=1');
SELECT pg_temp.expect('a reply id only goes on inbound',
  pg_temp.exec('service', $$INSERT INTO public.missio_whatsapp_messages (org_id, thread_id, direction, kind, body, status, sent_at, wa_reply_id)
    VALUES ('0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'out', 'text', 'x', 'pending', now(), 'serve')$$), 'err 23514');
SELECT pg_temp.expect('the bot''s own message has no pastor',
  pg_temp.exec('service', $$INSERT INTO public.missio_whatsapp_messages (org_id, thread_id, direction, kind, wa_type, body, status, sent_at, sent_by_bot)
    VALUES ('0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'out', 'text', 'interactive', 'Hi, it''s Missio.', 'pending', now(), true)$$), 'rows=1');
SELECT pg_temp.expect('…and can''t claim one',
  pg_temp.exec('service', $$INSERT INTO public.missio_whatsapp_messages (org_id, thread_id, direction, kind, body, status, sent_at, sent_by_bot, sent_by)
    VALUES ('0a000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'out', 'text', 'x', 'pending', now(), true, 'a1111111-1111-1111-1111-111111111111')$$), 'err 23514');
SELECT pg_temp.expect('a serving interest needs at least one team',
  pg_temp.exec('service', $$INSERT INTO public.missio_serving_interests (org_id, teams) VALUES ('0a000000-0000-4000-8000-000000000001', '[]')$$), 'err 23514');
SELECT pg_temp.expect('no seed rows beyond these fixtures',
  (SELECT count(*)::text FROM public.missio_serving_interests), '1');

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
  RAISE NOTICE 'missio_whatsapp_bot_rls: % passed, % failed', n_pass, n_fail;
  IF n_fail > 0 THEN
    FOR rec IN SELECT n, label, got, want FROM checks WHERE NOT ok ORDER BY n LOOP
      RAISE NOTICE '  # % % (got % want %)', rec.n, rec.label, rec.got, rec.want;
    END LOOP;
    RAISE EXCEPTION 'missio_whatsapp_bot_rls: % checks failed', n_fail;
  END IF;
END $$;
