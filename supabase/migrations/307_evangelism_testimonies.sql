-- ============================================================
-- FFSA Hub — Migration 307: evangelism testimonies (slice 1)
-- ============================================================
-- DO NOT APPLY until Jack says so.
--
-- Slice 1 only: staff submit a story (text + one optional photo +
-- consent), publishers approve or withhold it, and people with view
-- access read the published list. No TV feed, no stats, no video and
-- no removals tombstones. Those belong to the larger dormant drafts
-- #508 / #499 / #510, which this file does not touch.
--
-- Access is the same shape as src/lib/auth/check-evangelism-access.ts:
-- publish includes submit, and submit includes view. super_admin and
-- admin pass through is_admin() without holding any key.
-- has_permission() does NOT imply a lower key, so every policy ORs
-- the higher keys itself.
--
--   evangelism.view     read published stories
--   evangelism.submit   + read/insert/edit own draft and submitted
--                         stories; delete own drafts
--   evangelism.publish  + read every story (withheld too); publish,
--                         withhold, delete any
--
-- A withheld story is hidden from its author as well: only
-- publishers and admins see it.
--
-- The keys are seeded only. This file grants them to no role and no
-- user.
--
-- Photos live in the PRIVATE bucket evangelism-media. There are no
-- storage.objects policies: the API signs uploads and reads with the
-- service role, and only for rows the caller can already SELECT here.
--
-- ROLLBACK (nothing else references these objects):
--   DROP TABLE IF EXISTS public.evangelism_media;
--   DROP TABLE IF EXISTS public.evangelism_testimonies;
--   DROP FUNCTION IF EXISTS public.evangelism_testimonies_guard();
--   DROP FUNCTION IF EXISTS public.can_publish_evangelism();
--   DROP FUNCTION IF EXISTS public.can_submit_evangelism();
--   DELETE FROM storage.buckets WHERE id = 'evangelism-media';
--   DELETE FROM public.permissions
--    WHERE key IN ('evangelism.view', 'evangelism.submit', 'evangelism.publish');
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Permission keys (seeded, not assigned)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('evangelism', 'evangelism.view',    'View published testimonies',      10),
  ('evangelism', 'evangelism.submit',  'Upload and submit testimonies',   20),
  ('evangelism', 'evangelism.publish', 'Publish or withhold testimonies', 30)
ON CONFLICT (key) DO NOTHING;

-- Two shorthands so every policy spells the hierarchy the same way.
CREATE OR REPLACE FUNCTION public.can_publish_evangelism()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.is_admin() OR public.has_permission('evangelism.publish');
$$;

