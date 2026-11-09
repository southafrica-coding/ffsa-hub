-- ============================================================
-- FFSA Hub — Migration 311: Evangelism open publish + moderate
-- ============================================================
-- Jack (FFSA), 21:36 SAST: "Everyone can publish their own stories;
-- only ministry leaders and admins can take down or see other
-- people's stories."
--
-- self_service is the baseline role every account gets (see
-- 115_baseline_self_service_access.sql and
-- 191_space_bookings_view_for_everyone.sql). This grants that role
-- evangelism.view, evangelism.submit and evangelism.publish, and
-- adds evangelism.moderate for ministry_leader. admin and
-- super_admin pass through is_admin() and do not need the key.
--
-- Replaces 307's publisher-wide visibility, review and delete so a
-- non-moderator can publish only their own consented story. 307
-- itself is not edited. 310 is reserved by open PR #536. This file
-- is NOT applied. Do not run it until Jack says so.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. evangelism.moderate, self_service publish bundle, backfill
-- ────────────────────────────────────────────────────────────
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('evangelism', 'evangelism.moderate', 'Moderate others'' testimonies', 40)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p
  ON p.key IN ('evangelism.view', 'evangelism.submit', 'evangelism.publish')
WHERE r.name = 'self_service'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.key = 'evangelism.moderate'
WHERE r.name = 'ministry_leader'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Defensive backfill. Mirrors 115: NOT EXISTS, because NULL scope
-- columns make ON CONFLICT unreliable. Column list matches 115.
-- Active accounts only: a deactivated user with no roles stays that way.
INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM public.users u
CROSS JOIN public.roles r
WHERE r.name = 'self_service'
  AND u.is_active
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = u.id
      AND ur.role_id = r.id
  );

-- INVOKER, like 307's can_publish_evangelism. search_path is empty
-- and every name is schema-qualified.
CREATE OR REPLACE FUNCTION public.can_moderate_evangelism()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT public.is_admin() OR public.has_permission('evangelism.moderate');
$$;

