-- ────────────────────────────────────────────────────────────
-- 263 — Outreach cash, exact to the cent, pull by pull
--
-- Each ATM pull (outreach_cash_batches) is a batch with its own price:
--
--   zar_withdrawn  everything that left the account for this pull (rand)
--   bank_fee       the part the bank showed as a fee (rand), if it did
--   local_currency_received   the cash in hand afterwards
--
--   cost of the cash = zar_withdrawn − bank_fee
--   rate             = local_currency_received / cost   (local per rand)
--
-- Nobody types the rate any more; it's worked out here.
--
-- A separate bank fee becomes its own expense in Bank Costs, so every
-- rand that left the account lands somewhere.
--
-- Cash spending in a foreign currency is charged to pulls OLDEST FIRST
-- (outreach_cash_allocations). An expense bigger than what's left of a
-- pull is split across pulls. The spend that empties a pull takes exactly
-- the rand that pull has left, so each pull's cost is used to the cent —
-- no rounding is ever left over. Cash spent beyond every pull is recorded
-- with batch_id NULL ("not covered by a pull") so the team page can flag it.
--
-- The allocation is rebuilt for a team + currency whenever one of its
-- cash expenses or pulls changes — from the Hub, an import or Slack — so
-- an edit to an old expense re-prices everything after it correctly.
-- ZAR cash isn't converted, so it isn't allocated.
-- ────────────────────────────────────────────────────────────

-- ── Precision ───────────────────────────────────────────────
-- (12,6) loses cents on strong currencies (0.054321 USD per rand).
ALTER TABLE public.outreach_cash_batches ALTER COLUMN exchange_rate TYPE numeric(20,10);
ALTER TABLE public.outreach_expenses     ALTER COLUMN exchange_rate TYPE numeric(20,10);

-- The old cash-pull form took the currency as free text.
UPDATE public.outreach_cash_batches SET local_currency = 'SZL' WHERE local_currency = 'Eswatini';

ALTER TABLE public.outreach_cash_batches
  DROP CONSTRAINT IF EXISTS outreach_cash_batches_fee_within_total;
ALTER TABLE public.outreach_cash_batches
  ADD CONSTRAINT outreach_cash_batches_fee_within_total
  CHECK (bank_fee >= 0 AND bank_fee <= zar_withdrawn);

-- A screenshot of the bank notification, when they have one.
ALTER TABLE public.outreach_cash_batches ADD COLUMN IF NOT EXISTS proof_path text;

