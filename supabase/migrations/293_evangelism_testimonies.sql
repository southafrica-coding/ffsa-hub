-- ============================================================
-- FFSA Hub — Migration 293: evangelism testimonies
-- ============================================================
-- DO NOT APPLY to production until Hub Data and Jack approve.
-- This is the numbered migration that draft PR #499 deliberately
-- did not add. It complements that API. It does not change routes,
-- the evangelism page, or the Slack bot.
--
-- Access is the same shape as src/lib/auth/check-evangelism-access.ts
-- (publish includes submit, submit includes view; super_admin and
-- admin pass through is_admin() without these keys). has_permission()
-- does not imply a lower key, so every policy ORs the higher keys
-- itself. Nothing here reads auth.jwt() user_metadata.
--
--   evangelism.view      SELECT published rows only
--   evangelism.submit    SELECT published rows, plus SELECT/INSERT/
--                        UPDATE of the caller's own draft and submitted
--                        rows. DELETE of the caller's own drafts only.
--                        Cannot set status to published or withheld.
--                        Cannot set published_at or published_by.
--   evangelism.publish   SELECT and UPDATE every row, including
--                        withheld. DELETE any row. May publish.
--
-- Withheld rows are invisible to everyone except publishers and
-- admins, including the author. That is tighter than the [id] route's
-- visible() helper, which would return an author's own withheld row
-- once they have view. RLS makes that GET a not-found.
--
-- author_user_id is set on insert (must be auth.uid() for a user JWT)
-- and is not in the authenticated UPDATE grant. A BEFORE trigger
-- rejects any later change while auth.uid() is set, so a publisher
-- using the user JWT cannot reassign a story either. Service role
-- (auth.uid() null) is the maintenance path.
--
-- Media rows follow the parent testimony's visibility and the object
-- must live at testimonies/{author_user_id}/{uuid}.{ext}. That is the
-- path POST /api/evangelism/media/sign mints. It is not "any
-- authenticated user".
--
-- Storage: private bucket evangelism-media. No storage.objects
-- policies. The API signs uploads and reads with the service role.
-- A bucket has one file_size_limit. 250 MB is the tightest cap that
-- still lets a video through. Photos are capped at 15 MB by
-- evangelism_media's CHECK, which the bucket limit cannot express.
-- The sign route also refuses an oversized photo before it mints a
-- URL. A photo object larger than 15 MB can still land in the bucket
-- if something bypasses that route; the CHECK then rejects the row.
--
-- Idempotent for the permission rows, functions, policies, grants,
-- and the bucket flags. CREATE TABLE is IF NOT EXISTS, so a second
-- run will not add columns to a table that already exists.
--
-- ROLLBACK (nothing else references these objects):
--   DROP TABLE IF EXISTS public.evangelism_media;
--   DROP TABLE IF EXISTS public.evangelism_testimonies;
--   DROP FUNCTION IF EXISTS public.evangelism_testimonies_guard();
--   DROP FUNCTION IF EXISTS public.evangelism_media_path_guard();
--   DROP FUNCTION IF EXISTS public.evangelism_media_path_matches(text, uuid);
--   DELETE FROM storage.buckets WHERE id = 'evangelism-media';
--   DELETE FROM public.permissions
--    WHERE key IN ('evangelism.view', 'evangelism.submit', 'evangelism.publish');
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Permission keys (not grants to people — admins already pass)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('evangelism', 'evangelism.view',    'View published testimonies and base stats', 10),
  ('evangelism', 'evangelism.submit',  'Upload and submit testimonies',            20),
  ('evangelism', 'evangelism.publish', 'Publish or withhold testimonies',          30)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. Testimonies
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evangelism_testimonies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id    uuid NOT NULL REFERENCES public.users (id),
  title             text NOT NULL,
  body              text NOT NULL,
  occurred_on       date NOT NULL,
  location_label    text NOT NULL,
  people_reached    integer NOT NULL DEFAULT 0,
  decisions         integer NOT NULL DEFAULT 0,
  outcome           text NOT NULL,
  consent_to_share  boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'draft',
  published_at      timestamptz,
  published_by      uuid REFERENCES public.users (id),
  withheld_reason   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evangelism_testimonies_title_len
    CHECK (char_length(btrim(title)) BETWEEN 3 AND 140),
  CONSTRAINT evangelism_testimonies_body_len
    CHECK (char_length(btrim(body)) BETWEEN 40 AND 20000),
  CONSTRAINT evangelism_testimonies_location_len
    CHECK (char_length(btrim(location_label)) BETWEEN 2 AND 80),
  CONSTRAINT evangelism_testimonies_people_reached_range
    CHECK (people_reached >= 0 AND people_reached <= 100000),
  CONSTRAINT evangelism_testimonies_decisions_range
    CHECK (decisions >= 0 AND decisions <= people_reached),
  CONSTRAINT evangelism_testimonies_outcome
    CHECK (outcome IN ('conversation', 'prayer', 'decision', 'follow_up', 'other')),
  CONSTRAINT evangelism_testimonies_status
    CHECK (status IN ('draft', 'submitted', 'published', 'withheld')),
  CONSTRAINT evangelism_testimonies_withheld_reason_len
    CHECK (withheld_reason IS NULL OR char_length(withheld_reason) <= 500),
  -- The API also rejects a future occurred_on in Africa/Johannesburg.
  -- A CHECK cannot see "today" without breaking dumps and replays.
  CONSTRAINT evangelism_testimonies_consent_to_share
    CHECK (status NOT IN ('submitted', 'published') OR consent_to_share)
);