REVOKE ALL ON FUNCTION public.can_moderate_evangelism() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_moderate_evangelism() TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 2. Guard: own publish, moderate everyone else
-- ────────────────────────────────────────────────────────────
-- On someone else's story, any status change (publish, withhold,
-- republish) and any withheld_reason change needs
-- can_moderate_evangelism(); otherwise raise. Content and consent
-- stay with the author, even for a moderator. A draft still cannot
-- be submitted or published by someone else, and cannot go straight
-- to published. Consent remains the table CHECK.
-- Who last withheld the story. Not granted to authenticated (no column
-- grant), stamped only by the guard below.
ALTER TABLE public.evangelism_testimonies
  ADD COLUMN IF NOT EXISTS withheld_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.evangelism_testimonies_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  old_status text;
  someone_else boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_status := OLD.status;
    someone_else := OLD.author_user_id IS DISTINCT FROM auth.uid();
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.author_user_id IS DISTINCT FROM OLD.author_user_id THEN
    RAISE EXCEPTION 'author_user_id cannot be changed' USING ERRCODE = '42501';
  END IF;

  IF someone_else THEN
    IF (NEW.title, NEW.body, NEW.occurred_on, NEW.location_label, NEW.staff_ministry_id,
        NEW.people_reached, NEW.decisions, NEW.outcome, NEW.consent_to_share)
       IS DISTINCT FROM
       (OLD.title, OLD.body, OLD.occurred_on, OLD.location_label, OLD.staff_ministry_id,
        OLD.people_reached, OLD.decisions, OLD.outcome, OLD.consent_to_share) THEN
      RAISE EXCEPTION 'Publishers cannot edit the content or consent of someone else''s story'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.withheld_reason IS DISTINCT FROM OLD.withheld_reason THEN
      IF NOT public.can_moderate_evangelism() THEN
        RAISE EXCEPTION 'Only a moderator can publish, withhold or republish someone else''s story'
          USING ERRCODE = '42501';
      END IF;
      -- No submitting someone else's draft. Publish and withhold only,
      -- and only from a story that has already been submitted.
      IF NEW.status IS DISTINCT FROM OLD.status
         AND (OLD.status NOT IN ('submitted', 'withheld', 'published')
              OR NEW.status NOT IN ('published', 'withheld')) THEN
        RAISE EXCEPTION 'A publisher can only publish or withhold a submitted story'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSE
    -- A moderator's takedown sticks: the author may still edit content or
    -- delete the story, but cannot republish, resubmit or change the reason.
    IF TG_OP = 'UPDATE'
       AND OLD.status = 'withheld'
       AND OLD.withheld_by IS NOT NULL
       AND OLD.withheld_by IS DISTINCT FROM auth.uid()
       AND (NEW.status, NEW.withheld_reason) IS DISTINCT FROM (OLD.status, OLD.withheld_reason)
       AND NOT public.can_moderate_evangelism() THEN
      RAISE EXCEPTION 'A moderator withheld this story; only a moderator can republish it'
        USING ERRCODE = '42501';
    END IF;
    -- Author may withhold (unpublish) their own published story.
    IF NEW.status = 'withheld'
       AND old_status IS DISTINCT FROM 'withheld'
       AND old_status IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'Only a publisher can publish or withhold a testimony'
        USING ERRCODE = '42501';
    ELSIF NEW.status = 'published' AND NOT public.can_publish_evangelism() THEN
      RAISE EXCEPTION 'Only a publisher can publish or withhold a testimony'
        USING ERRCODE = '42501';
    ELSIF NEW.status NOT IN ('published', 'withheld')
          AND NOT public.can_publish_evangelism()
          AND (NEW.published_at IS NOT NULL
               OR NEW.published_by IS NOT NULL
               OR NEW.withheld_reason IS NOT NULL) THEN
      RAISE EXCEPTION 'Only a publisher can set published or withheld fields'
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
    NEW.withheld_by := NULL;
  ELSIF NEW.status = 'published' THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.published_at := OLD.published_at;
      NEW.published_by := OLD.published_by;
    END IF;
    NEW.withheld_by := NULL;
  ELSE
    NEW.published_at := NULL;
    NEW.published_by := NULL;
    IF NEW.status <> 'withheld' THEN
      NEW.withheld_reason := NULL;
      NEW.withheld_by := NULL;
    ELSIF old_status IS DISTINCT FROM 'withheld'
          OR (someone_else AND NEW.withheld_reason IS DISTINCT FROM OLD.withheld_reason) THEN
      NEW.withheld_by := auth.uid();
    ELSE
      NEW.withheld_by := OLD.withheld_by;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.evangelism_testimonies_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evangelism_testimonies_guard() TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 3. Visibility: own stories + published; moderators see the rest
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "evangelism_testimonies_select_own" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_select_own"
  ON public.evangelism_testimonies FOR SELECT TO authenticated
  USING (
    author_user_id = auth.uid()
    AND public.can_submit_evangelism()
  );

-- Other people's non-published rows. Moderators see every status.
DROP POLICY IF EXISTS "evangelism_testimonies_select_publisher" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_select_publisher"
  ON public.evangelism_testimonies FOR SELECT TO authenticated
  USING (public.can_moderate_evangelism());

-- Own publish / withhold. 307's update_own_open still covers draft and
-- submitted content edits; its WITH CHECK rejects a published row, so
-- this policy is what lets the author land on published or withheld.
DROP POLICY IF EXISTS "evangelism_testimonies_update_own_status" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_update_own_status"
  ON public.evangelism_testimonies FOR UPDATE TO authenticated
  USING (
    author_user_id = auth.uid()
    AND public.can_submit_evangelism()
  )
  WITH CHECK (
    author_user_id = auth.uid()
    AND public.can_submit_evangelism()
  );

DROP POLICY IF EXISTS "evangelism_testimonies_update_publisher" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_update_publisher"
  ON public.evangelism_testimonies FOR UPDATE TO authenticated
  USING (public.can_moderate_evangelism())
  WITH CHECK (public.can_moderate_evangelism());

-- 307's own-draft delete stays. Authors can also delete their own
-- published or withheld story. Submitted stays not deletable by the
-- author. Other people's stories need a moderator.
DROP POLICY IF EXISTS "evangelism_testimonies_delete_own_closed" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_delete_own_closed"
  ON public.evangelism_testimonies FOR DELETE TO authenticated
  USING (
    author_user_id = auth.uid()
    AND status IN ('published', 'withheld')
    AND public.can_submit_evangelism()
  );

DROP POLICY IF EXISTS "evangelism_testimonies_delete_publisher" ON public.evangelism_testimonies;
CREATE POLICY "evangelism_testimonies_delete_publisher"
  ON public.evangelism_testimonies FOR DELETE TO authenticated
  USING (public.can_moderate_evangelism());

