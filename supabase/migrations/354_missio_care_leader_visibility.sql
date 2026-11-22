-- ============================================================
-- FFSA Hub — Migration 354: Missio care, leaders and houses see
-- what the person allowed
-- ============================================================
-- Depends on 338 (missio_led_house_ids, missio_my_contact_id) and
-- 343 (missio_care_requests).
--
-- 343 gave pastors the Care board. The person already chose who may
-- know (privacy); this migration lets the database act on it:
--
--   pastors          pastors only (343, unchanged).
--   pastors_leaders  pastors, plus the current leaders and co-leaders
--                    of the request's house church.
--   house            pastors, those leaders, plus anyone who currently
--                    belongs to that house (any membership role). Read
--                    only for members.
--
-- A request with no house church stays with pastors, whatever its
-- privacy: there is no house to share it with.
--
-- Leaders are missio_led_house_ids() from 338: the house_church_leader
-- role plus an open leader / co_leader membership. Coaches are not
-- leaders here. They are pastoral covering for a house's leaders, and
-- missio_my_house_ids() (which adds coached houses) is deliberately
-- not used. A coach who is also a member of a house sees that
-- house's "house" requests, as any member does.
--
-- Members are a new helper, missio_member_house_ids(): an open
-- membership (any role) for the signed-in user's contact, in a Missio
-- house, and some Missio org role (the Missio app only opens for
-- people who hold one). Without that, the helper returns nothing.
--
-- Leaders may take, finish and check back in on the requests they
-- can see. A trigger keeps them to that: they cannot reopen, cannot
-- hand a request to someone else, and cannot change who asked, what
-- they asked, the house or the privacy. Pastors are not limited.
--
-- Phone numbers: members can pray with a name and the prayer, so
-- authenticated users no longer read the phone column directly (nor
-- rate_key_hash, which the app never reads). missio_care_phones()
-- hands the phone to pastors, and to leaders for their house's
-- shared requests, so they can reply to talk and practical help.
-- Re-running 343 after this file re-grants table-wide SELECT; run
-- this file again afterwards.
--
-- Public care form inserts stay service-role only (343). No new
-- INSERT policy.
--
-- Idempotent.
-- ============================================================

-- 1. Houses the signed-in user belongs to.
CREATE OR REPLACE FUNCTION public.missio_member_house_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.house_church_id
  FROM public.house_church_members m
  JOIN public.house_churches hc ON hc.id = m.house_church_id
  JOIN public.organisations o ON o.id = hc.org_id AND o.slug = 'missio'
  WHERE public.has_org_role('missio')
    AND m.ended_at IS NULL
    AND m.started_at <= current_date
    AND m.contact_id = public.missio_my_contact_id();
$$;

REVOKE ALL ON FUNCTION public.missio_member_house_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missio_member_house_ids() TO authenticated, service_role;

COMMENT ON FUNCTION public.missio_member_house_ids() IS
  'Houses the signed-in user currently belongs to (open membership, any role) while holding a Missio org role. Empty for everyone else.';

-- 2. Leaders read their house''s shared requests; members read "house" ones.
DROP POLICY IF EXISTS "Leaders read shared care requests" ON public.missio_care_requests;
CREATE POLICY "Leaders read shared care requests"
  ON public.missio_care_requests
  FOR SELECT
  TO authenticated
  USING (
    privacy IN ('pastors_leaders', 'house')
    AND house_church_id IN (SELECT public.missio_led_house_ids())
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "House members read house care requests" ON public.missio_care_requests;
CREATE POLICY "House members read house care requests"
  ON public.missio_care_requests
  FOR SELECT
  TO authenticated
  USING (
    privacy = 'house'
    AND house_church_id IN (SELECT public.missio_member_house_ids())
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

-- 3. Leaders move the requests they can read. Members get no UPDATE.
DROP POLICY IF EXISTS "Leaders update shared care requests" ON public.missio_care_requests;
CREATE POLICY "Leaders update shared care requests"
  ON public.missio_care_requests
  FOR UPDATE
  TO authenticated
  USING (
    privacy IN ('pastors_leaders', 'house')
    AND house_church_id IN (SELECT public.missio_led_house_ids())
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  )
  WITH CHECK (
    privacy IN ('pastors_leaders', 'house')
    AND house_church_id IN (SELECT public.missio_led_house_ids())
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

-- 4. What a leader may change: take, done, checked back in. Nothing else.
CREATE OR REPLACE FUNCTION public.missio_care_requests_leader_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- The service role (no user) and pastors are not limited here.
  IF (SELECT auth.uid()) IS NULL OR public.has_org_role('missio', ARRAY['pastor']) THEN
    RETURN NEW;
  END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
     OR NEW.house_church_id IS DISTINCT FROM OLD.house_church_id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.phone IS DISTINCT FROM OLD.phone
     OR NEW.needs IS DISTINCT FROM OLD.needs
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.privacy IS DISTINCT FROM OLD.privacy
     OR NEW.urgent IS DISTINCT FROM OLD.urgent
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.rate_key_hash IS DISTINCT FROM OLD.rate_key_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Leaders can only take, finish or check in on a care request'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'new' AND OLD.status <> 'new' THEN
    RAISE EXCEPTION 'Only a pastor can reopen a care request'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.taken_by IS DISTINCT FROM OLD.taken_by AND NEW.taken_by IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'A leader can only take a care request for themselves'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.missio_care_requests_leader_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS missio_care_requests_leader_guard ON public.missio_care_requests;
CREATE TRIGGER missio_care_requests_leader_guard
  BEFORE UPDATE ON public.missio_care_requests
  FOR EACH ROW EXECUTE FUNCTION public.missio_care_requests_leader_guard();

-- 5. Phone numbers are not readable column by column any more.
REVOKE SELECT ON TABLE public.missio_care_requests FROM authenticated;
GRANT SELECT (
  id, org_id, source, source_id, contact_id, house_church_id, name, needs, body,
  privacy, urgent, status, taken_by, taken_at, done_at, done_note, checked_in_at,
  created_by, created_at, updated_at
) ON TABLE public.missio_care_requests TO authenticated;

-- Phones for the given requests the caller may reply to: every
-- request for a pastor, their house's shared requests for a leader.
-- Nothing for anyone else.
CREATE OR REPLACE FUNCTION public.missio_care_phones(p_ids uuid[])
RETURNS TABLE (id uuid, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id, r.phone
  FROM public.missio_care_requests r
  JOIN public.organisations o ON o.id = r.org_id AND o.slug = 'missio'
  WHERE r.id = ANY (p_ids)
    AND r.phone IS NOT NULL
    AND (
      public.has_org_role('missio', ARRAY['pastor'])
      OR (
        r.privacy IN ('pastors_leaders', 'house')
        AND r.house_church_id IN (SELECT public.missio_led_house_ids())
      )
    );
$$;

REVOKE ALL ON FUNCTION public.missio_care_phones(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missio_care_phones(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.missio_care_phones(uuid[]) IS
  'Phone numbers on Missio care requests, for pastors (all) and house leaders (their house''s pastors_leaders / house requests). Members never get a phone.';
