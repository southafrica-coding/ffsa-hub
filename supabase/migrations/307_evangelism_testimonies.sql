-- ============================================================
-- FFSA Hub — Migration 307: evangelism testimonies (slice 1)
-- ============================================================
-- DO NOT APPLY until Jack says so.
--
-- Slice 1 only: staff submit a story (text + one optional photo +
-- consent), publishers approve or withhold it, and people with view
-- access read the published list. No TV feed, no stats, no video and
-- no removals tombstones. Those belong to the larger dormant drafts
-- #508 / #499 / #510, which this file does not touch. #508 uses the
-- same table, key and bucket names — close or rename it before 307 is
-- applied, or whichever lands first silently wins the shape.
--
-- Access is the same shape as src/lib/auth/check-evangelism-access.ts:
-- publish includes submit, and submit includes view. super_admin and
-- admin pass through is_admin() without holding any key.
-- has_permission() does NOT imply a lower key, so every policy ORs
-- the higher keys itself.
--
--   evangelism.view     read published stories
--   evangelism.submit   + read/insert/edit own draft and submitted
--                         stories; read own withheld stories (with
--                         the reason); delete own drafts
--   evangelism.publish  + read every story; publish (only from
--                         submitted/withheld) or withhold; delete any.
--                         On someone else's story a publisher may change
--                         ONLY status and withheld_reason — never the
--                         content or the author's consent.
--
-- WHO WROTE IT is hidden in the database, not just the API:
-- authenticated has column-level SELECT that leaves out author_user_id,
-- published_by, withheld_reason, and media created_by / storage_path.
-- evangelism_attribution() returns names and review fields only for
-- rows the caller may attribute (publishers, and the author). Upload
-- paths are testimonies/{random}/{random}.{ext} — no user id — and the
-- evangelism_uploads ledger records who minted each one.
--
-- The keys are seeded only. This file grants them to no role and no
-- user.
--
-- Photos live in the PRIVATE bucket evangelism-media. There are no
-- storage.objects policies: the API signs uploads and reads with the
-- service role, and only for rows the caller can already SELECT here.
--
-- Supabase's default privileges give anon/authenticated ALL on new
-- tables and EXECUTE on new functions, so every object below starts
-- with an explicit REVOKE.
--
-- ROLLBACK (nothing else references these objects):
--   DROP TABLE IF EXISTS public.evangelism_media;
--   DROP TABLE IF EXISTS public.evangelism_uploads;
--   DROP TABLE IF EXISTS public.evangelism_testimonies;
--   DROP FUNCTION IF EXISTS public.evangelism_testimonies_guard();
--   DROP FUNCTION IF EXISTS public.evangelism_attribution(uuid[]);
--   DROP FUNCTION IF EXISTS public.evangelism_my_testimony_ids();
--   DROP FUNCTION IF EXISTS public.evangelism_is_my_open_story(uuid);
--   DROP FUNCTION IF EXISTS public.evangelism_upload_is_mine(text);
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
  author_user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users (id),
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
  -- The AUTHOR confirms the people in the story (and the story as told)
  -- may be shown INSIDE the Hub to staff with view access. Not a public
  -- website flag. Only the author can set it (guard trigger).
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

-- Re-run safe: also sets the default on a table created by an earlier run.
ALTER TABLE public.evangelism_testimonies ALTER COLUMN author_user_id SET DEFAULT auth.uid();

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
-- so the review rules live here:
--   * author_user_id never changes;
--   * a publisher reviewing SOMEONE ELSE'S story may change only status
--     and withheld_reason. Content and consent belong to the author.
--     Status may only move to published/withheld, and only from
--     submitted, withheld or published — never straight from a draft;
--   * a story can be published only from submitted or withheld;
--   * publishing stamps published_at = now() and published_by = the
--     caller, so a client cannot backdate it or credit someone else;
--   * a non-publisher may never publish, withhold or set the stamps.
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
    IF TG_OP = 'UPDATE' AND OLD.author_user_id IS DISTINCT FROM auth.uid() THEN
      IF (NEW.title, NEW.body, NEW.occurred_on, NEW.location_label, NEW.staff_ministry_id,
          NEW.people_reached, NEW.decisions, NEW.outcome, NEW.consent_to_share)
         IS DISTINCT FROM
         (OLD.title, OLD.body, OLD.occurred_on, OLD.location_label, OLD.staff_ministry_id,
          OLD.people_reached, OLD.decisions, OLD.outcome, OLD.consent_to_share) THEN
        RAISE EXCEPTION 'Publishers cannot edit the content or consent of someone else''s story'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status
         AND (OLD.status NOT IN ('submitted', 'withheld', 'published')
              OR NEW.status NOT IN ('published', 'withheld')) THEN
        RAISE EXCEPTION 'A publisher can only publish or withhold a submitted story'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF NEW.status = 'published' AND old_status IS DISTINCT FROM 'published' THEN
      IF old_status IS NULL OR old_status NOT IN ('submitted', 'withheld') THEN
        RAISE EXCEPTION 'Only a submitted story can be published' USING ERRCODE = '42501';
      END IF;
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