CREATE INDEX IF NOT EXISTS evangelism_testimonies_status_updated
  ON public.evangelism_testimonies (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS evangelism_testimonies_published
  ON public.evangelism_testimonies (published_at)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS evangelism_testimonies_occurred
  ON public.evangelism_testimonies (occurred_on)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS evangelism_testimonies_author_status
  ON public.evangelism_testimonies (author_user_id, status);

DROP TRIGGER IF EXISTS set_updated_at ON public.evangelism_testimonies;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.evangelism_testimonies
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. Guard: user JWTs cannot reassign the author, and a submitter
--    cannot publish, withhold, or stamp published_*.
-- ────────────────────────────────────────────────────────────
-- RLS WITH CHECK expressions on permissive policies are OR-ed, and
-- WITH CHECK cannot see the pre-image. This trigger sees OLD and
-- runs even when the table owner bypasses RLS. Service role has no
-- auth.uid() and is left alone for maintenance.
CREATE OR REPLACE FUNCTION public.evangelism_testimonies_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.author_user_id IS DISTINCT FROM OLD.author_user_id THEN
    RAISE EXCEPTION 'author_user_id cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF public.is_admin() OR public.has_permission('evangelism.publish') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('published', 'withheld') THEN
    RAISE EXCEPTION 'Only a publisher can publish or withhold a testimony'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.published_at IS NOT NULL OR NEW.published_by IS NOT NULL THEN
      RAISE EXCEPTION 'Only a publisher can set published_at or published_by'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.published_by IS DISTINCT FROM OLD.published_by THEN
    RAISE EXCEPTION 'Only a publisher can set published_at or published_by'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evangelism_testimonies_guard ON public.evangelism_testimonies;
CREATE TRIGGER evangelism_testimonies_guard
  BEFORE INSERT OR UPDATE ON public.evangelism_testimonies
  FOR EACH ROW EXECUTE FUNCTION public.evangelism_testimonies_guard();

-- True when new_author is still the stored author. Non-publishers only
-- get a hit on their own row, so they cannot probe someone else's id.
-- Publishers already SELECT every author. The function reads the
-- pre-update row (the statement snapshot), which is what WITH CHECK
-- cannot see by itself. The trigger above also rejects the change for
-- any user JWT, including when the table owner bypasses RLS.
CREATE OR REPLACE FUNCTION public.evangelism_author_unchanged(
  row_id uuid,
  new_author uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.evangelism_testimonies t
    WHERE t.id = row_id
      AND t.author_user_id IS NOT DISTINCT FROM new_author
      AND (
        t.author_user_id = auth.uid()
        OR public.is_admin()
        OR public.has_permission('evangelism.publish')
      )
  );
$$;

REVOKE ALL ON FUNCTION public.evangelism_testimonies_guard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evangelism_author_unchanged(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evangelism_testimonies_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.evangelism_author_unchanged(uuid, uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 4. Testimony RLS
-- ────────────────────────────────────────────────────────────
-- Submitter and publisher policies are disjoint (the submitter
-- policy requires NOT publish and NOT admin) so a publisher's
-- WITH CHECK cannot be satisfied by the submitter predicate, and
-- a submitter's WITH CHECK cannot be satisfied by the publisher
-- predicate. Permissive policies OR their checks; overlap here
-- would let a submitter through a publisher check or the reverse.
ALTER TABLE public.evangelism_testimonies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evangelism_testimonies_select_published" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_select_published"
  ON public.evangelism_testimonies
  FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND (
      public.is_admin()
      OR public.has_permission('evangelism.view')
      OR public.has_permission('evangelism.submit')
      OR public.has_permission('evangelism.publish')
    )
  );

DROP POLICY IF EXISTS "evangelism_testimonies_select_own_open" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_select_own_open"
  ON public.evangelism_testimonies
  FOR SELECT TO authenticated
  USING (
    author_user_id = auth.uid()
    AND status IN ('draft', 'submitted')
    AND (
      public.is_admin()
      OR public.has_permission('evangelism.submit')
      OR public.has_permission('evangelism.publish')
    )
  );

DROP POLICY IF EXISTS "evangelism_testimonies_select_publisher" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_select_publisher"
  ON public.evangelism_testimonies
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.has_permission('evangelism.publish'));

DROP POLICY IF EXISTS "evangelism_testimonies_insert_submitter" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_insert_submitter"
  ON public.evangelism_testimonies
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND status IN ('draft', 'submitted')
    AND published_at IS NULL
    AND published_by IS NULL
    AND public.has_permission('evangelism.submit')
    AND NOT public.is_admin()
    AND NOT public.has_permission('evangelism.publish')
  );

