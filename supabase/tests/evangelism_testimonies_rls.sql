-- Disposable RLS check for migration 307. Not a migration.
-- Stubs the tables and helper functions the migration calls, applies
-- 307 (twice — it must be re-runnable), then reads and writes as
-- admin, publisher, submitter, viewer, outsider and anon.
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

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  display_name text,
  first_name text,
  last_name text,
  email text
);
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
INSERT INTO public.users (id, display_name, first_name, last_name, email) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin A', NULL, NULL, 'a@example.org'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Publisher B', NULL, NULL, 'b@example.org'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, 'Carol', 'Cee', 'c@example.org'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', NULL, NULL, NULL, 'd@example.org'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Viewer E', NULL, NULL, 'e@example.org'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', NULL, NULL, NULL, NULL);
INSERT INTO public.staff_ministries (id, name) VALUES
  ('99999999-9999-9999-9999-999999999999', 'Evangelism team');

-- One story per status, all by the second submitter (d). Story 5 is a
-- draft that HAS consent (for the publisher draft→submitted bypass).
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
   'D withheld', repeat('d', 50), '2026-11-01', 'Durban', 'other', true, 'withheld', NULL, NULL, 'Names a minor'),
  ('10000000-0000-0000-0000-000000000005', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'D consented draft', repeat('d', 50), '2026-11-01', 'Durban', 'prayer', true, 'draft', NULL, NULL, NULL);