-- The author sees their own open stories, and their own withheld ones
-- (so a withheld story doesn't just vanish — the reason comes from
-- evangelism_attribution()).
DROP POLICY IF EXISTS "evangelism_testimonies_select_own_open" ON public.evangelism_testimonies;
DROP POLICY IF EXISTS "evangelism_testimonies_select_own" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_select_own"
  ON public.evangelism_testimonies FOR SELECT TO authenticated
  USING (
    author_user_id = auth.uid()
    AND status IN ('draft', 'submitted', 'withheld')
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

-- What a publisher may change is narrowed by the guard trigger above.
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

-- REVOKE ALL also drops any column grants, so re-running is clean.
-- SELECT is column-level: author_user_id, published_by and
-- withheld_reason are NOT readable through PostgREST (use
-- evangelism_attribution()). UPDATE leaves out id, author_user_id,
-- created_at and updated_at. No TRUNCATE / REFERENCES / TRIGGER.
REVOKE ALL ON TABLE public.evangelism_testimonies FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, title, body, occurred_on, location_label, staff_ministry_id,
  people_reached, decisions, outcome, consent_to_share,
  status, published_at, created_at, updated_at
) ON TABLE public.evangelism_testimonies TO authenticated;
GRANT INSERT, DELETE ON TABLE public.evangelism_testimonies TO authenticated;
GRANT UPDATE (
  title, body, occurred_on, location_label, staff_ministry_id,
  people_reached, decisions, outcome, consent_to_share,
  status, published_at, published_by, withheld_reason
) ON TABLE public.evangelism_testimonies TO authenticated;
GRANT ALL ON TABLE public.evangelism_testimonies TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. Attribution and "mine" — definer RPCs over hidden columns
-- ────────────────────────────────────────────────────────────
-- Names and review fields for exactly the rows the caller can already
-- see (same predicate as the SELECT policies). Never an email: no name
-- falls back to 'Staff member'.
--   author_name / published_by: publishers, and the author
--   withheld_reason:            publishers, and the author once withheld
CREATE OR REPLACE FUNCTION public.evangelism_attribution(p_ids uuid[])
RETURNS TABLE (id uuid, is_mine boolean, author_name text, published_by uuid, withheld_reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid,
           public.can_publish_evangelism() AS pub,
           public.can_submit_evangelism() AS sub,
           public.has_permission('evangelism.view') AS vw
  )
  SELECT t.id,
         t.author_user_id = me.uid,
         CASE WHEN me.pub OR t.author_user_id = me.uid THEN
           coalesce(nullif(btrim(u.display_name), ''),
                    nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
                    'Staff member')
         END,
         CASE WHEN me.pub OR t.author_user_id = me.uid THEN t.published_by END,
         CASE WHEN me.pub OR (t.author_user_id = me.uid AND t.status = 'withheld')
              THEN t.withheld_reason END
  FROM public.evangelism_testimonies t
  CROSS JOIN me
  LEFT JOIN public.users u ON u.id = t.author_user_id
  WHERE t.id = ANY (p_ids)
    AND me.uid IS NOT NULL
    AND (   me.pub
         OR (t.status = 'published' AND (me.sub OR me.vw))
         OR (t.author_user_id = me.uid
             AND t.status IN ('draft', 'submitted', 'withheld')
             AND me.sub));
$$;

-- The caller's own story ids (replaces .eq('author_user_id', me)).
CREATE OR REPLACE FUNCTION public.evangelism_my_testimony_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id FROM public.evangelism_testimonies t
  WHERE auth.uid() IS NOT NULL
    AND t.author_user_id = auth.uid()
    AND public.can_submit_evangelism();
$$;

-- Is this the caller's own story, still open? Media policies use it,
-- since author_user_id is not column-readable by authenticated.
CREATE OR REPLACE FUNCTION public.evangelism_is_my_open_story(p_testimony_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.evangelism_testimonies t
                 WHERE t.id = p_testimony_id
                   AND t.author_user_id = auth.uid()
                   AND t.status IN ('draft', 'submitted'));