CREATE OR REPLACE FUNCTION public.can_submit_evangelism()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.can_publish_evangelism() OR public.has_permission('evangelism.submit');
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Testimonies
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evangelism_testimonies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_user_id     uuid NOT NULL REFERENCES public.users (id),
  title              text NOT NULL,
  body               text NOT NULL,
  occurred_on        date NOT NULL,
  location_label     text NOT NULL,
  -- Optional tag: which ministry the story came from. The live org
  -- model (Ministries / OKRs), NOT finance outreach_teams.
  staff_ministry_id  uuid REFERENCES public.staff_ministries (id) ON DELETE SET NULL,
  people_reached     integer NOT NULL DEFAULT 0,
  decisions          integer NOT NULL DEFAULT 0,
  outcome            text NOT NULL,
  -- Submitter confirms the people in the story (and the story as told)
  -- may be shown INSIDE the Hub to staff with view access. Not a public
  -- website flag.
  consent_to_share   boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'draft',
  published_at       timestamptz,
  published_by       uuid REFERENCES public.users (id),
  withheld_reason    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evangelism_testimonies_title_len
    CHECK (char_length(btrim(title)) BETWEEN 3 AND 140),
  CONSTRAINT evangelism_testimonies_body_len
    CHECK (char_length(btrim(body)) BETWEEN 40 AND 20000),
  CONSTRAINT evangelism_testimonies_location_len
    CHECK (char_length(btrim(location_label)) BETWEEN 2 AND 80),
  CONSTRAINT evangelism_testimonies_people_reached_range
    CHECK (people_reached >= 0),
  CONSTRAINT evangelism_testimonies_decisions_range
    CHECK (decisions >= 0 AND decisions <= people_reached),
  CONSTRAINT evangelism_testimonies_outcome
    CHECK (outcome IN ('conversation', 'prayer', 'decision', 'follow_up', 'other')),
  CONSTRAINT evangelism_testimonies_status
    CHECK (status IN ('draft', 'submitted', 'published', 'withheld')),
  CONSTRAINT evangelism_testimonies_withheld_reason_len
    CHECK (withheld_reason IS NULL OR char_length(withheld_reason) <= 500),
  CONSTRAINT evangelism_testimonies_consent_to_share
    CHECK (status NOT IN ('submitted', 'published') OR consent_to_share),
  CONSTRAINT evangelism_testimonies_published_stamp
    CHECK (status <> 'published' OR (published_at IS NOT NULL AND published_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS evangelism_testimonies_status_updated
  ON public.evangelism_testimonies (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS evangelism_testimonies_published
  ON public.evangelism_testimonies (published_at DESC)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS evangelism_testimonies_author_status
  ON public.evangelism_testimonies (author_user_id, status);

DROP TRIGGER IF EXISTS set_updated_at ON public.evangelism_testimonies;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.evangelism_testimonies
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. Guard trigger (user JWTs only)
-- ────────────────────────────────────────────────────────────
-- RLS WITH CHECK cannot see OLD, and permissive policies OR together,
-- so the review rules live here as well:
--   * author_user_id never changes;
--   * only a publisher may move a story to published/withheld or touch
--     published_at / published_by / withheld_reason;
--   * publishing stamps published_at = now() and published_by = the
--     caller — a client cannot backdate it or credit someone else.
-- Service role (auth.uid() IS NULL) is the maintenance path and is
-- left alone; the table CHECKs still apply to it.
CREATE OR REPLACE FUNCTION public.evangelism_testimonies_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  old_status text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.author_user_id IS DISTINCT FROM OLD.author_user_id THEN
    RAISE EXCEPTION 'author_user_id cannot be changed' USING ERRCODE = '42501';
  END IF;

  IF public.can_publish_evangelism() THEN
    IF NEW.status = 'published' AND old_status IS DISTINCT FROM 'published' THEN
      NEW.published_at := now();
      NEW.published_by := auth.uid();
      NEW.withheld_reason := NULL;
    ELSIF NEW.status = 'published' THEN
      -- Already published: keep the original stamp.
      NEW.published_at := OLD.published_at;
      NEW.published_by := OLD.published_by;
    ELSE
      NEW.published_at := NULL;
      NEW.published_by := NULL;
      IF NEW.status <> 'withheld' THEN
        NEW.withheld_reason := NULL;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('published', 'withheld') THEN
    RAISE EXCEPTION 'Only a publisher can publish or withhold a testimony'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.published_at IS NOT NULL
     OR NEW.published_by IS NOT NULL
     OR NEW.withheld_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Only a publisher can set published or withheld fields'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evangelism_testimonies_guard ON public.evangelism_testimonies;
CREATE TRIGGER evangelism_testimonies_guard
  BEFORE INSERT OR UPDATE ON public.evangelism_testimonies
  FOR EACH ROW EXECUTE FUNCTION public.evangelism_testimonies_guard();

-- ────────────────────────────────────────────────────────────
-- 4. Testimony RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.evangelism_testimonies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evangelism_testimonies_select_published" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_select_published"
  ON public.evangelism_testimonies FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND (public.can_submit_evangelism() OR public.has_permission('evangelism.view'))
  );

DROP POLICY IF EXISTS "evangelism_testimonies_select_own_open" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_select_own_open"
  ON public.evangelism_testimonies FOR SELECT TO authenticated
  USING (
    author_user_id = auth.uid()
    AND status IN ('draft', 'submitted')
    AND public.can_submit_evangelism()
  );

DROP POLICY IF EXISTS "evangelism_testimonies_select_publisher" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_select_publisher"
  ON public.evangelism_testimonies FOR SELECT TO authenticated
  USING (public.can_publish_evangelism());

-- Everyone (publishers too) creates a story as draft or submitted.
-- Publishing is a separate UPDATE so the guard can stamp it.
DROP POLICY IF EXISTS "evangelism_testimonies_insert" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_insert"
  ON public.evangelism_testimonies FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND status IN ('draft', 'submitted')
    AND published_at IS NULL
    AND published_by IS NULL
    AND withheld_reason IS NULL
    AND public.can_submit_evangelism()
  );

DROP POLICY IF EXISTS "evangelism_testimonies_update_own_open" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_update_own_open"
  ON public.evangelism_testimonies FOR UPDATE TO authenticated
  USING (
    author_user_id = auth.uid()
    AND status IN ('draft', 'submitted')
    AND public.can_submit_evangelism()
  )
  WITH CHECK (
    author_user_id = auth.uid()
    AND status IN ('draft', 'submitted')
    AND published_at IS NULL
    AND published_by IS NULL
    AND withheld_reason IS NULL
    AND public.can_submit_evangelism()
  );

DROP POLICY IF EXISTS "evangelism_testimonies_update_publisher" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_update_publisher"
  ON public.evangelism_testimonies FOR UPDATE TO authenticated
  USING (public.can_publish_evangelism())
  WITH CHECK (public.can_publish_evangelism());

DROP POLICY IF EXISTS "evangelism_testimonies_delete_own_draft" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_delete_own_draft"
  ON public.evangelism_testimonies FOR DELETE TO authenticated
  USING (
    author_user_id = auth.uid()
    AND status = 'draft'
    AND public.can_submit_evangelism()
  );

DROP POLICY IF EXISTS "evangelism_testimonies_delete_publisher" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_delete_publisher"
  ON public.evangelism_testimonies FOR DELETE TO authenticated
  USING (public.can_publish_evangelism());

-- id, author_user_id, created_at and updated_at are left out of the
-- UPDATE grant on purpose. A table-level UPDATE grant would ignore a
-- later column revoke, so this column list IS the grant.
REVOKE ALL ON TABLE public.evangelism_testimonies FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.evangelism_testimonies TO authenticated;
GRANT UPDATE (
  title, body, occurred_on, location_label, staff_ministry_id,
  people_reached, decisions, outcome, consent_to_share,
  status, published_at, published_by, withheld_reason
) ON TABLE public.evangelism_testimonies TO authenticated;
GRANT ALL ON TABLE public.evangelism_testimonies TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. Media (photo only this slice)
-- ────────────────────────────────────────────────────────────
-- One photo per story is enforced by the API, not here, so a later
-- slice can allow more without a migration.
-- ON DELETE CASCADE removes the row only. The DELETE route removes the
-- storage object with the service role first; a direct SQL delete
-- leaves the file behind.
CREATE TABLE IF NOT EXISTS public.evangelism_media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  testimony_id   uuid NOT NULL REFERENCES public.evangelism_testimonies (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind = 'photo'),
  storage_path   text NOT NULL UNIQUE,
  content_type   text NOT NULL
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  size_bytes     integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  sort_order     integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_by     uuid REFERENCES public.users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evangelism_media_storage_path_shape CHECK (
    storage_path ~ '^testimonies/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif)$'
  )
);

