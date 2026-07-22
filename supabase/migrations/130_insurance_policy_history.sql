-- ============================================================
-- FFSA Hub — Migration 130: Health insurance policy history
-- ============================================================
-- Staff must renew their health insurance BEFORE it expires (provider,
-- policy number and expiry can all change) and keep the OLD policy on
-- record rather than silently overwriting it.
--
-- The current policy still lives on public.users
-- (health_insurance_provider / _policy_number / _expiry_date) so the
-- profile-completion gate, expiry banner, admin badges and
-- getInsuranceStatus() keep working unchanged. This migration adds an
-- append-only history table plus a trigger that snapshots the current
-- policy into it whenever the insurance columns change — so EVERY write
-- path (profile update route, onboarding, admin edits, completion form)
-- records history with no application code changes.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. History table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_insurance_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  provider      text NOT NULL,
  policy_number text,
  expiry_date   date NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_insurance_policies_user_idx
  ON public.user_insurance_policies (user_id, expiry_date DESC);

-- ────────────────────────────────────────────────────────────
-- 2. Snapshot trigger — record a row whenever the insurance triple
--    changes to a real policy. IS DISTINCT FROM so unrelated users
--    updates don't create duplicate history; provider must be a real
--    value (empty / legacy "none" are not policies).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_insurance_policy_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Nothing to record without a real provider + an expiry date.
  IF NEW.health_insurance_provider IS NULL
     OR btrim(NEW.health_insurance_provider) = ''
     OR lower(btrim(NEW.health_insurance_provider)) = 'none'
     OR NEW.health_insurance_expiry_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only snapshot when one of the three columns actually changed.
  IF TG_OP = 'UPDATE'
     AND NEW.health_insurance_provider      IS NOT DISTINCT FROM OLD.health_insurance_provider
     AND NEW.health_insurance_policy_number IS NOT DISTINCT FROM OLD.health_insurance_policy_number
     AND NEW.health_insurance_expiry_date   IS NOT DISTINCT FROM OLD.health_insurance_expiry_date THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_insurance_policies
    (user_id, provider, policy_number, expiry_date)
  VALUES
    (NEW.id,
     NEW.health_insurance_provider,
     NEW.health_insurance_policy_number,
     NEW.health_insurance_expiry_date);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_insurance_policy_history ON public.users;
CREATE TRIGGER trg_record_insurance_policy_history
  AFTER INSERT OR UPDATE OF
    health_insurance_provider,
    health_insurance_policy_number,
    health_insurance_expiry_date
  ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.record_insurance_policy_history();

-- ────────────────────────────────────────────────────────────
-- 3. RLS — a user reads their own policy history; admins read all.
--    Writes happen only through the trigger (runs as the function
--    owner), so no INSERT policy is required.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.user_insurance_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own insurance history" ON public.user_insurance_policies;
CREATE POLICY "Users read own insurance history"
  ON public.user_insurance_policies FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

-- ────────────────────────────────────────────────────────────
-- 4. Backfill — seed history with each staff member's CURRENT policy
--    so the history view isn't empty for existing users.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.user_insurance_policies
  (user_id, provider, policy_number, expiry_date)
SELECT
  u.id,
  u.health_insurance_provider,
  u.health_insurance_policy_number,
  u.health_insurance_expiry_date
FROM public.users u
WHERE u.health_insurance_provider IS NOT NULL
  AND btrim(u.health_insurance_provider) <> ''
  AND lower(btrim(u.health_insurance_provider)) <> 'none'
  AND u.health_insurance_expiry_date IS NOT NULL;

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT count(*) FROM public.user_insurance_policies;
--   -- update a test user's insurance, then confirm a new row appears:
--   SELECT provider, policy_number, expiry_date, recorded_at
--     FROM public.user_insurance_policies
--    WHERE user_id = '<uuid>' ORDER BY recorded_at DESC;
--   -- update a NON-insurance column on that user → no new row.
-- ============================================================