-- ────────────────────────────────────────────────────────────
-- 4. Attribution. Published stories keep 307's name rule
--    (publishers and the author). Others' non-published rows hide
--    the author name and the withheld reason unless the caller
--    is a moderator.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evangelism_attribution(p_ids uuid[])
RETURNS TABLE (id uuid, is_mine boolean, author_name text, published_by uuid, withheld_reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid,
           public.can_moderate_evangelism() AS mod,
           public.can_publish_evangelism() AS pub,
           public.can_submit_evangelism() AS sub,
           public.has_permission('evangelism.view') AS vw
  )
  SELECT t.id,
         t.author_user_id = me.uid,
         CASE
           WHEN me.mod OR t.author_user_id = me.uid THEN
             coalesce(nullif(btrim(u.display_name), ''),
                      nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
                      'Staff member')
           WHEN t.status = 'published' AND me.pub THEN
             coalesce(nullif(btrim(u.display_name), ''),
                      nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
                      'Staff member')
         END,
         CASE
           WHEN me.mod OR t.author_user_id = me.uid THEN t.published_by
           WHEN t.status = 'published' AND me.pub THEN t.published_by
         END,
         CASE
           WHEN me.mod THEN t.withheld_reason
           WHEN t.author_user_id = me.uid AND t.status = 'withheld' THEN t.withheld_reason
           WHEN t.status = 'published' AND me.pub THEN t.withheld_reason
         END
  FROM public.evangelism_testimonies t
  CROSS JOIN me
  LEFT JOIN public.users u ON u.id = t.author_user_id
  WHERE t.id = ANY (p_ids)
    AND me.uid IS NOT NULL
    AND (   me.mod
         OR (t.status = 'published' AND (me.sub OR me.vw))
         OR (t.author_user_id = me.uid AND me.sub));
$$;

REVOKE ALL ON FUNCTION public.evangelism_attribution(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evangelism_attribution(uuid[]) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 5. Media follows the parent story. Authors can delete their own
--    photo (including when the story delete cascades). Moderators
--    can delete any photo. 307's column grants are left alone.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evangelism_is_my_story(p_testimony_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.evangelism_testimonies t
    WHERE t.id = p_testimony_id
      AND t.author_user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.evangelism_is_my_story(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evangelism_is_my_story(uuid) TO authenticated, service_role;

-- Same visibility as the testimony policies: the subquery runs as the
-- caller, so a photo is visible exactly when its story is.
DROP POLICY IF EXISTS "evangelism_media_select" ON public.evangelism_media;
CREATE POLICY "evangelism_media_select"
  ON public.evangelism_media FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.evangelism_testimonies t
      WHERE t.id = evangelism_media.testimony_id
    )
  );

DROP POLICY IF EXISTS "evangelism_media_delete" ON public.evangelism_media;
CREATE POLICY "evangelism_media_delete"
  ON public.evangelism_media FOR DELETE TO authenticated
  USING (
    public.can_moderate_evangelism()
    OR (
      public.can_submit_evangelism()
      AND public.evangelism_is_my_story(testimony_id)
    )
  );

-- Direct reads of the private bucket. 307 signed reads with the
-- service role and created no storage policy; this one does not open
-- the bucket, it only lets a caller select an object when they can
-- already see that story. Writes stay with the service role.
CREATE OR REPLACE FUNCTION public.evangelism_storage_visible(p_bucket_id text, p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_bucket_id = 'evangelism-media'
     AND EXISTS (
       SELECT 1
       FROM public.evangelism_media m
       JOIN public.evangelism_testimonies t ON t.id = m.testimony_id
       WHERE m.storage_path = p_name
         AND (
           public.can_moderate_evangelism()
           OR (t.author_user_id = auth.uid() AND public.can_submit_evangelism())
           OR (
             t.status = 'published'
             AND (
               public.can_submit_evangelism()
               OR public.has_permission('evangelism.view')
             )
           )
         )
     );
$$;

REVOKE ALL ON FUNCTION public.evangelism_storage_visible(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evangelism_storage_visible(text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "evangelism_media_objects_select" ON storage.objects;
CREATE POLICY "evangelism_media_objects_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'evangelism-media' AND public.evangelism_storage_visible(bucket_id, name));
