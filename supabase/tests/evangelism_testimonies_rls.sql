-- Disposable RLS check for migration 307. Not a migration.
-- Stubs the tables and helper functions the migration calls, applies
-- 307 (twice — it must be re-runnable), then reads and writes as
-- admin, publisher, submitter, viewer and outsider.
--
--   dropdb --if-exists evangelism_rls && createdb evangelism_rls
--   psql -v ON_ERROR_STOP=1 -d evangelism_rls -f supabase/tests/evangelism_testimonies_rls.sql
--
-- Each user is switched with set_config: request.jwt.claim.sub is the
-- auth.uid(), test.admin makes is_admin() true, test.perms is the
-- comma-separated list has_permission() answers yes to.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('test.admin', true) = 'true';
$$;

CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT required_permission = ANY (
    string_to_array(coalesce(current_setting('test.perms', true), ''), ',')
  );
$$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.staff_ministries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);
CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  key text UNIQUE NOT NULL,
  display_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);

\ir ../migrations/307_evangelism_testimonies.sql
-- Re-running must not fail or duplicate anything.
\ir ../migrations/307_evangelism_testimonies.sql

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- ── Seed (as the table owner, bypassing RLS) ─────────────
-- a = admin, b = publisher, c = submitter, d = second submitter,
-- e = viewer, f = outsider
INSERT INTO public.users (id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff');
INSERT INTO public.staff_ministries (id, name) VALUES
  ('99999999-9999-9999-9999-999999999999', 'Evangelism team');

-- One story per status, all by the second submitter (d).
INSERT INTO public.evangelism_testimonies
  (id, author_user_id, title, body, occurred_on, location_label, outcome,
   consent_to_share, status, published_at, published_by, withheld_reason)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'D draft', repeat('d', 50), '2026-11-01', 'Durban', 'prayer', false, 'draft', NULL, NULL, NULL),
  ('10000000-0000-0000-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'D submitted', repeat('d', 50), '2026-11-01', 'Durban', 'prayer', true, 'submitted', NULL, NULL, NULL),
  ('10000000-0000-0000-0000-000000000003', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'D published', repeat('d', 50), '2026-11-01', 'Durban', 'decision', true, 'published',
   now(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL),
  ('10000000-0000-0000-0000-000000000004', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'D withheld', repeat('d', 50), '2026-11-01', 'Durban', 'other', true, 'withheld', NULL, NULL, 'Names a minor');
INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes, created_by) VALUES
  ('10000000-0000-0000-0000-000000000003', 'photo',
   'testimonies/dddddddd-dddd-dddd-dddd-dddddddddddd/20000000-0000-0000-0000-000000000003.jpg',
   'image/jpeg', 1000, 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('10000000-0000-0000-0000-000000000004', 'photo',
   'testimonies/dddddddd-dddd-dddd-dddd-dddddddddddd/20000000-0000-0000-0000-000000000004.jpg',
   'image/jpeg', 1000, 'dddddddd-dddd-dddd-dddd-dddddddddddd');

-- ── Table-level checks (any writer) ──────────────────────
DO $$
BEGIN
  BEGIN
    INSERT INTO public.evangelism_testimonies
      (author_user_id, title, body, occurred_on, location_label, outcome, consent_to_share, status)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'No consent', repeat('x', 50),
            '2026-11-01', 'Durban', 'prayer', false, 'submitted');
    RAISE EXCEPTION 'submitted without consent was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.evangelism_testimonies
      (author_user_id, title, body, occurred_on, location_label, outcome, people_reached, decisions)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Bad sums', repeat('x', 50),
            '2026-11-01', 'Durban', 'prayer', 2, 3);
    RAISE EXCEPTION 'decisions > people_reached was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.evangelism_testimonies
      (author_user_id, title, body, occurred_on, location_label, outcome)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Bad outcome', repeat('x', 50),
            '2026-11-01', 'Durban', 'healing');
    RAISE EXCEPTION 'unknown outcome was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes)
    VALUES ('10000000-0000-0000-0000-000000000001', 'video',
            'testimonies/dddddddd-dddd-dddd-dddd-dddddddddddd/20000000-0000-0000-0000-000000000009.jpg',
            'image/jpeg', 10);
    RAISE EXCEPTION 'video kind was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes)
    VALUES ('10000000-0000-0000-0000-000000000001', 'photo',
            'testimonies/dddddddd-dddd-dddd-dddd-dddddddddddd/20000000-0000-0000-0000-000000000009.jpg',
            'image/jpeg', 15728641);
    RAISE EXCEPTION 'photo over 15 MB was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT public FROM storage.buckets WHERE id = 'evangelism-media') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'evangelism-media bucket is not private';
  END IF;
  IF (SELECT file_size_limit FROM storage.buckets WHERE id = 'evangelism-media') <> 15728640 THEN
    RAISE EXCEPTION 'evangelism-media bucket limit is not 15 MB';
  END IF;
  IF (SELECT count(*) FROM public.permissions WHERE module = 'evangelism') <> 3 THEN
    RAISE EXCEPTION 'expected three evangelism permission keys';
  END IF;