DROP POLICY IF EXISTS "evangelism_testimonies_insert_publisher" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_insert_publisher"
  ON public.evangelism_testimonies
  FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND (public.is_admin() OR public.has_permission('evangelism.publish'))
  );

DROP POLICY IF EXISTS "evangelism_testimonies_update_submitter" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_update_submitter"
  ON public.evangelism_testimonies
  FOR UPDATE TO authenticated
  USING (
    author_user_id = auth.uid()
    AND status IN ('draft', 'submitted')
    AND public.has_permission('evangelism.submit')
    AND NOT public.is_admin()
    AND NOT public.has_permission('evangelism.publish')
  )
  WITH CHECK (
    author_user_id = auth.uid()
    AND status IN ('draft', 'submitted')
    AND published_at IS NULL
    AND published_by IS NULL
    AND public.has_permission('evangelism.submit')
    AND NOT public.is_admin()
    AND NOT public.has_permission('evangelism.publish')
    AND public.evangelism_author_unchanged(id, author_user_id)
  );

DROP POLICY IF EXISTS "evangelism_testimonies_update_publisher" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_update_publisher"
  ON public.evangelism_testimonies
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.has_permission('evangelism.publish'))
  WITH CHECK (
    (public.is_admin() OR public.has_permission('evangelism.publish'))
    AND public.evangelism_author_unchanged(id, author_user_id)
  );

DROP POLICY IF EXISTS "evangelism_testimonies_delete_own_draft" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_delete_own_draft"
  ON public.evangelism_testimonies
  FOR DELETE TO authenticated
  USING (
    author_user_id = auth.uid()
    AND status = 'draft'
    AND public.has_permission('evangelism.submit')
    AND NOT public.is_admin()
    AND NOT public.has_permission('evangelism.publish')
  );

DROP POLICY IF EXISTS "evangelism_testimonies_delete_publisher" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_delete_publisher"
  ON public.evangelism_testimonies
  FOR DELETE TO authenticated
  USING (public.is_admin() OR public.has_permission('evangelism.publish'));