-- Upload ledger: paths carry random ids, never the author's.
INSERT INTO public.evangelism_uploads (storage_path, user_id) VALUES
  ('testimonies/20000000-0000-0000-0000-000000000003/21000000-0000-0000-0000-000000000003.jpg', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('testimonies/20000000-0000-0000-0000-000000000004/21000000-0000-0000-0000-000000000004.jpg', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('testimonies/40000000-0000-0000-0000-000000000001/41000000-0000-0000-0000-000000000001.png', 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('testimonies/40000000-0000-0000-0000-000000000009/41000000-0000-0000-0000-000000000009.png', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes, created_by) VALUES
  ('10000000-0000-0000-0000-000000000003', 'photo',
   'testimonies/20000000-0000-0000-0000-000000000003/21000000-0000-0000-0000-000000000003.jpg',
   'image/jpeg', 1000, 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('10000000-0000-0000-0000-000000000004', 'photo',
   'testimonies/20000000-0000-0000-0000-000000000004/21000000-0000-0000-0000-000000000004.jpg',
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
            'testimonies/40000000-0000-0000-0000-000000000009/41000000-0000-0000-0000-000000000009.png',
            'image/png', 10);
    RAISE EXCEPTION 'video kind was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes)
    VALUES ('10000000-0000-0000-0000-000000000001', 'photo',
            'testimonies/40000000-0000-0000-0000-000000000009/41000000-0000-0000-0000-000000000009.png',
            'image/png', 15728641);
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
  -- Grants: hidden columns, no TRUNCATE, nothing for anon.
  IF has_column_privilege('authenticated', 'public.evangelism_testimonies', 'author_user_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.evangelism_testimonies', 'published_by', 'SELECT')
     OR has_column_privilege('authenticated', 'public.evangelism_testimonies', 'withheld_reason', 'SELECT')
     OR has_column_privilege('authenticated', 'public.evangelism_media', 'storage_path', 'SELECT')
     OR has_column_privilege('authenticated', 'public.evangelism_media', 'created_by', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated can SELECT an identity column';
  END IF;
  IF has_table_privilege('authenticated', 'public.evangelism_testimonies', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.evangelism_media', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.evangelism_uploads', 'TRUNCATE') THEN
    RAISE EXCEPTION 'authenticated has TRUNCATE';
  END IF;
  IF has_table_privilege('anon', 'public.evangelism_testimonies', 'SELECT')
     OR has_table_privilege('anon', 'public.evangelism_uploads', 'SELECT')
     OR has_function_privilege('anon', 'public.evangelism_attribution(uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.evangelism_upload_is_mine(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon has access to an evangelism object';
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
  IF (SELECT count(*) FROM public.evangelism_attribution(ARRAY['10000000-0000-0000-0000-000000000003'::uuid])) <> 0 THEN
    RAISE EXCEPTION 'outsider got attribution';
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
DECLARE
  attr record;
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

  -- Author / publisher columns are not selectable.
  BEGIN
    PERFORM author_user_id FROM public.evangelism_testimonies;
    RAISE EXCEPTION 'viewer selected author_user_id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM published_by FROM public.evangelism_testimonies;
    RAISE EXCEPTION 'viewer selected published_by';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM withheld_reason FROM public.evangelism_testimonies;
    RAISE EXCEPTION 'viewer selected withheld_reason';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Nor the media path / uploader.
  BEGIN
    PERFORM storage_path FROM public.evangelism_media;
    RAISE EXCEPTION 'viewer selected a media storage_path';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM created_by FROM public.evangelism_media;
    RAISE EXCEPTION 'viewer selected media created_by';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Nor the ledger.
  BEGIN
    PERFORM 1 FROM public.evangelism_uploads;
    RAISE EXCEPTION 'viewer read the upload ledger';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Attribution: the row is listed, but no name / publisher / reason.
  SELECT * INTO attr FROM public.evangelism_attribution(ARRAY[
    '10000000-0000-0000-0000-000000000003'::uuid,
    '10000000-0000-0000-0000-000000000004'::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid]);
  IF (SELECT count(*) FROM public.evangelism_attribution(ARRAY[
        '10000000-0000-0000-0000-000000000003'::uuid,
        '10000000-0000-0000-0000-000000000004'::uuid,
        '10000000-0000-0000-0000-000000000001'::uuid])) <> 1 THEN
    RAISE EXCEPTION 'viewer got attribution for a story they cannot see';
  END IF;
  IF attr.author_name IS NOT NULL OR attr.published_by IS NOT NULL OR attr.withheld_reason IS NOT NULL OR attr.is_mine THEN
    RAISE EXCEPTION 'viewer got author or review fields from attribution';
  END IF;

  -- No path in the database names the author (paths are random/random).
  IF EXISTS (SELECT 1 FROM public.evangelism_my_testimony_ids()) THEN
    RAISE EXCEPTION 'viewer has stories of their own?';
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
  -- The author's id appears in no media path.
  IF EXISTS (SELECT 1 FROM public.evangelism_media m
              JOIN public.evangelism_testimonies t ON t.id = m.testimony_id
             WHERE m.storage_path LIKE '%' || t.author_user_id::text || '%') THEN
    RAISE EXCEPTION 'a media path contains its author''s id';
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
      (title, body, occurred_on, location_label, outcome, consent_to_share, status)
    VALUES ('Self publish', repeat('s', 50), '2026-11-01', 'Durban', 'prayer', true, 'published');
    RAISE EXCEPTION 'submitter inserted a published story';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Own draft (author_user_id from the DEFAULT), then a photo from the ledger.
  INSERT INTO public.evangelism_testimonies
    (id, title, body, occurred_on, location_label, outcome, staff_ministry_id)
  VALUES ('30000000-0000-0000-0000-000000000001',
          'C draft', repeat('c', 50), '2026-11-02', 'Cape Town', 'conversation',
          '99999999-9999-9999-9999-999999999999');
  INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes)
  VALUES ('30000000-0000-0000-0000-000000000001', 'photo',
          'testimonies/40000000-0000-0000-0000-000000000001/41000000-0000-0000-0000-000000000001.png',
          'image/png', 2048);

  -- A path minted for someone else (d) is refused.
  BEGIN
    INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes)
    VALUES ('30000000-0000-0000-0000-000000000001', 'photo',
            'testimonies/40000000-0000-0000-0000-000000000009/41000000-0000-0000-0000-000000000009.png',
            'image/png', 2048);
    RAISE EXCEPTION 'submitter attached a photo at another user''s upload path';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- A well-formed path nobody minted is refused.
  BEGIN
    INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes)
    VALUES ('30000000-0000-0000-0000-000000000001', 'photo',
            'testimonies/cccccccc-cccc-cccc-cccc-cccccccccccc/41000000-0000-0000-0000-000000000077.png',
            'image/png', 2048);
    RAISE EXCEPTION 'submitter attached an unminted path';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Cannot register or delete upload paths directly.
  BEGIN
    INSERT INTO public.evangelism_uploads (storage_path, user_id)
    VALUES ('testimonies/40000000-0000-0000-0000-000000000008/41000000-0000-0000-0000-000000000008.png',
            'cccccccc-cccc-cccc-cccc-cccccccccccc');
    RAISE EXCEPTION 'submitter registered an upload path';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.evangelism_uploads
     WHERE storage_path = 'testimonies/40000000-0000-0000-0000-000000000009/41000000-0000-0000-0000-000000000009.png';
    RAISE EXCEPTION 'submitter deleted another user''s upload path';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF NOT public.evangelism_upload_is_mine(
       'testimonies/40000000-0000-0000-0000-000000000001/41000000-0000-0000-0000-000000000001.png')
     OR public.evangelism_upload_is_mine(
       'testimonies/40000000-0000-0000-0000-000000000009/41000000-0000-0000-0000-000000000009.png') THEN
    RAISE EXCEPTION 'evangelism_upload_is_mine answered wrong';
  END IF;

  -- Photo onto someone else's story is refused (even with own path).
  BEGIN
    INSERT INTO public.evangelism_media (testimony_id, kind, storage_path, content_type, size_bytes)
    VALUES ('10000000-0000-0000-0000-000000000001', 'photo',
            'testimonies/40000000-0000-0000-0000-000000000001/41000000-0000-0000-0000-000000000001.png',
            'image/png', 2048);
    RAISE EXCEPTION 'submitter attached a photo to another author''s story';
  EXCEPTION WHEN insufficient_privilege OR unique_violation THEN NULL;
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

  -- Sees own submitted + published; "mine" is just their own.
  IF (SELECT count(*) FROM public.evangelism_testimonies) <> 2 THEN
    RAISE EXCEPTION 'submitter should see own submitted story and the published one';
  END IF;
  IF (SELECT count(*) FROM public.evangelism_media) <> 2 THEN
    RAISE EXCEPTION 'submitter should see own photo and the published photo';
  END IF;
  IF (SELECT array_agg(x) FROM public.evangelism_my_testimony_ids() x)
     <> ARRAY['30000000-0000-0000-0000-000000000001'::uuid] THEN
    RAISE EXCEPTION 'evangelism_my_testimony_ids returned the wrong set';
  END IF;
  IF (SELECT author_name FROM public.evangelism_attribution(ARRAY['30000000-0000-0000-0000-000000000001'::uuid]))
     IS DISTINCT FROM 'Carol Cee' THEN
    RAISE EXCEPTION 'author should see their own name';
  END IF;

  -- Own draft can be deleted.
  INSERT INTO public.evangelism_testimonies
    (id, title, body, occurred_on, location_label, outcome)
  VALUES ('30000000-0000-0000-0000-000000000002',
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
  IF (SELECT count(*) FROM public.evangelism_uploads) <> 4 THEN
    RAISE EXCEPTION 'the upload ledger changed';
  END IF;
END $$;
SET ROLE authenticated;

-- ── publisher (b) ────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT set_config('test.perms', 'evangelism.publish', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.evangelism_testimonies) <> 6 THEN
    RAISE EXCEPTION 'publisher should see every story, withheld included';
  END IF;

  -- F1: cannot set consent on the author's no-consent draft and publish it.
  BEGIN
    UPDATE public.evangelism_testimonies SET consent_to_share = true, status = 'published'
     WHERE id = '10000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'publisher set consent and published someone else''s draft';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.evangelism_testimonies SET consent_to_share = true
     WHERE id = '10000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'publisher set consent on someone else''s story';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Cannot rewrite someone else's content (even a published story).
  BEGIN
    UPDATE public.evangelism_testimonies SET title = 'Publisher rewrite'
     WHERE id = '10000000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'publisher edited someone else''s title';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.evangelism_testimonies SET people_reached = 99
     WHERE id = '10000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'publisher edited someone else''s numbers';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Cannot publish a draft, even one that already has consent…
  BEGIN
    UPDATE public.evangelism_testimonies SET status = 'published'
     WHERE id = '10000000-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'publisher published a never-submitted draft';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- …nor push it to submitted first.
  BEGIN
    UPDATE public.evangelism_testimonies SET status = 'submitted'
     WHERE id = '10000000-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'publisher submitted someone else''s draft';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Hidden columns stay hidden even for a publisher (use the RPC).
  BEGIN
    PERFORM author_user_id FROM public.evangelism_testimonies;
    RAISE EXCEPTION 'publisher selected author_user_id directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Publish c's submitted story; the guard stamps it, ignoring a forged stamp.
  UPDATE public.evangelism_testimonies
     SET status = 'published',
         published_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         published_at = '2000-01-01'
   WHERE id = '30000000-0000-0000-0000-000000000001';
  IF (SELECT published_by FROM public.evangelism_attribution(ARRAY['30000000-0000-0000-0000-000000000001'::uuid]))
     <> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' THEN
    RAISE EXCEPTION 'published_by was not stamped as the publisher';
  END IF;
  IF (SELECT published_at FROM public.evangelism_testimonies
       WHERE id = '30000000-0000-0000-0000-000000000001') < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'published_at was backdated';
  END IF;

  -- Withhold d's submitted story with a reason.
  UPDATE public.evangelism_testimonies SET status = 'withheld', withheld_reason = 'Needs a name removed'
   WHERE id = '10000000-0000-0000-0000-000000000002';
  IF (SELECT withheld_reason FROM public.evangelism_attribution(ARRAY['10000000-0000-0000-0000-000000000002'::uuid]))
     <> 'Needs a name removed' THEN
    RAISE EXCEPTION 'withhold did not keep the reason';
  END IF;

  -- Attribution: publisher sees names (never an email).
  IF (SELECT author_name FROM public.evangelism_attribution(ARRAY['10000000-0000-0000-0000-000000000002'::uuid]))
     <> 'Staff member' THEN
    RAISE EXCEPTION 'a nameless author should show as Staff member, not an email';
  END IF;
  IF EXISTS (SELECT 1 FROM public.evangelism_attribution(ARRAY(SELECT id FROM public.evangelism_testimonies)) a
              WHERE a.author_name LIKE '%@%') THEN
    RAISE EXCEPTION 'attribution leaked an email';
  END IF;

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

-- ── second submitter (d) — sees own withheld story with its reason ─
SELECT set_config('request.jwt.claim.sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', false);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.evangelism_testimonies
                  WHERE id = '10000000-0000-0000-0000-000000000002' AND status = 'withheld') THEN
    RAISE EXCEPTION 'author cannot see their own withheld story';
  END IF;
  IF (SELECT withheld_reason FROM public.evangelism_attribution(ARRAY['10000000-0000-0000-0000-000000000002'::uuid]))
     IS DISTINCT FROM 'Needs a name removed' THEN
    RAISE EXCEPTION 'author cannot see why their story was withheld';
  END IF;
  -- d: own draft, own consented draft, own withheld, d's published, c's published.
  IF (SELECT count(*) FROM public.evangelism_testimonies) <> 5 THEN
    RAISE EXCEPTION 'second submitter saw the wrong set of stories';
  END IF;
  IF (SELECT count(*) FROM public.evangelism_my_testimony_ids()) <> 4 THEN
    RAISE EXCEPTION 'second submitter''s own ids are wrong';
  END IF;
  -- Cannot edit it once withheld.
  UPDATE public.evangelism_testimonies SET title = 'Sneaky edit'
   WHERE id = '10000000-0000-0000-0000-000000000002';
END $$;

-- ── a viewer still never sees a withheld story ─────────────
SELECT set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', false);
SELECT set_config('test.perms', 'evangelism.view', false);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.evangelism_testimonies WHERE status = 'withheld') THEN
    RAISE EXCEPTION 'viewer saw a withheld story';
  END IF;
END $$;

-- ── admin (no key) ───────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('test.perms', '', false);
SELECT set_config('test.admin', 'true', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.evangelism_testimonies) <> 5 THEN
    RAISE EXCEPTION 'admin should see every remaining story';
  END IF;
  INSERT INTO public.evangelism_testimonies
    (id, title, body, occurred_on, location_label, outcome, consent_to_share, status)
  VALUES ('50000000-0000-0000-0000-000000000001',
          'Admin story', repeat('a', 50), '2026-11-03', 'Joburg', 'decision', true, 'submitted');
  UPDATE public.evangelism_testimonies SET status = 'published'
   WHERE id = '50000000-0000-0000-0000-000000000001';
  IF (SELECT published_by FROM public.evangelism_attribution(ARRAY['50000000-0000-0000-0000-000000000001'::uuid]))
     <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' THEN
    RAISE EXCEPTION 'admin publish was not stamped';
  END IF;
END $$;

RESET ROLE;
DO $$
BEGIN
  IF (SELECT title FROM public.evangelism_testimonies WHERE id = '10000000-0000-0000-0000-000000000002')
     <> 'D submitted' THEN
    RAISE EXCEPTION 'author edited a withheld story';
  END IF;
  IF (SELECT consent_to_share FROM public.evangelism_testimonies WHERE id = '10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'a publisher changed the author''s consent';
  END IF;
END $$;

\echo 'evangelism testimonies RLS checks passed'
