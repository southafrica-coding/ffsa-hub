-- ============================================================
-- FFSA Hub — Migration 211: Open-ended ("no expiry") health insurance
-- ============================================================
-- South African medical schemes (Discovery, Bonitas, GEMS, Momentum,
-- Bestmed, Profmed …) are open-ended memberships with no expiry date.
-- Until now every insurance record had to carry one, so members either
-- invented a date or were eventually locked out by the profile gate for
-- a policy that had never actually lapsed.
--
-- A policy can now be flagged as never-expiring. Such a policy is always
-- valid — no expiry banner, no leader/dev-team alerts, no gate — but the
-- member must RE-CONFIRM once a year that it is still active
-- (health_insurance_confirmed_at).
--
-- The "listed scheme only" rule (never available for a free-text
-- "Other (specify)" provider) is enforced in the API layer, not here,
-- because the provider list is admin-editable at runtime via
-- public.list_options.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Live + queued policy on the user row
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS health_insurance_no_expiry      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS health_insurance_confirmed_at   date,
  ADD COLUMN IF NOT EXISTS next_health_insurance_no_expiry boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.health_insurance_no_expiry IS
  'Open-ended medical scheme membership: no expiry date. Mutually exclusive with health_insurance_expiry_date.';
COMMENT ON COLUMN public.users.health_insurance_confirmed_at IS
  'Date the member last confirmed an open-ended policy is still active. Re-confirmed annually.';

-- ────────────────────────────────────────────────────────────
-- 2. Household members mirror the insurance columns (migration 153)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS health_insurance_no_expiry boolean NOT NULL DEFAULT false;

-- ────────────────────────────────────────────────────────────
-- 3. History rows (migration 130) must hold an open-ended policy
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.user_insurance_policies
  ADD COLUMN IF NOT EXISTS no_expiry boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_insurance_policies
  ALTER COLUMN expiry_date DROP NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 4. Integrity — a policy has EITHER an expiry date OR the no-expiry
--    flag, never both. NOT VALID so any pre-existing odd row doesn't
--    block the deploy; every new/updated row is checked.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_insurance_expiry_shape;
ALTER TABLE public.users
  ADD CONSTRAINT users_insurance_expiry_shape
  CHECK (NOT health_insurance_no_expiry OR health_insurance_expiry_date IS NULL)
  NOT VALID;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_next_insurance_expiry_shape;
ALTER TABLE public.users
  ADD CONSTRAINT users_next_insurance_expiry_shape
  CHECK (NOT next_health_insurance_no_expiry OR next_health_insurance_expiry_date IS NULL)
  NOT VALID;

ALTER TABLE public.household_members DROP CONSTRAINT IF EXISTS household_members_insurance_expiry_shape;
ALTER TABLE public.household_members
  ADD CONSTRAINT household_members_insurance_expiry_shape
  CHECK (NOT health_insurance_no_expiry OR health_insurance_expiry_date IS NULL)
  NOT VALID;

-- ────────────────────────────────────────────────────────────
-- 5. Snapshot trigger (last defined in migration 150) — carry the flag
--    into history, treat a flag change as a policy change, and stop
--    bailing out when there is no expiry date but the flag is set.
--    health_insurance_confirmed_at is deliberately NOT watched, so an
--    annual re-confirmation never creates a history row.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_insurance_policy_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy    text    := nullif(btrim(NEW.health_insurance_policy_number), '');
  v_no_expiry boolean := COALESCE(NEW.health_insurance_no_expiry, false);
BEGIN
  -- Nothing to record without a real provider.
  IF NEW.health_insurance_provider IS NULL
     OR btrim(NEW.health_insurance_provider) = ''
     OR lower(btrim(NEW.health_insurance_provider)) = 'none' THEN
    RETURN NEW;
  END IF;

  -- …nor without either an expiry date or the no-expiry flag.
  IF NEW.health_insurance_expiry_date IS NULL AND NOT v_no_expiry THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only act when one of the four columns actually changed.
  IF TG_OP = 'UPDATE'
     AND NEW.health_insurance_provider      IS NOT DISTINCT FROM OLD.health_insurance_provider
     AND NEW.health_insurance_policy_number IS NOT DISTINCT FROM OLD.health_insurance_policy_number
     AND NEW.health_insurance_expiry_date   IS NOT DISTINCT FROM OLD.health_insurance_expiry_date
     AND NEW.health_insurance_no_expiry     IS NOT DISTINCT FROM OLD.health_insurance_no_expiry THEN
    RETURN NEW;
  END IF;

  IF v_policy IS NULL THEN
    -- No policy number to key on: append (legacy behaviour).
    INSERT INTO public.user_insurance_policies
      (user_id, provider, policy_number, expiry_date, no_expiry)
    VALUES
      (NEW.id, NEW.health_insurance_provider, NULL,
       NEW.health_insurance_expiry_date, v_no_expiry);
  ELSE
    -- One record per policy number: update in place if it exists.
    UPDATE public.user_insurance_policies
       SET provider    = NEW.health_insurance_provider,
           expiry_date = NEW.health_insurance_expiry_date,
           no_expiry   = v_no_expiry,
           recorded_at = now()
     WHERE user_id = NEW.id
       AND policy_number = v_policy;

    IF NOT FOUND THEN
      INSERT INTO public.user_insurance_policies
        (user_id, provider, policy_number, expiry_date, no_expiry)
      VALUES
        (NEW.id, NEW.health_insurance_provider, v_policy,
         NEW.health_insurance_expiry_date, v_no_expiry);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- The trigger must also fire on the new column.
DROP TRIGGER IF EXISTS trg_record_insurance_policy_history ON public.users;
CREATE TRIGGER trg_record_insurance_policy_history
  AFTER INSERT OR UPDATE OF
    health_insurance_provider,
    health_insurance_policy_number,
    health_insurance_expiry_date,
    health_insurance_no_expiry
  ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.record_insurance_policy_history();

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- A flag flip records a dateless history row:
--   UPDATE public.users
--      SET health_insurance_no_expiry = true,
--          health_insurance_expiry_date = NULL,
--          health_insurance_confirmed_at = current_date
--    WHERE id = '<uuid>';
--   SELECT provider, policy_number, expiry_date, no_expiry
--     FROM public.user_insurance_policies WHERE user_id = '<uuid>';
--
--   -- Flag + date together is rejected:
--   UPDATE public.users SET health_insurance_no_expiry = true,
--          health_insurance_expiry_date = '2027-01-01' WHERE id = '<uuid>';
--   -- expect: violates check constraint "users_insurance_expiry_shape"
--
--   -- Confirming does NOT create a history row:
--   UPDATE public.users SET health_insurance_confirmed_at = current_date
--    WHERE id = '<uuid>';
-- ============================================================
