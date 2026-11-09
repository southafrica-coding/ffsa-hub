-- 315_users_self_update_lockdown.sql
--
-- Stop signed-in users from rewriting privileged columns on their own
-- public.users row.
--
-- Before this migration anon and authenticated held table-wide INSERT,
-- UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on public.users, and the
-- "Users can update own user record" policy (id = auth.uid()) had no column
-- limits. With the public anon key and their own JWT, any signed-in user
-- could PATCH /rest/v1/users?id=eq.<self> and set, for example:
--   is_active = true          undo an admin deactivation (middleware reads it)
--   department = 'leadership_team'
--                             trg_sync_staff_department_ministry adds them to
--                             that ministry, and staff_ministry_members_
--                             leadership_role then grants the unscoped
--                             leadership_team ROLE (OKR cycles, staff
--                             acceptance decisions)
--   contact_id = <any contact> read that contact (and its emails, phones,
--                             tags, attendance, registrations) through
--                             get_my_contact_id(), and their tickets through
--                             /api/mobile/my-tickets (service-role read)
--   household_id / pending_household_id
--                             join another household via current_household_id()
--   base_driving_test_status = 'passed', licence_* fields
--                             skip the vehicle-approval checks
--   licence_file_url / passport_file_url = another user's storage path
--                             the profile routes sign it with the service role
--   signup_type, email, job_title, job_description, slack_*, merged_*, ...
--
-- Design
--   1. anon: no write privileges at all (SELECT stays; RLS returns nothing).
--   2. authenticated: no INSERT/DELETE/TRUNCATE/REFERENCES/TRIGGER, no
--      table-wide UPDATE. Every users row is created by the service role
--      (api/public/signup, api/admin/invite-user, api/admin/accept-application;
--      pg_stat_statements on prod shows only service_role inserting) and there
--      is no trigger on auth.users. The admin-only INSERT policy "Admins can
--      insert users" is dropped: with no INSERT grant it is dead, and dropping
--      it keeps the table fail-closed (RLS denies inserts) if a grant is ever
--      restored by mistake.
--   3. authenticated gets column UPDATE on the union of
--        (a) columns users edit about themselves through the user client
--            (profile, onboarding, insurance, CV essence, onboarding finish),
--        (b) columns admins write about others through the user client
--            (approve-user: job_title, status).
--      Every other column (is_active, contact_id, household ids, department
--      is in (a) but guarded, driving test, licence, passport files, Slack,
--      merge, email, signup_type, timestamps) can only be written by the
--      service role or by SECURITY DEFINER functions.
--   4. Column grants cannot tell an admin from a self-editor (both are
--      `authenticated`), so a BEFORE UPDATE trigger enforces the rest for
--      API sessions (current_user authenticated/anon):
--        - a deactivated caller may not change any users row;
--        - an active admin (is_admin()) may change anything the grant allows;
--        - anyone else may only change the self-edit columns on their own
--          row, plus: department -> NULL or a main staff ministry other
--          than leadership_team, and only if they are staff;
--          status -> 'active' unless it was 'pending_approval';
--          accepted_at only while it is still NULL.
--      SECURITY DEFINER functions (confirm_household_link, ensure_household,
--      unlink_household, decline_household_link, link_household_on_signup,
--      merge_users) run as their owner, so current_user is not
--      authenticated and they are not affected. Neither is the service role.
--
-- Idempotent: safe to run twice.

-- 1. anon: no writes ----------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.users FROM anon;

-- 2. authenticated: no table-wide writes ----------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.users FROM authenticated;

-- Dead without the INSERT grant; dropped so a stray re-grant stays denied.
DROP POLICY IF EXISTS "Admins can insert users" ON public.users;

-- Clear any column-level UPDATE left from an earlier run or a hand grant,
-- so the allowlist below is the whole story.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT a.attname
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.users'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE UPDATE (%I) ON TABLE public.users FROM authenticated, anon', c.attname);
  END LOOP;
END $$;

-- 3. Column allowlist ------------------------------------------------------
GRANT UPDATE (
  -- (a) self-edit: /api/profile/update, onboarding wizard, insurance routes
  first_name, last_name, preferred_name, date_of_birth, gender,
  marital_status, nationality, phone,
  address_line_1, address_line_2, city, province, country, postal_code,
  emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  health_insurance_provider, health_insurance_policy_number,
  health_insurance_expiry_date, health_insurance_no_expiry,
  health_insurance_confirmed_at,
  next_health_insurance_provider, next_health_insurance_policy_number,
  next_health_insurance_expiry_date, next_health_insurance_no_expiry,
  passport_country, passport_number, passport_expiry_date,
  visa_category, visa_type, visa_expiry_date, is_international,
  essence_statement,
  -- (a) self-edit, guarded by the trigger below
  department,            -- /api/profile/update
  accepted_at, status,   -- POST /api/onboarding/complete (completeOnboarding)
  -- (b) admin edits through the user client: /api/admin/approve-user
  job_title
) ON TABLE public.users TO authenticated;

