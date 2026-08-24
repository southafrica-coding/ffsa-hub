-- ============================================================
-- FFSA Hub — Migration 181: Shared households
-- ------------------------------------------------------------
-- Until now family records (migration 153) hung off a single user_id.
-- When the spouse a staff member had already entered later signed up
-- for the Hub with that same email, the Hub saw a brand-new person:
-- they were asked the spouse and children questions again and re-typed
-- every child's passport and insurance details, leaving two copies that
-- drifted apart on every edit.
--
-- A household now owns the family records, and users belong to one, so
-- both spouses read and write the same rows. Whichever spouse fills the
-- family in first, the other is matched at signup by the email on the
-- spouse row, confirms the connection once, and inherits everything.
--
-- Two semantic changes to be aware of:
--   * household_members.user_id is KEPT but now means "who added this
--     row" (provenance) — it is no longer ownership, and it no longer
--     cascade-deletes the family when that person is deleted.
--   * users.has_children is superseded by households.has_children. The
--     old column is left populated but unused for one release so a
--     rollback of the app code still works; a later migration drops it.
--
-- Linking is a data-access grant (the email is user-supplied), so it
-- only ever runs at ACCOUNT CREATION, the matched row must predate the
-- account, it can be claimed once, and nothing in the household is
-- readable until the new user confirms — see link_household_on_signup.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. households
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.households (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  -- Moved from users.has_children (migration 155). NULL = unanswered.
  has_children boolean,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_households_updated_at ON public.households;
CREATE TRIGGER trg_households_updated_at
  BEFORE UPDATE ON public.households
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. users — membership + the pending-link handshake
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS household_id               uuid REFERENCES public.households (id) ON DELETE SET NULL,
  -- A match was found at signup but the user has not confirmed it yet.
  -- household_id stays NULL meanwhile, so RLS shows them nothing.
  ADD COLUMN IF NOT EXISTS pending_household_id       uuid REFERENCES public.households (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS household_linked_at        timestamptz,
  -- Set when the user says "that's not me" (or unlinks) so the same
  -- match is never re-offered.
  ADD COLUMN IF NOT EXISTS household_link_declined_at timestamptz;

CREATE INDEX IF NOT EXISTS users_household_idx ON public.users (household_id);

-- ────────────────────────────────────────────────────────────
-- 3. household_members — owned by the household
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS household_id   uuid REFERENCES public.households (id) ON DELETE CASCADE,
  -- Set once this member has their own Hub account (their identity row
  -- stays put; it is hidden from their own family list, not deleted).
  ADD COLUMN IF NOT EXISTS linked_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────
-- 4. Backfill — one household per user that has family data
-- ────────────────────────────────────────────────────────────
-- Users with no family data at all get a household lazily on first
-- write (ensure_household), rather than a row each up front.
WITH seed AS (
  SELECT u.id AS user_id, u.has_children
  FROM public.users u
  WHERE u.household_id IS NULL
    AND (
      u.has_children IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.household_members hm WHERE hm.user_id = u.id)
    )
), made AS (
  INSERT INTO public.households (created_by, has_children)
  SELECT s.user_id, s.has_children FROM seed s
  RETURNING id, created_by
)
UPDATE public.users u
SET household_id = m.id
FROM made m
WHERE u.id = m.created_by;

UPDATE public.household_members hm
SET household_id = u.household_id
FROM public.users u
WHERE hm.user_id = u.id
  AND hm.household_id IS NULL
  AND u.household_id IS NOT NULL;

-- Safety net: any member row still unassigned (e.g. its owner was
-- deleted) gets its own household, so SET NOT NULL below cannot fail
-- and no family record is lost.
DO $$
DECLARE
  r record;
  new_id uuid;
BEGIN
  FOR r IN SELECT id FROM public.household_members WHERE household_id IS NULL LOOP
    INSERT INTO public.households (created_by, has_children)
    VALUES (NULL, NULL)
    RETURNING id INTO new_id;
    UPDATE public.household_members SET household_id = new_id WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.household_members
  ALTER COLUMN household_id SET NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL;

-- user_id is provenance now: deleting the person who typed the records
-- in must not delete the family's records.
ALTER TABLE public.household_members
  DROP CONSTRAINT IF EXISTS household_members_user_id_fkey;
ALTER TABLE public.household_members
  ADD CONSTRAINT household_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS household_members_household_idx
  ON public.household_members (household_id);

-- ────────────────────────────────────────────────────────────
-- 5. Email normalisation + matching indexes
-- ────────────────────────────────────────────────────────────
-- The raw `email` keeps its original casing for display; matching goes
-- through this generated column so " Nathaly@Example.COM " and
-- "nathaly@example.com" are the same person.
ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS email_normalized text
  GENERATED ALWAYS AS (NULLIF(lower(btrim(email)), '')) STORED;

CREATE INDEX IF NOT EXISTS household_members_spouse_email_idx
  ON public.household_members (email_normalized)
  WHERE relationship = 'spouse' AND linked_user_id IS NULL;

-- One account may claim at most one member row anywhere.
CREATE UNIQUE INDEX IF NOT EXISTS household_members_linked_user_uidx
  ON public.household_members (linked_user_id)
  WHERE linked_user_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 6. current_household_id() — SECURITY DEFINER, like is_admin()
-- ────────────────────────────────────────────────────────────
-- Policies must NOT read public.users directly: that read is itself
-- subject to the users RLS policies. Same pattern as is_admin()
-- (migration 002).
CREATE OR REPLACE FUNCTION public.current_household_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT household_id FROM public.users WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_household_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_household_id() TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 7. RLS — scoped to the household instead of the user
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users read own household members"   ON public.household_members;
DROP POLICY IF EXISTS "Users insert own household members" ON public.household_members;
DROP POLICY IF EXISTS "Users update own household members" ON public.household_members;
DROP POLICY IF EXISTS "Users delete own household members" ON public.household_members;

CREATE POLICY "Household reads its members"
  ON public.household_members FOR SELECT
  USING (household_id = public.current_household_id() OR public.is_admin());

CREATE POLICY "Household inserts members"
  ON public.household_members FOR INSERT
  WITH CHECK (
    public.current_household_id() IS NOT NULL
    AND household_id = public.current_household_id()
  );

CREATE POLICY "Household updates members"
  ON public.household_members FOR UPDATE
  USING (household_id = public.current_household_id())
  WITH CHECK (household_id = public.current_household_id());

CREATE POLICY "Household deletes members"
  ON public.household_members FOR DELETE
  USING (household_id = public.current_household_id());

-- ("Admins manage household members" FOR ALL, from migration 153, is
--  unchanged and still applies.)

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read their household" ON public.households;
CREATE POLICY "Members read their household"
  ON public.households FOR SELECT
  USING (id = public.current_household_id() OR public.is_admin());

DROP POLICY IF EXISTS "Members update their household" ON public.households;
CREATE POLICY "Members update their household"
  ON public.households FOR UPDATE
  USING (id = public.current_household_id())
  WITH CHECK (id = public.current_household_id());

DROP POLICY IF EXISTS "Admins manage households" ON public.households;
CREATE POLICY "Admins manage households"
  ON public.households FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Deliberately no self-serve INSERT policy: households are created only
-- by the SECURITY DEFINER functions below and by the service role.

-- ────────────────────────────────────────────────────────────
-- 8. ensure_household(user) — idempotent
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_household(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id uuid;
BEGIN
  SELECT household_id INTO v_household_id
  FROM public.users WHERE id = p_user_id FOR UPDATE;

  IF v_household_id IS NOT NULL THEN
    RETURN v_household_id;
  END IF;

  INSERT INTO public.households (created_by) VALUES (p_user_id)
  RETURNING id INTO v_household_id;

  UPDATE public.users SET household_id = v_household_id WHERE id = p_user_id;
  RETURN v_household_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_household(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_household(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 9. link_household_on_signup(user) — service role only
-- ────────────────────────────────────────────────────────────
-- Called from the account-creation routes. Sets pending_household_id
-- ONLY: the user sees nothing of the household until they confirm.
-- Returns { status: 'none' | 'pending' | 'ambiguous', household_id }.
CREATE OR REPLACE FUNCTION public.link_household_on_signup(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email       text;
  v_created_at  timestamptz;
  v_match_count int;
  v_household   uuid;
BEGIN
  SELECT lower(btrim(email)), created_at
    INTO v_email, v_created_at
  FROM public.users WHERE id = p_user_id;

  IF v_email IS NULL OR v_email = '' THEN
    PERFORM public.ensure_household(p_user_id);
    RETURN jsonb_build_object('status', 'none');
  END IF;

  -- Candidate spouse rows: same email, unclaimed, in a real household,
  -- and created BEFORE this account existed (a row cannot legitimately
  -- be added after the account it claims to describe).
  SELECT count(DISTINCT hm.household_id)
    INTO v_match_count
  FROM public.household_members hm
  WHERE hm.relationship = 'spouse'
    AND hm.email_normalized = v_email
    AND hm.linked_user_id IS NULL
    AND hm.household_id IS NOT NULL
    AND hm.created_at < v_created_at;

  IF v_match_count = 1 THEN
    SELECT DISTINCT hm.household_id INTO v_household
    FROM public.household_members hm
    WHERE hm.relationship = 'spouse'
      AND hm.email_normalized = v_email
      AND hm.linked_user_id IS NULL
      AND hm.household_id IS NOT NULL
      AND hm.created_at < v_created_at;

    -- Never offer the user their own household.
    IF v_household = (SELECT household_id FROM public.users WHERE id = p_user_id) THEN
      v_household := NULL;
    END IF;
  END IF;

  PERFORM public.ensure_household(p_user_id);

  IF v_match_count > 1 THEN
    -- Two different households claim this email. Auto-linking either
    -- would be a guess, and offering a choice would leak who claims
    -- them, so an admin resolves it.
    INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, changes)
    VALUES (p_user_id, 'household_link_ambiguous', 'users', p_user_id,
            jsonb_build_object('email', v_email, 'household_count', v_match_count));
    RETURN jsonb_build_object('status', 'ambiguous');
  END IF;

  IF v_household IS NULL THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  UPDATE public.users
  SET pending_household_id = v_household
  WHERE id = p_user_id;

  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, changes)
  VALUES (p_user_id, 'household_link_pending', 'households', v_household,
          jsonb_build_object('email', v_email));

  RETURN jsonb_build_object('status', 'pending', 'household_id', v_household);
END;
$$;

REVOKE ALL ON FUNCTION public.link_household_on_signup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_household_on_signup(uuid) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 10. confirm_household_link() — the caller accepts the match
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_household_link()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user      uuid := auth.uid();
  v_target    uuid;
  v_own       uuid;
  v_email     text;
  v_target_hc boolean;
  v_own_hc    boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT pending_household_id, household_id, lower(btrim(email))
    INTO v_target, v_own, v_email
  FROM public.users WHERE id = v_user FOR UPDATE;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('status', 'no_pending');
  END IF;

  -- Lock the target so two accounts cannot claim the same row at once.
  PERFORM 1 FROM public.households WHERE id = v_target FOR UPDATE;

  SELECT has_children INTO v_target_hc FROM public.households WHERE id = v_target;

  -- Claim the spouse identity row(s). If someone else got there first
  -- the row is no longer unclaimed and the link is refused.
  UPDATE public.household_members
  SET linked_user_id = v_user
  WHERE household_id = v_target
    AND relationship = 'spouse'
    AND email_normalized = v_email
    AND linked_user_id IS NULL;

  IF NOT FOUND THEN
    UPDATE public.users SET pending_household_id = NULL WHERE id = v_user;
    RETURN jsonb_build_object('status', 'already_claimed');
  END IF;

  -- Merge anything the caller had entered on their own into the target.
  IF v_own IS NOT NULL AND v_own <> v_target THEN
    SELECT has_children INTO v_own_hc FROM public.households WHERE id = v_own;

    UPDATE public.household_members
    SET household_id = v_target
    WHERE household_id = v_own;

    IF v_target_hc IS NULL AND v_own_hc IS NOT NULL THEN
      UPDATE public.households SET has_children = v_own_hc WHERE id = v_target;
    END IF;

    UPDATE public.users
    SET household_id = v_target,
        pending_household_id = NULL,
        household_linked_at = now()
    WHERE id = v_user;

    -- Drop the now-empty household if nobody else belongs to it.
    DELETE FROM public.households h
    WHERE h.id = v_own
      AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.household_id = h.id)
      AND NOT EXISTS (SELECT 1 FROM public.household_members m WHERE m.household_id = h.id);
  ELSE
    UPDATE public.users
    SET household_id = v_target,
        pending_household_id = NULL,
        household_linked_at = now()
    WHERE id = v_user;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, changes)
  VALUES (v_user, 'household_link_confirmed', 'households', v_target,
          jsonb_build_object('merged_from', v_own));

  RETURN jsonb_build_object('status', 'linked', 'household_id', v_target);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_household_link() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_household_link() TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 11. decline_household_link() — "that's not me"
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decline_household_link()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_target uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT pending_household_id INTO v_target
  FROM public.users WHERE id = v_user FOR UPDATE;

  UPDATE public.users
  SET pending_household_id = NULL,
      household_link_declined_at = now()
  WHERE id = v_user;

  PERFORM public.ensure_household(v_user);

  IF v_target IS NOT NULL THEN
    INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, changes)
    VALUES (v_user, 'household_link_declined', 'households', v_target, NULL);
  END IF;

  RETURN jsonb_build_object('status', 'declined');
