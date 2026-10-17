-- ────────────────────────────────────────────────────────────
-- 249 — When each budget line is spent (daily / weekly plan)
--
-- A budget line can say WHEN its money goes out, so the Hub can turn the
-- whole budget into a plan for every day and week of the outreach and
-- compare it with what was actually spent:
--
--   plan_kind 'trip'  — spread evenly across the team's trip dates (default)
--   plan_kind 'range' — spread evenly from plan_start to plan_end
--                       (e.g. Destination A – Food, 28 Oct – 3 Nov)
--   plan_kind 'day'   — all on plan_start (e.g. Flights, 28 Oct)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.outreach_budget_lines
  ADD COLUMN IF NOT EXISTS plan_kind text NOT NULL DEFAULT 'trip',
  ADD COLUMN IF NOT EXISTS plan_start date,
  ADD COLUMN IF NOT EXISTS plan_end date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outreach_budget_lines_plan_check') THEN
    ALTER TABLE public.outreach_budget_lines
      ADD CONSTRAINT outreach_budget_lines_plan_check CHECK (
        (plan_kind = 'trip')
        OR (plan_kind = 'day' AND plan_start IS NOT NULL)
        OR (plan_kind = 'range' AND plan_start IS NOT NULL AND plan_end IS NOT NULL AND plan_end >= plan_start)
      );
  END IF;
END $$;