-- author_user_id, id, and created_at are omitted on purpose. Table-level
-- UPDATE would ignore a later column revoke, so this list is the grant.
REVOKE ALL ON TABLE public.evangelism_testimonies FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.evangelism_testimonies TO authenticated;
GRANT UPDATE (
  title,
  body,
  occurred_on,
  location_label,
  people_reached,
  decisions,
  outcome,
  consent_to_share,
  status,
  published_at,
  published_by,
  withheld_reason
) ON TABLE public.evangelism_testimonies TO authenticated;
GRANT ALL ON TABLE public.evangelism_testimonies TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. Media rows
-- ────────────────────────────────────────────────────────────
-- 15 MB and 250 MB, in bytes, matching the API constants.
-- Photos cannot use the bucket cap: that single number has to be
-- the video size or videos never upload.
CREATE TABLE IF NOT EXISTS public.evangelism_media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  testimony_id   uuid NOT NULL REFERENCES public.evangelism_testimonies (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('photo', 'video')),
  storage_path   text NOT NULL,
  content_type   text NOT NULL,
  size_bytes     integer NOT NULL CHECK (size_bytes >= 0),
  sort_order     integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_by     uuid REFERENCES public.users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evangelism_media_storage_path_shape CHECK (
    storage_path ~* '^testimonies/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif|mp4|mov|webm)$'
  ),
  CONSTRAINT evangelism_media_size_by_kind CHECK (
    (
      kind = 'photo'
      AND size_bytes <= 15728640
      AND content_type IN (
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
      )
    )
    OR (
      kind = 'video'
      AND size_bytes <= 262144000
      AND content_type IN ('video/mp4', 'video/quicktime', 'video/webm')
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS evangelism_media_storage_path
  ON public.evangelism_media (storage_path);
CREATE INDEX IF NOT EXISTS evangelism_media_testimony
  ON public.evangelism_media (testimony_id, sort_order);

-- Path prefix that belongs to the testimony: the sign route puts the
-- author's id, not the testimony id, in the first folder.
CREATE OR REPLACE FUNCTION public.evangelism_media_path_matches(
  object_path text,
  author uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT object_path ~* (
    '^testimonies/'
    || author::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif|mp4|mov|webm)$'
  );
$$;

CREATE OR REPLACE FUNCTION public.evangelism_media_path_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  author uuid;
BEGIN
  SELECT t.author_user_id INTO author
  FROM public.evangelism_testimonies t
  WHERE t.id = NEW.testimony_id;

  IF author IS NULL THEN
    RAISE EXCEPTION 'evangelism_media requires a testimony'
      USING ERRCODE = '23503';
  END IF;

  IF NOT public.evangelism_media_path_matches(NEW.storage_path, author) THEN
    RAISE EXCEPTION 'storage_path must be testimonies/{author_user_id}/{file} for this testimony'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evangelism_media_path_guard ON public.evangelism_media;
CREATE TRIGGER evangelism_media_path_guard
  BEFORE INSERT OR UPDATE ON public.evangelism_media
  FOR EACH ROW EXECUTE FUNCTION public.evangelism_media_path_guard();

REVOKE ALL ON FUNCTION public.evangelism_media_path_matches(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evangelism_media_path_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evangelism_media_path_matches(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evangelism_media_path_guard() TO authenticated;

ALTER TABLE public.evangelism_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evangelism_media_select" ON public.evangelism_media;
CREATE POLICY "evangelism_media_select"
  ON public.evangelism_media
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.evangelism_testimonies t
      WHERE t.id = evangelism_media.testimony_id
        AND public.evangelism_media_path_matches(evangelism_media.storage_path, t.author_user_id)
        AND (
          (
            t.status = 'published'
            AND (
              public.is_admin()
              OR public.has_permission('evangelism.view')
              OR public.has_permission('evangelism.submit')
              OR public.has_permission('evangelism.publish')
            )
          )
          OR (
            t.author_user_id = auth.uid()
            AND t.status IN ('draft', 'submitted')
            AND (
              public.is_admin()
              OR public.has_permission('evangelism.submit')
              OR public.has_permission('evangelism.publish')
            )
          )
          OR public.is_admin()
          OR public.has_permission('evangelism.publish')
        )
    )
  );

DROP POLICY IF EXISTS "evangelism_media_insert_submitter" ON public.evangelism_media;
CREATE POLICY "evangelism_media_insert_submitter"
  ON public.evangelism_media
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.has_permission('evangelism.submit')
    AND NOT public.is_admin()
    AND NOT public.has_permission('evangelism.publish')
    AND EXISTS (
      SELECT 1
      FROM public.evangelism_testimonies t
      WHERE t.id = testimony_id
        AND t.author_user_id = auth.uid()
        AND t.status IN ('draft', 'submitted')
        AND public.evangelism_media_path_matches(storage_path, t.author_user_id)
    )
  );

DROP POLICY IF EXISTS "evangelism_media_insert_publisher" ON public.evangelism_media;
CREATE POLICY "evangelism_media_insert_publisher"
  ON public.evangelism_media
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (public.is_admin() OR public.has_permission('evangelism.publish'))
    AND EXISTS (
      SELECT 1
        FROM public.evangelism_testimonies t
        WHERE t.id = testimony_id
          AND t.author_user_id = auth.uid()
          AND public.evangelism_media_path_matches(storage_path, t.author_user_id)
    )
  );