END $$;

-- ── anon gets nothing ────────────────────────────────────
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.evangelism_testimonies;
    RAISE EXCEPTION 'anon could read evangelism_testimonies';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET ROLE authenticated;

-- ── outsider (no key) ────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', false);
SELECT set_config('test.admin', '', false);
SELECT set_config('test.perms', '', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.evangelism_testimonies) <> 0 THEN
    RAISE EXCEPTION 'outsider saw a testimony';
  END IF;
  IF (SELECT count(*) FROM public.evangelism_media) <> 0 THEN
    RAISE EXCEPTION 'outsider saw a photo';
  END IF;
  BEGIN
    INSERT INTO public.evangelism_testimonies
      (author_user_id, title, body, occurred_on, location_label, outcome)
    VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Outsider', repeat('o', 50),
            '2026-11-01', 'Durban', 'prayer');
    RAISE EXCEPTION 'outsider inserted a testimony';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── viewer ───────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', false);
SELECT set_config('test.perms', 'evangelism.view', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.evangelism_testimonies) <> 1 THEN
    RAISE EXCEPTION 'viewer should see only the published story';
  END IF;
  IF (SELECT status FROM public.evangelism_testimonies) <> 'published' THEN
    RAISE EXCEPTION 'viewer saw a non-published story';
  END IF;
  IF (SELECT count(*) FROM public.evangelism_media) <> 1 THEN
    RAISE EXCEPTION 'viewer should see only the published story''s photo';
  END IF;
  BEGIN
    INSERT INTO public.evangelism_testimonies
      (author_user_id, title, body, occurred_on, location_label, outcome)
    VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Viewer', repeat('v', 50),
            '2026-11-01', 'Durban', 'prayer');
    RAISE EXCEPTION 'viewer inserted a testimony';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.evangelism_testimonies SET title = 'Viewer edit'
   WHERE id = '10000000-0000-0000-0000-000000000003';
  DELETE FROM public.evangelism_testimonies WHERE id = '10000000-0000-0000-0000-000000000003';
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT title FROM public.evangelism_testimonies WHERE id = '10000000-0000-0000-0000-000000000003')
     <> 'D published' THEN
    RAISE EXCEPTION 'viewer changed or deleted a published story';
  END IF;
END $$;
SET ROLE authenticated;