$$;

-- ────────────────────────────────────────────────────────────
-- 6. Upload ledger (who minted which photo path)
-- ────────────────────────────────────────────────────────────
-- POST /api/evangelism/media/sign mints testimonies/{uuid}/{uuid}.{ext}
-- (no user id in the path, so a signed read URL can't leak the author)
-- and records it here with the service role. authenticated has no
-- access at all; it can only ask evangelism_upload_is_mine().
CREATE TABLE IF NOT EXISTS public.evangelism_uploads (
  storage_path text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.evangelism_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evangelism_uploads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.evangelism_uploads TO service_role;

CREATE OR REPLACE FUNCTION public.evangelism_upload_is_mine(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.evangelism_uploads u
                 WHERE u.storage_path = p_path AND u.user_id = auth.uid());
$$;

-- ────────────────────────────────────────────────────────────
-- 7. Media (photo only this slice)
-- ────────────────────────────────────────────────────────────
-- One photo per story is enforced by the API, not here, so a later
-- slice can allow more without a migration.
-- ON DELETE CASCADE removes the row only. The DELETE route removes the
-- storage object with the service role after the row is gone; a
-- direct SQL delete leaves the file behind.
CREATE TABLE IF NOT EXISTS public.evangelism_media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  testimony_id   uuid NOT NULL REFERENCES public.evangelism_testimonies (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind = 'photo'),
  storage_path   text NOT NULL UNIQUE,
  content_type   text NOT NULL
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  size_bytes     integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  sort_order     integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_by     uuid DEFAULT auth.uid() REFERENCES public.users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evangelism_media_storage_path_shape CHECK (
    storage_path ~ '^testimonies/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif)$'
  )
);

ALTER TABLE public.evangelism_media ALTER COLUMN created_by SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS evangelism_media_testimony
  ON public.evangelism_media (testimony_id, sort_order);

ALTER TABLE public.evangelism_media ENABLE ROW LEVEL SECURITY;

-- Follows the parent: the subquery runs under the caller's own
-- testimony policies (and only reads t.id, which is granted), so a
-- photo is visible exactly when its story is.
DROP POLICY IF EXISTS "evangelism_media_select" ON public.evangelism_media;
CREATE POLICY "evangelism_media_select"
  ON public.evangelism_media FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.evangelism_testimonies t
      WHERE t.id = evangelism_media.testimony_id
    )
  );

-- Only onto your own open story, and only at a path the sign route
-- minted for you (the ledger).
DROP POLICY IF EXISTS "evangelism_media_insert_own" ON public.evangelism_media;
CREATE POLICY "evangelism_media_insert_own"
  ON public.evangelism_media FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.can_submit_evangelism()
    AND public.evangelism_upload_is_mine(storage_path)
    AND public.evangelism_is_my_open_story(testimony_id)
  );

-- The author may drop the photo while the story is still open; a
-- publisher may drop any photo.
DROP POLICY IF EXISTS "evangelism_media_delete" ON public.evangelism_media;
CREATE POLICY "evangelism_media_delete"
  ON public.evangelism_media FOR DELETE TO authenticated
  USING (
    public.can_publish_evangelism()
    OR (public.can_submit_evangelism() AND public.evangelism_is_my_open_story(testimony_id))
  );

-- storage_path and created_by are not readable by authenticated: the
-- API signs reads with the service role, keyed by media id. No UPDATE:
-- replace a photo by deleting and re-adding it.
REVOKE ALL ON TABLE public.evangelism_media FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, testimony_id, kind, content_type, size_bytes, sort_order, created_at)
  ON TABLE public.evangelism_media TO authenticated;
GRANT INSERT, DELETE ON TABLE public.evangelism_media TO authenticated;
GRANT ALL ON TABLE public.evangelism_media TO service_role;

-- ────────────────────────────────────────────────────────────
-- 8. Function grants
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.can_publish_evangelism() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_submit_evangelism() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evangelism_testimonies_guard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evangelism_attribution(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evangelism_my_testimony_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evangelism_is_my_open_story(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evangelism_upload_is_mine(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_publish_evangelism() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_submit_evangelism() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evangelism_testimonies_guard() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evangelism_attribution(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evangelism_my_testimony_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evangelism_is_my_open_story(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evangelism_upload_is_mine(text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 9. Private storage bucket (photo only — 15 MB)
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
--   SELECT has_column_privilege('authenticated', 'public.evangelism_testimonies', 'author_user_id', 'SELECT');  -- false
-- ============================================================