CREATE INDEX IF NOT EXISTS evangelism_media_testimony
  ON public.evangelism_media (testimony_id, sort_order);

ALTER TABLE public.evangelism_media ENABLE ROW LEVEL SECURITY;

-- Follows the parent: the subquery runs under the caller's own
-- testimony policies, so a photo is visible exactly when its story is.
DROP POLICY IF EXISTS "evangelism_media_select" ON public.evangelism_media;
CREATE POLICY "evangelism_media_select"
  ON public.evangelism_media FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.evangelism_testimonies t
      WHERE t.id = evangelism_media.testimony_id
    )
  );

-- Only onto your own open story, and only at a path under your own id
-- (the path POST /api/evangelism/media/sign mints).
DROP POLICY IF EXISTS "evangelism_media_insert_own" ON public.evangelism_media;
CREATE POLICY "evangelism_media_insert_own"
  ON public.evangelism_media FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.can_submit_evangelism()
    AND storage_path LIKE 'testimonies/' || auth.uid()::text || '/%'
    AND EXISTS (
      SELECT 1 FROM public.evangelism_testimonies t
      WHERE t.id = evangelism_media.testimony_id
        AND t.author_user_id = auth.uid()
        AND t.status IN ('draft', 'submitted')
    )
  );

-- The author may drop the photo while the story is still open; a
-- publisher may drop any photo.
DROP POLICY IF EXISTS "evangelism_media_delete" ON public.evangelism_media;
CREATE POLICY "evangelism_media_delete"
  ON public.evangelism_media FOR DELETE TO authenticated
  USING (
    public.can_publish_evangelism()
    OR (
      public.can_submit_evangelism()
      AND EXISTS (
        SELECT 1 FROM public.evangelism_testimonies t
        WHERE t.id = evangelism_media.testimony_id
          AND t.author_user_id = auth.uid()
          AND t.status IN ('draft', 'submitted')
      )
    )
  );

-- No UPDATE: replace a photo by deleting and re-adding it.
REVOKE ALL ON TABLE public.evangelism_media FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.evangelism_media TO authenticated;
GRANT ALL ON TABLE public.evangelism_media TO service_role;

REVOKE ALL ON FUNCTION public.can_publish_evangelism() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_submit_evangelism() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evangelism_testimonies_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_publish_evangelism() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_submit_evangelism() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evangelism_testimonies_guard() TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 6. Private storage bucket (photo only — 15 MB)
-- ────────────────────────────────────────────────────────────
-- No storage.objects policies on purpose: uploads and reads are
-- signed by the API with the service role.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evangelism-media',
  'evangelism-media',
  false,
  15728640,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- Verify:
--   SELECT key FROM public.permissions WHERE module = 'evangelism';
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'evangelism-media';
--   SELECT policyname FROM pg_policies WHERE tablename LIKE 'evangelism_%';
-- ============================================================