-- ── submitter (c) ────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', false);
SELECT set_config('test.perms', 'evangelism.submit', false);
DO $$
BEGIN
  -- Sees the published story only; not d's draft, submitted or withheld.
  IF (SELECT count(*) FROM public.evangelism_testimonies) <> 1 THEN
    RAISE EXCEPTION 'submitter saw another author''s open or withheld story';
  END IF;

  -- Cannot insert for someone else.
  BEGIN
    INSERT INTO public.evangelism_testimonies
      (author_user_id, title, body, occurred_on, location_label, outcome)
    VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Spoof', repeat('s', 50),
            '2026-11-01', 'Durban', 'prayer');
    RAISE EXCEPTION 'submitter inserted as another author';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Cannot insert straight to published.
  BEGIN
    INSERT INTO public.evangelism_testimonies
      (author_user_id, title, body, occurred_on, location_label, outcome, consent_to_share, status)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Self publish', repeat('s', 50),
            '2026-11-01', 'Durban', 'prayer', true, 'published');
    RAISE EXCEPTION 'submitter inserted a published story';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Own draft, then submit.
  INSERT INTO public.evangelism_testimonies
    (id, author_user_id, title, body, occurred_on, location_label, outcome, staff_ministry_id)
  VALUES ('30000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          'C draft', repeat('c', 50), '2026-11-02', 'Cape Town', 'conversation',
          '99999999-9999-9999-9999-999999999999');
  INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes, created_by)
  VALUES ('30000000-0000-0000-0000-000000000001', 'photo',
          'testimonies/cccccccc-cccc-cccc-cccc-cccccccccccc/40000000-0000-0000-0000-000000000001.png',
          'image/png', 2048, 'cccccccc-cccc-cccc-cccc-cccccccccccc');

  -- Photo at someone else's path is refused.
  BEGIN
    INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes, created_by)
    VALUES ('30000000-0000-0000-0000-000000000001', 'photo',
            'testimonies/dddddddd-dddd-dddd-dddd-dddddddddddd/40000000-0000-0000-0000-000000000002.png',
            'image/png', 2048, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
    RAISE EXCEPTION 'submitter attached a photo at another author''s path';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Photo onto someone else's story is refused.
  BEGIN
    INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes, created_by)
    VALUES ('10000000-0000-0000-0000-000000000001', 'photo',
            'testimonies/cccccccc-cccc-cccc-cccc-cccccccccccc/40000000-0000-0000-0000-000000000003.png',
            'image/png', 2048, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
    RAISE EXCEPTION 'submitter attached a photo to another author''s story';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Submit without consent fails (DB CHECK).
  BEGIN
    UPDATE public.evangelism_testimonies SET status = 'submitted'
     WHERE id = '30000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'submitted without consent';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE public.evangelism_testimonies SET status = 'submitted', consent_to_share = true
   WHERE id = '30000000-0000-0000-0000-000000000001';

  -- Self-publish is refused.
  BEGIN
    UPDATE public.evangelism_testimonies SET status = 'published'
     WHERE id = '30000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'submitter published their own story';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Stamps are refused too.
  BEGIN
    UPDATE public.evangelism_testimonies SET withheld_reason = 'x'
     WHERE id = '30000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'submitter set withheld_reason';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Cannot touch another author's open story (0 rows, no error).
  UPDATE public.evangelism_testimonies SET title = 'Hijack'
   WHERE id = '10000000-0000-0000-0000-000000000002';
  DELETE FROM public.evangelism_testimonies WHERE id = '10000000-0000-0000-0000-000000000001';

  -- Cannot delete own story once submitted.
  DELETE FROM public.evangelism_testimonies WHERE id = '30000000-0000-0000-0000-000000000001';
  IF (SELECT count(*) FROM public.evangelism_testimonies
       WHERE id = '30000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'submitter deleted a submitted story';
  END IF;

  -- Sees own submitted + published.
  IF (SELECT count(*) FROM public.evangelism_testimonies) <> 2 THEN
    RAISE EXCEPTION 'submitter should see own submitted story and the published one';
  END IF;
  IF (SELECT count(*) FROM public.evangelism_media) <> 2 THEN
    RAISE EXCEPTION 'submitter should see own photo and the published photo';
  END IF;

  -- Own draft can be deleted.
  INSERT INTO public.evangelism_testimonies
    (id, author_user_id, title, body, occurred_on, location_label, outcome)
  VALUES ('30000000-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          'C throwaway', repeat('c', 50), '2026-11-02', 'Cape Town', 'other');
  DELETE FROM public.evangelism_testimonies WHERE id = '30000000-0000-0000-0000-000000000002';
  IF (SELECT count(*) FROM public.evangelism_testimonies
       WHERE id = '30000000-0000-0000-0000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'submitter could not delete their own draft';
  END IF;
END $$;

-- author_user_id is not in the UPDATE grant.
DO $$
BEGIN
  UPDATE public.evangelism_testimonies SET author_user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
   WHERE id = '30000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'submitter reassigned author_user_id';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT title FROM public.evangelism_testimonies WHERE id = '10000000-0000-0000-0000-000000000002')
     <> 'D submitted' THEN
    RAISE EXCEPTION 'submitter edited another author''s story';
  END IF;
  IF (SELECT count(*) FROM public.evangelism_testimonies WHERE id = '10000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'submitter deleted another author''s draft';
  END IF;
END $$;
SET ROLE authenticated;

-- ── publisher (b) ────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT set_config('test.perms', 'evangelism.publish', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.evangelism_testimonies) <> 5 THEN
    RAISE EXCEPTION 'publisher should see every story, withheld included';
  END IF;

  -- Publish c's submitted story; the guard stamps it, ignoring a forged stamp.
  UPDATE public.evangelism_testimonies
     SET status = 'published',
         published_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         published_at = '2000-01-01'
   WHERE id = '30000000-0000-0000-0000-000000000001';
  IF (SELECT published_by FROM public.evangelism_testimonies
       WHERE id = '30000000-0000-0000-0000-000000000001') <> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' THEN
    RAISE EXCEPTION 'published_by was not stamped as the publisher';
  END IF;
  IF (SELECT published_at FROM public.evangelism_testimonies
       WHERE id = '30000000-0000-0000-0000-000000000001') < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'published_at was backdated';
  END IF;

  -- Withhold d's submitted story with a reason.
  UPDATE public.evangelism_testimonies SET status = 'withheld', withheld_reason = 'Needs a name removed'
   WHERE id = '10000000-0000-0000-0000-000000000002';
  IF (SELECT withheld_reason FROM public.evangelism_testimonies
       WHERE id = '10000000-0000-0000-0000-000000000002') <> 'Needs a name removed' THEN
    RAISE EXCEPTION 'withhold did not keep the reason';
  END IF;

  -- Cannot publish a story without consent (d's draft).
  BEGIN
    UPDATE public.evangelism_testimonies SET status = 'published'
     WHERE id = '10000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'publisher published a story without consent';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Publisher may delete any story.
  DELETE FROM public.evangelism_testimonies WHERE id = '10000000-0000-0000-0000-000000000004';
  IF (SELECT count(*) FROM public.evangelism_testimonies
       WHERE id = '10000000-0000-0000-0000-000000000004') <> 0 THEN
    RAISE EXCEPTION 'publisher could not delete a story';
  END IF;
END $$;

-- ── submitter (c) after review ───────────────────────────
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', false);
SELECT set_config('test.perms', 'evangelism.submit', false);
DO $$
BEGIN
  -- c's story is published now: readable, no longer editable by c.
  UPDATE public.evangelism_testimonies SET title = 'Edited after publish'
   WHERE id = '30000000-0000-0000-0000-000000000001';
  IF (SELECT title FROM public.evangelism_testimonies
       WHERE id = '30000000-0000-0000-0000-000000000001') <> 'C draft' THEN
    RAISE EXCEPTION 'author edited a published story';
  END IF;
END $$;

-- ── second submitter (d) — withheld is hidden from the author too ─
SELECT set_config('request.jwt.claim.sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.evangelism_testimonies WHERE status = 'withheld') THEN
    RAISE EXCEPTION 'author saw their own withheld story';
  END IF;
  -- d: own draft + two published (d's and c's).
  IF (SELECT count(*) FROM public.evangelism_testimonies) <> 3 THEN
    RAISE EXCEPTION 'second submitter saw the wrong set of stories';
  END IF;
END $$;

-- ── admin (no key) ───────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('test.perms', '', false);
SELECT set_config('test.admin', 'true', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.evangelism_testimonies) <> 4 THEN
    RAISE EXCEPTION 'admin should see every remaining story';
  END IF;
  INSERT INTO public.evangelism_testimonies
    (id, author_user_id, title, body, occurred_on, location_label, outcome, consent_to_share, status)
  VALUES ('50000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'Admin story', repeat('a', 50), '2026-11-03', 'Joburg', 'decision', true, 'submitted');
  UPDATE public.evangelism_testimonies SET status = 'published'
   WHERE id = '50000000-0000-0000-0000-000000000001';
  IF (SELECT published_by FROM public.evangelism_testimonies
       WHERE id = '50000000-0000-0000-0000-000000000001') <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' THEN
    RAISE EXCEPTION 'admin publish was not stamped';
  END IF;
END $$;

RESET ROLE;

\echo 'evangelism testimonies RLS checks passed'
