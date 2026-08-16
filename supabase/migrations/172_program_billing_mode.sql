-- ============================================================
-- FFSA Hub — Migration 172: billing_mode + schedule_start_date
-- Billing, STEP 9a. See docs/redesign/09-going-live.md and 10-billing-reconciliation.md
-- ============================================================
-- Two schools are running right now and were never billed through the Hub. The
-- billing engine (migration 095) is already applied, so without a switch there
-- is nothing standing between those students and a generated invoice.
--
-- This is that switch, and it is deliberately the FIRST thing built:
--
--   external        Hub does nothing. No schedules, no generation, no runs, no
--                   reminders. Xero stays the only record. Fee surfaces say so
--                   plainly rather than showing zeros, which read as "paid".
--   hub_scheduled   Everything in 07-finance-billing.md.
--
-- NEW programs default to hub_scheduled. EVERY program that exists today is set
-- to external by this migration — the safe direction, and reversible one row at
-- a time when a school is ready.
--
-- schedule_start_date is the middle path for a school with months left: build
-- charges due on or after that date, treat everything before it as history, and
-- never generate, email or chase anything dated earlier.
-- ============================================================

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'hub_scheduled'
    CHECK (billing_mode IN ('external', 'hub_scheduled')),
  ADD COLUMN IF NOT EXISTS schedule_start_date date,
  -- Separate from billing_mode on purpose: a school can be fully scheduled and
  -- still have sending held while someone reads one generated invoice end to
  -- end. "It is the difference between a mistake being a mistake and a mistake
  -- being 24 emails."
  ADD COLUMN IF NOT EXISTS billing_emails_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.programs.billing_mode IS
  'external = the Hub bills nothing for this school (Xero is the only record). hub_scheduled = full Hub scheduling. Every finance surface must filter on this.';
COMMENT ON COLUMN public.programs.schedule_start_date IS
  'Partial adoption: build and chase only charges due on or after this date. Everything before it is history — represented as a single opening-balance charge, or not at all.';
COMMENT ON COLUMN public.programs.billing_emails_enabled IS
  'Per-school hold on outbound billing email. Off by default, including for hub_scheduled schools, until someone has read a real generated invoice end to end.';

-- Everything that exists today predates Hub billing. Opt them all out; opting a
-- school back IN is a deliberate, one-row act.
UPDATE public.programs
   SET billing_mode = 'external'
 WHERE billing_mode <> 'external';

CREATE INDEX IF NOT EXISTS idx_programs_billing_mode
  ON public.programs (billing_mode) WHERE billing_mode = 'hub_scheduled';

-- ------------------------------------------------------------
-- Is this school billed through the Hub at all?
-- One definition, so no screen can drift from the others.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.program_is_hub_billed(target_program uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT p.billing_mode = 'hub_scheduled'
       FROM public.programs p WHERE p.id = target_program),
    false
  );
$$;

COMMENT ON FUNCTION public.program_is_hub_billed(uuid) IS
  'True only when the school is on hub_scheduled. Defaults to false for an unknown program — a run must never treat a missing school as billable.';

-- ------------------------------------------------------------
-- Belt and braces: refuse to write a schedule row for a school the Hub does
-- not bill. The UI filters too, but a stray script, an old tab or a future
-- caller should not be able to schedule money against a school that opted out.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_schedule_for_external_program()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prog uuid;
BEGIN
  SELECT pl.program_id INTO prog
    FROM public.student_billing_plans pl
   WHERE pl.id = NEW.plan_id;

  IF prog IS NOT NULL AND NOT public.program_is_hub_billed(prog) THEN
    RAISE EXCEPTION
      'This school is not billed through the Hub (billing_mode = external). Switch it to hub_scheduled before scheduling charges.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_schedule_for_external ON public.student_billing_schedule;
CREATE TRIGGER trg_block_schedule_for_external
  BEFORE INSERT ON public.student_billing_schedule
  FOR EACH ROW EXECUTE FUNCTION public.block_schedule_for_external_program();

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- 1. Every existing school is opted out:
--   SELECT billing_mode, count(*) FROM public.programs GROUP BY billing_mode;
--   -- expect: external = all of them, hub_scheduled = 0
--
--   -- 2. Nothing is already scheduled against an external school:
--   SELECT count(*) FROM public.student_billing_schedule s
--     JOIN public.student_billing_plans pl ON pl.id = s.plan_id
--    WHERE NOT public.program_is_hub_billed(pl.program_id);
--   -- any rows here are pre-existing and want a look before you switch anything on
--
--   -- 3. Turning ONE school on, when you are ready:
--   -- UPDATE public.programs
--   --    SET billing_mode = 'hub_scheduled',
--   --        schedule_start_date = '2026-09-01'   -- omit for a school starting fresh
--   --  WHERE code = 'FFBX26';
--   -- Email stays held until you also set billing_emails_enabled = true.
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_block_schedule_for_external ON public.student_billing_schedule;
--   DROP FUNCTION IF EXISTS public.block_schedule_for_external_program();
--   DROP FUNCTION IF EXISTS public.program_is_hub_billed(uuid);
--   ALTER TABLE public.programs
--     DROP COLUMN IF EXISTS billing_mode,
--     DROP COLUMN IF EXISTS schedule_start_date,
--     DROP COLUMN IF EXISTS billing_emails_enabled;
-- ------------------------------------------------------------
