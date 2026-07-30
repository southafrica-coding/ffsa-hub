-- ============================================================
-- FFSA Hub — Migration 150: Stop insurance history from duplicating
-- ============================================================
-- Migration 130 snapshots a NEW row into user_insurance_policies on
-- every change to the insurance triple (provider / policy number /
-- expiry). That preserves a genuinely new policy on renewal, but it also
-- appends a new row when someone merely corrects the expiry date of the
-- SAME policy — so a single policy accumulates several near-identical
-- "policies on record".
--
-- This migration rewrites the snapshot trigger so history is one row PER
-- POLICY NUMBER: editing the same policy number UPDATES that record in
-- place; a new policy number still INSERTs a new record (the original
-- renewal intent is preserved). Blank policy numbers keep the legacy
-- append behaviour.
--
-- It is intentionally NON-destructive: it does not delete or rewrite any
-- existing rows, and it adds no table-wide unique index (which could
-- clash with other users' pre-existing duplicates). Cleaning up any
-- historical duplicates is a separate, per-user operation.
-- No application or generated-type changes: columns are unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_insurance_policy_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy text := nullif(btrim(NEW.health_insurance_policy_number), '');
BEGIN
  -- Nothing to record without a real provider + an expiry date.
  IF NEW.health_insurance_provider IS NULL
     OR btrim(NEW.health_insurance_provider) = ''
     OR lower(btrim(NEW.health_insurance_provider)) = 'none'
     OR NEW.health_insurance_expiry_date IS NULL THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only act when one of the three columns actually changed.
  IF TG_OP = 'UPDATE'
     AND NEW.health_insurance_provider      IS NOT DISTINCT FROM OLD.health_insurance_provider
     AND NEW.health_insurance_policy_number IS NOT DISTINCT FROM OLD.health_insurance_policy_number
     AND NEW.health_insurance_expiry_date   IS NOT DISTINCT FROM OLD.health_insurance_expiry_date THEN
    RETURN NEW;
  END IF;

  IF v_policy IS NULL THEN
    -- No policy number to key on: append (legacy behaviour).
    INSERT INTO public.user_insurance_policies
      (user_id, provider, policy_number, expiry_date)
    VALUES
      (NEW.id, NEW.health_insurance_provider, NULL, NEW.health_insurance_expiry_date);
  ELSE
    -- One record per policy number: update it in place if it exists,
    -- otherwise insert. Avoids a table-wide unique index so pre-existing
    -- duplicates for other users don't block this migration.
    UPDATE public.user_insurance_policies
       SET provider    = NEW.health_insurance_provider,
           expiry_date = NEW.health_insurance_expiry_date,
           recorded_at = now()
     WHERE user_id = NEW.id
       AND policy_number = v_policy;

    IF NOT FOUND THEN
      INSERT INTO public.user_insurance_policies
        (user_id, provider, policy_number, expiry_date)
      VALUES
        (NEW.id, NEW.health_insurance_provider, v_policy, NEW.health_insurance_expiry_date);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger definition itself is unchanged (still fires AFTER INSERT OR
-- UPDATE OF the three insurance columns), so no need to recreate it.

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- Editing the SAME policy's expiry updates in place (no new row);
--   -- entering a NEW policy number adds a second row.
--
--   -- Per-user cleanup of historical duplicates (run manually, scoped to
--   -- one user) — keep the row matching the user's current expiry, else
--   -- the most recently recorded:
--   --   WITH ranked AS (
--   --     SELECT p.id, row_number() OVER (
--   --       PARTITION BY p.policy_number
--   --       ORDER BY (p.expiry_date IS NOT DISTINCT FROM u.health_insurance_expiry_date) DESC,
--   --                p.recorded_at DESC, p.expiry_date DESC) rn
--   --     FROM public.user_insurance_policies p
--   --     JOIN public.users u ON u.id = p.user_id
--   --     WHERE p.user_id = '<uuid>' AND p.policy_number IS NOT NULL)
--   --   DELETE FROM public.user_insurance_policies t USING ranked r
--   --   WHERE t.id = r.id AND r.rn > 1;
-- ============================================================