-- The fee expense a pull created (deleted with the pull).
ALTER TABLE public.outreach_expenses
  ADD COLUMN IF NOT EXISTS fee_for_batch_id uuid
  REFERENCES public.outreach_cash_batches(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_oe_fee_for_batch
  ON public.outreach_expenses(fee_for_batch_id) WHERE fee_for_batch_id IS NOT NULL;

-- ── Allocations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outreach_cash_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid NOT NULL REFERENCES public.outreach_teams(id) ON DELETE CASCADE,
  expense_id      uuid NOT NULL REFERENCES public.outreach_expenses(id) ON DELETE CASCADE,
  batch_id        uuid REFERENCES public.outreach_cash_batches(id) ON DELETE CASCADE, -- NULL: no pull covers it
  local_currency  text NOT NULL,
  local_amount    numeric(14,2) NOT NULL,
  zar_amount      numeric(14,2) NOT NULL,
  seq             integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oca_team ON public.outreach_cash_allocations(team_id, local_currency, seq);
CREATE INDEX IF NOT EXISTS idx_oca_expense ON public.outreach_cash_allocations(expense_id);
CREATE INDEX IF NOT EXISTS idx_oca_batch ON public.outreach_cash_allocations(batch_id);

ALTER TABLE public.outreach_cash_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read cash allocations" ON public.outreach_cash_allocations;
CREATE POLICY "Read cash allocations" ON public.outreach_cash_allocations FOR SELECT
  USING (public.is_outreach_staff_viewer() OR public.is_outreach_leader(team_id));
-- Written only by reallocate_outreach_cash().

-- ── The oldest-first engine ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.reallocate_outreach_cash(p_team uuid, p_currency text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b_ids    uuid[];
  b_local  numeric[];  -- cash left in each pull
  b_zar    numeric[];  -- rand left in each pull
  n        integer;
  i        integer := 1;
  last_rate numeric;   -- rand per unit of the newest pull, for spending no pull covers
  e        record;
  need     numeric;
  take     numeric;
  z        numeric;
  e_zar    numeric;
  first_b  uuid;
  s        integer := 0;
BEGIN
  IF p_team IS NULL OR p_currency IS NULL OR p_currency = 'ZAR' THEN
    RETURN;
  END IF;
  -- One rebuild at a time per team + currency.
  PERFORM pg_advisory_xact_lock(hashtext('outreach_cash:' || p_team::text || ':' || p_currency));
  -- The updates below fire the expense trigger; this tells it not to
  -- start a second rebuild in the middle of this one.
  PERFORM set_config('outreach.reallocating', 'on', true);

  DELETE FROM outreach_cash_allocations WHERE team_id = p_team AND local_currency = p_currency;

  SELECT array_agg(id ORDER BY batch_date, created_at, id),
         array_agg(local_currency_received ORDER BY batch_date, created_at, id),
         array_agg(zar_withdrawn - bank_fee ORDER BY batch_date, created_at, id)
    INTO b_ids, b_local, b_zar
  FROM outreach_cash_batches
  WHERE team_id = p_team AND local_currency = p_currency
    AND local_currency_received > 0 AND zar_withdrawn - bank_fee > 0;
  n := coalesce(array_length(b_ids, 1), 0);
  IF n > 0 THEN
    last_rate := b_zar[n] / b_local[n];
  END IF;

  FOR e IN
    SELECT id, local_amount, zar_amount
    FROM outreach_expenses
    WHERE team_id = p_team AND local_currency = p_currency AND payment_method = 'cash'
      AND local_amount > 0
    ORDER BY expense_date, created_at, id
  LOOP
    need := e.local_amount;
    e_zar := 0;
    first_b := NULL;

    WHILE need > 0 AND i <= n LOOP
      take := least(need, b_local[i]);
      IF take = b_local[i] THEN
        z := b_zar[i];                                -- empties the pull: all its rand
      ELSE
        z := round(take * b_zar[i] / b_local[i], 2);  -- share of what's left
      END IF;
      s := s + 1;
      INSERT INTO outreach_cash_allocations (team_id, expense_id, batch_id, local_currency, local_amount, zar_amount, seq)
      VALUES (p_team, e.id, b_ids[i], p_currency, take, z, s);
      first_b := coalesce(first_b, b_ids[i]);
      b_local[i] := b_local[i] - take;
      b_zar[i]   := b_zar[i] - z;
      need  := need - take;
      e_zar := e_zar + z;
      IF b_local[i] <= 0 THEN
        i := i + 1;
      END IF;
    END LOOP;

    IF need > 0 THEN
      -- More cash spent than was pulled: priced at the newest pull's rate
      -- (or as entered when there's no pull at all) and flagged.
      z := CASE
             WHEN last_rate IS NOT NULL THEN round(need * last_rate, 2)
             ELSE round(e.zar_amount * need / e.local_amount, 2)
           END;
      s := s + 1;
      INSERT INTO outreach_cash_allocations (team_id, expense_id, batch_id, local_currency, local_amount, zar_amount, seq)
      VALUES (p_team, e.id, NULL, p_currency, need, z, s);
      e_zar := e_zar + z;
    END IF;

    UPDATE outreach_expenses
    SET zar_amount    = e_zar,
        exchange_rate = CASE WHEN e_zar > 0 THEN round(local_amount / e_zar, 10) ELSE exchange_rate END,
        cash_batch_id = first_b,
        updated_at    = now()
    WHERE id = e.id
      AND (zar_amount IS DISTINCT FROM e_zar OR cash_batch_id IS DISTINCT FROM first_b);
  END LOOP;

  PERFORM set_config('outreach.reallocating', 'off', true);
END;
$$;

-- Only the triggers below run it.
REVOKE EXECUTE ON FUNCTION public.reallocate_outreach_cash(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── Expenses changed → rebuild their currency ───────────────
CREATE OR REPLACE FUNCTION public.outreach_expense_cash_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The engine's own updates land here; they must not start another rebuild.
  IF current_setting('outreach.reallocating', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.payment_method = 'cash' THEN
    PERFORM public.reallocate_outreach_cash(OLD.team_id, OLD.local_currency);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.payment_method = 'cash'
     AND (TG_OP = 'INSERT' OR NEW.team_id IS DISTINCT FROM OLD.team_id
          OR NEW.local_currency IS DISTINCT FROM OLD.local_currency
          OR OLD.payment_method IS DISTINCT FROM 'cash') THEN
    PERFORM public.reallocate_outreach_cash(NEW.team_id, NEW.local_currency);
  ELSIF TG_OP = 'UPDATE' AND NEW.payment_method = 'cash' THEN
    -- Same team + currency: only rebuild if something the engine reads moved.
    IF NEW.local_amount IS DISTINCT FROM OLD.local_amount
       OR NEW.expense_date IS DISTINCT FROM OLD.expense_date
       OR NEW.zar_amount IS DISTINCT FROM OLD.zar_amount THEN
      PERFORM public.reallocate_outreach_cash(NEW.team_id, NEW.local_currency);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_oe_cash_alloc ON public.outreach_expenses;
CREATE TRIGGER trg_oe_cash_alloc
  AFTER INSERT OR UPDATE OR DELETE ON public.outreach_expenses
  FOR EACH ROW EXECUTE FUNCTION public.outreach_expense_cash_changed();

-- ── Pulls: worked-out rate, fee expense, rebuild ────────────
CREATE OR REPLACE FUNCTION public.outreach_cash_batch_rate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.local_currency := upper(trim(NEW.local_currency));
  IF NEW.local_currency_received > 0 AND NEW.zar_withdrawn - NEW.bank_fee > 0 THEN
    NEW.exchange_rate := round(NEW.local_currency_received / (NEW.zar_withdrawn - NEW.bank_fee), 10);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ocb_rate ON public.outreach_cash_batches;
CREATE TRIGGER trg_ocb_rate
  BEFORE INSERT OR UPDATE ON public.outreach_cash_batches
  FOR EACH ROW EXECUTE FUNCTION public.outreach_cash_batch_rate();

CREATE OR REPLACE FUNCTION public.outreach_cash_batch_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat uuid;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.bank_fee > 0 THEN
      SELECT id INTO v_cat FROM outreach_budget_categories WHERE slug = 'bank-costs' LIMIT 1;
      IF v_cat IS NULL THEN
        INSERT INTO outreach_budget_categories (name, slug, is_default, sort_order)
        VALUES ('Bank Costs', 'bank-costs', true, 14)
        RETURNING id INTO v_cat;
      END IF;
      INSERT INTO outreach_expenses (
        team_id, category_id, expense_date, vendor, description, payment_method,
        local_currency, local_amount, zar_amount, exchange_rate, notes, created_by, fee_for_batch_id
      ) VALUES (
        NEW.team_id, v_cat, NEW.batch_date, 'Bank',
        'Bank fee — cash pull of ' || NEW.local_currency_received || ' ' || NEW.local_currency,
        'card', 'ZAR', NEW.bank_fee, NEW.bank_fee, 1,
        'Added from the cash pull. Change the pull to change this.', NEW.created_by, NEW.id
      )
      ON CONFLICT (fee_for_batch_id) WHERE fee_for_batch_id IS NOT NULL DO UPDATE
      SET expense_date = EXCLUDED.expense_date,
          description  = EXCLUDED.description,
          local_amount = EXCLUDED.local_amount,
          zar_amount   = EXCLUDED.zar_amount,
          updated_at   = now();
    ELSE
      DELETE FROM outreach_expenses WHERE fee_for_batch_id = NEW.id;
    END IF;
    PERFORM public.reallocate_outreach_cash(NEW.team_id, NEW.local_currency);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND (TG_OP = 'DELETE' OR OLD.team_id IS DISTINCT FROM NEW.team_id
          OR OLD.local_currency IS DISTINCT FROM NEW.local_currency) THEN
    PERFORM public.reallocate_outreach_cash(OLD.team_id, OLD.local_currency);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ocb_changed ON public.outreach_cash_batches;
CREATE TRIGGER trg_ocb_changed
  AFTER INSERT OR UPDATE OR DELETE ON public.outreach_cash_batches
  FOR EACH ROW EXECUTE FUNCTION public.outreach_cash_batch_changed();

-- ── Bring what's already there into line ────────────────────
UPDATE public.outreach_cash_batches SET updated_at = updated_at;  -- re-runs the rate trigger

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT team_id, local_currency FROM public.outreach_expenses
    WHERE payment_method = 'cash' AND local_currency <> 'ZAR'
    UNION
    SELECT DISTINCT team_id, local_currency FROM public.outreach_cash_batches WHERE local_currency <> 'ZAR'
  LOOP
    PERFORM public.reallocate_outreach_cash(r.team_id, r.local_currency);
  END LOOP;
END;
$$;