END;
$$;

REVOKE ALL ON FUNCTION public.decline_household_link() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_household_link() TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 12. unlink_household() — leave the shared household
-- ────────────────────────────────────────────────────────────
-- The family records STAY with the original household. Copying
-- children's passport and insurance details into a second household on
-- an "actually, that wasn't me" click would duplicate minors' PII; the
-- leaver re-adds their own family instead, and their children gate
-- re-runs because the new household's has_children is NULL.
CREATE OR REPLACE FUNCTION public.unlink_household()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_old  uuid;
  v_new  uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT household_id INTO v_old FROM public.users WHERE id = v_user FOR UPDATE;

  UPDATE public.household_members
  SET linked_user_id = NULL
  WHERE linked_user_id = v_user;

  INSERT INTO public.households (created_by) VALUES (v_user) RETURNING id INTO v_new;

  UPDATE public.users
  SET household_id = v_new,
      pending_household_id = NULL,
      household_linked_at = NULL,
      -- Stop the same match from firing again immediately.
      household_link_declined_at = now()
  WHERE id = v_user;

  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, changes)
  VALUES (v_user, 'household_unlink', 'households', COALESCE(v_old, v_new),
          jsonb_build_object('new_household_id', v_new));

  RETURN jsonb_build_object('status', 'unlinked', 'household_id', v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.unlink_household() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unlink_household() TO authenticated;

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- no family record lost, every row has a household:
--   SELECT count(*) FILTER (WHERE household_id IS NULL) FROM public.household_members;  -- 0
--
--   -- has_children carried across faithfully:
--   SELECT count(*) FROM public.users u
--   JOIN public.households h ON h.id = u.household_id
--   WHERE u.has_children IS DISTINCT FROM h.has_children;  -- 0
--
--   -- as a normal user, only their own household's rows are visible:
--   SELECT public.current_household_id();
--   SELECT count(*) FROM public.household_members;
-- ============================================================