-- 4. Guard trigger ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.users_guard_privileged_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_active  boolean;
  v_changed text[];
  v_bad     text[];
  -- Columns a person may change on their own row with no further check.
  v_self constant text[] := ARRAY[
    'first_name', 'last_name', 'preferred_name', 'date_of_birth', 'gender',
    'marital_status', 'nationality', 'phone',
    'address_line_1', 'address_line_2', 'city', 'province', 'country', 'postal_code',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
    'health_insurance_provider', 'health_insurance_policy_number',
    'health_insurance_expiry_date', 'health_insurance_no_expiry',
    'health_insurance_confirmed_at',
    'next_health_insurance_provider', 'next_health_insurance_policy_number',
    'next_health_insurance_expiry_date', 'next_health_insurance_no_expiry',
    'passport_country', 'passport_number', 'passport_expiry_date',
    'visa_category', 'visa_type', 'visa_expiry_date', 'is_international',
    'essence_statement'
  ];
BEGIN
  -- Department: whitespace-only is stored as NULL, and real values are
  -- trimmed, for every caller (admins, self-edits, the service role), before
  -- the change set and the slug check below.
  IF NEW.department IS NOT NULL THEN
    NEW.department := nullif(btrim(NEW.department, E' \t\n\r\f\x0B\u00a0'), '');
  END IF;

  -- Only API sessions are checked. The service role, the SQL editor, cron
  -- and SECURITY DEFINER functions owned by postgres run as another role.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to change an account.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}')
    INTO v_changed
  FROM jsonb_each(to_jsonb(NEW)) AS n
  JOIN jsonb_each(to_jsonb(OLD)) AS o USING (key)
  WHERE n.value IS DISTINCT FROM o.value
    AND n.key <> 'updated_at';

  IF cardinality(v_changed) = 0 THEN
    RETURN NEW;
  END IF;

  -- A deactivated account changes nothing, its own row included.
  SELECT u.is_active INTO v_active FROM public.users AS u WHERE u.id = v_uid;
  IF v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'This account is deactivated.' USING ERRCODE = '42501';
  END IF;

  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM v_uid OR OLD.id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You can only change your own account.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(c ORDER BY c), '{}') INTO v_bad
  FROM unnest(v_changed) AS c
  WHERE c <> ALL (v_self)
    AND c NOT IN ('department', 'status', 'accepted_at');

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'Only an admin can change % on an account.', array_to_string(v_bad, ', ')
      USING ERRCODE = '42501';
  END IF;

  -- Department: the same rule as /api/profile/update (a main ministry, never
  -- a part-time one), plus: staff only, and never leadership_team, whose
  -- membership grants the leadership_team role.
  IF 'department' = ANY (v_changed) AND NEW.department IS NOT NULL THEN
    IF NOT (public.has_any_role(ARRAY['staff']) OR OLD.signup_type IS NOT DISTINCT FROM 'staff') THEN
      RAISE EXCEPTION 'Only staff choose a department.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.staff_ministries AS sm
      WHERE sm.slug = NEW.department
        AND sm.ministry_type = 'main'
        AND sm.slug <> 'leadership_team'
    ) THEN
      RAISE EXCEPTION 'Only an admin can set the department %.', NEW.department
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Status: finishing onboarding sets 'active'; a hold stays a hold.
  IF 'status' = ANY (v_changed)
     AND NOT (NEW.status IS NOT DISTINCT FROM 'active' AND OLD.status IS DISTINCT FROM 'pending_approval') THEN
    RAISE EXCEPTION 'Only an admin can change the account status.' USING ERRCODE = '42501';
  END IF;

  -- accepted_at: stamped once, when onboarding finishes.
  IF 'accepted_at' = ANY (v_changed) AND OLD.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only an admin can change accepted_at.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.users_guard_privileged_self_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_guard_privileged_self_update ON public.users;
CREATE TRIGGER users_guard_privileged_self_update
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_guard_privileged_self_update();

COMMENT ON FUNCTION public.users_guard_privileged_self_update() IS
  '315: trims department (blank -> NULL) for every caller. API sessions may only change their own self-edit columns; admins (active) may change any granted column; deactivated callers change nothing. Service role and SECURITY DEFINER functions are not otherwise checked.';