DROP POLICY IF EXISTS "evangelism_media_delete_own_draft" ON public.evangelism_media;
CREATE POLICY "evangelism_media_delete_own_draft"
  ON public.evangelism_media
  FOR DELETE TO authenticated
  USING (
    public.has_permission('evangelism.submit')
    AND NOT public.is_admin()
    AND NOT public.has_permission('evangelism.publish')
    AND EXISTS (
      SELECT 1
      FROM public.evangelism_testimonies t
      WHERE t.id = testimony_id
        AND t.author_user_id = auth.uid()
        AND t.status = 'draft'
        AND public.evangelism_media_path_matches(storage_path, t.author_user_id)
    )
  );

DROP POLICY IF EXISTS "evangelism_media_delete_publisher" ON public.evangelism_media;
CREATE POLICY "evangelism_media_delete_publisher"
  ON public.evangelism_media
  FOR DELETE TO authenticated
  USING (
    (public.is_admin() OR public.has_permission('evangelism.publish'))
    AND EXISTS (
      SELECT 1
      FROM public.evangelism_testimonies t
      WHERE t.id = testimony_id
        AND public.evangelism_media_path_matches(storage_path, t.author_user_id)
    )
  );

-- No UPDATE policy and no UPDATE grant: file rows are inserted once.
-- Replacing a file is a new row. Deleting the testimony cascades.
REVOKE ALL ON TABLE public.evangelism_media FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.evangelism_media TO authenticated;
GRANT ALL ON TABLE public.evangelism_media TO service_role;

-- ────────────────────────────────────────────────────────────
-- 6. Private bucket. No storage.objects policies.
-- ────────────────────────────────────────────────────────────
-- file_size_limit is 250 MB (262144000), the video maximum. It is
-- not 15 MB: that would reject every video at upload time. Photo
-- rows are limited to 15 MB (15728640) by evangelism_media_size_by_kind
-- because a bucket cannot store two caps. allowed_mime_types is the
-- IANA list the sign route accepts. image/jpg is a table alias only;
-- browsers send image/jpeg.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evangelism-media',
  'evangelism-media',
  false,
  262144000,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- Verify after apply (SQL editor). Do not expect rows yet.
--   SELECT key FROM public.permissions
--    WHERE key LIKE 'evangelism.%' ORDER BY sort_order;
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.evangelism_testimonies'::regclass;
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename IN ('evangelism_testimonies', 'evangelism_media')
--    ORDER BY tablename, cmd, policyname;
--   SELECT id, public, file_size_limit, allowed_mime_types
--     FROM storage.buckets WHERE id = 'evangelism-media';
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND (coalesce(qual, '') ILIKE '%evangelism-media%'
--        OR coalesce(with_check, '') ILIKE '%evangelism-media%');
--   -- the count must stay 0: this migration adds no storage policy.
-- ============================================================
