-- ============================================================
-- FFSA Hub — Migration 394: Missio Finance, the amounts entered by hand
-- ============================================================
-- DRAFT — DO NOT APPLY until Jack has reviewed PR "Missio Finance — live
-- income report". The page runs without it: cash and FundraiseUp show an
-- empty state and the entry form says it isn't switched on yet.
--
-- APPLY ORDER: after 329 (organisations, org_staff_roles, has_org_role_id).
-- Nothing else depends on it.
--
-- The Missio income report (/missio/finance) has four sources. Two come from
-- Xero (money into the Missio bank account, split into EFT & other and
-- SnapScan) and are never stored here. The other two aren't in the bank:
--
--   cash         cash collected, entered by a pastor as one rand amount per
--                month.
--   fundraiseup  FundraiseUp donations, which land in US dollars in a
--                separate account. v1: a pastor enters the month's dollars
--                after fees and the rate used; the rand amount is computed
--                from those two here (zar_cents, generated) so it can never
--                disagree with them. A FundraiseUp API connection is a later
--                step.
--
-- One row per org, source and month. Editing a month updates its row; every
-- insert, change and delete is written to missio_finance_entry_events (who,
-- when, before and after) by a trigger, so nothing changes silently.
--
-- Who: Missio pastors only (has_org_role_id(org_id, ['pastor'])). Leaders,
-- coaches and FFSA admins get nothing: an FFSA role is not a Missio role.
-- The audit table is read-only to pastors and written only by the trigger.
--
-- Only adds objects. Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE, and
-- triggers and policies are dropped by name before they are created.
-- No seed rows: amounts are entered in the Hub, never put in a migration.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. Entries
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.missio_finance_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  source        text NOT NULL CHECK (source IN ('cash', 'fundraiseup')),
  -- First day of the month the money belongs to.
  month         date NOT NULL CHECK (extract(day FROM month) = 1),
  -- cash: rand cents. NULL for fundraiseup.
  cash_cents    bigint CHECK (cash_cents IS NULL OR cash_cents >= 0),
  -- fundraiseup: dollars after fees, in cents, and rand per dollar.
  usd_cents     bigint CHECK (usd_cents IS NULL OR usd_cents >= 0),
  usd_zar_rate  numeric(12, 6) CHECK (usd_zar_rate IS NULL OR (usd_zar_rate > 0 AND usd_zar_rate < 1000)),
  -- Where the rate came from, in words ("Xero rate on the day", "average for the month").
  rate_note     text CHECK (rate_note IS NULL OR length(rate_note) <= 200),
  -- The rand amount the report uses. Generated, so it always matches the inputs.
  zar_cents     bigint GENERATED ALWAYS AS (
                  CASE WHEN source = 'cash' THEN cash_cents
                       ELSE round(usd_cents * usd_zar_rate)::bigint END
                ) STORED,
  note          text CHECK (note IS NULL OR length(note) <= 500),
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_finance_entries_shape CHECK (
    (source = 'cash' AND cash_cents IS NOT NULL AND usd_cents IS NULL AND usd_zar_rate IS NULL)
    OR
    (source = 'fundraiseup' AND cash_cents IS NULL AND usd_cents IS NOT NULL AND usd_zar_rate IS NOT NULL)
  ),
  CONSTRAINT missio_finance_entries_org_source_month_key UNIQUE (org_id, source, month)
);

CREATE INDEX IF NOT EXISTS missio_finance_entries_org_month_idx
  ON public.missio_finance_entries (org_id, month);

-- Who and when come from the session, never from the request. org_id never moves.
CREATE OR REPLACE FUNCTION public.missio_finance_entries_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := (SELECT auth.uid());
    NEW.created_at := now();
  ELSE
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'missio_finance_entry_org_fixed';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_by := (SELECT auth.uid());
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS missio_finance_entries_stamp ON public.missio_finance_entries;
CREATE TRIGGER missio_finance_entries_stamp
  BEFORE INSERT OR UPDATE ON public.missio_finance_entries
  FOR EACH ROW EXECUTE FUNCTION public.missio_finance_entries_stamp();


-- ────────────────────────────────────────────────────────────
-- 2. Audit trail
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.missio_finance_entry_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id   uuid NOT NULL,
  org_id     uuid NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  action     text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  actor_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  before     jsonb,
  after      jsonb
);

CREATE INDEX IF NOT EXISTS missio_finance_entry_events_entry_idx
  ON public.missio_finance_entry_events (entry_id, at);

-- SECURITY DEFINER: the audit table has no INSERT policy, so only this
-- trigger can write it.
CREATE OR REPLACE FUNCTION public.missio_finance_entries_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
BEGIN
  INSERT INTO public.missio_finance_entry_events (entry_id, org_id, action, actor_id, before, after)
  VALUES (
    coalesce(NEW.id, OLD.id),
    coalesce(NEW.org_id, OLD.org_id),
    lower(TG_OP),
    (SELECT auth.uid()),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN coalesce(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.missio_finance_entries_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS missio_finance_entries_audit ON public.missio_finance_entries;
CREATE TRIGGER missio_finance_entries_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.missio_finance_entries
  FOR EACH ROW EXECUTE FUNCTION public.missio_finance_entries_audit();


-- ────────────────────────────────────────────────────────────
-- 3. RLS — Missio pastors only; no anon; audit is read-only
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.missio_finance_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_finance_entry_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.missio_finance_entries      FROM anon;
REVOKE ALL ON public.missio_finance_entry_events FROM anon;

DROP POLICY IF EXISTS "Missio pastors read finance entries" ON public.missio_finance_entries;
CREATE POLICY "Missio pastors read finance entries"
  ON public.missio_finance_entries FOR SELECT
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']));

DROP POLICY IF EXISTS "Missio pastors add finance entries" ON public.missio_finance_entries;
CREATE POLICY "Missio pastors add finance entries"
  ON public.missio_finance_entries FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role_id(org_id, ARRAY['pastor']));

DROP POLICY IF EXISTS "Missio pastors change finance entries" ON public.missio_finance_entries;
CREATE POLICY "Missio pastors change finance entries"
  ON public.missio_finance_entries FOR UPDATE
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']))
  WITH CHECK (public.has_org_role_id(org_id, ARRAY['pastor']));

DROP POLICY IF EXISTS "Missio pastors remove finance entries" ON public.missio_finance_entries;
CREATE POLICY "Missio pastors remove finance entries"
  ON public.missio_finance_entries FOR DELETE
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']));

DROP POLICY IF EXISTS "Missio pastors read finance entry history" ON public.missio_finance_entry_events;
CREATE POLICY "Missio pastors read finance entry history"
  ON public.missio_finance_entry_events FOR SELECT
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']));


-- ────────────────────────────────────────────────────────────
-- 4. Comments
-- ────────────────────────────────────────────────────────────
COMMENT ON TABLE public.missio_finance_entries IS
  'Missio income that is not in the bank: cash (rand per month) and FundraiseUp (dollars after fees + rate per month, v1 until the API is connected). One row per org, source and month. Pastors only.';
COMMENT ON COLUMN public.missio_finance_entries.zar_cents IS
  'Generated. cash: cash_cents. fundraiseup: round(usd_cents * usd_zar_rate). The figure the income report uses.';
COMMENT ON TABLE public.missio_finance_entry_events IS
  'Every insert, change and delete of a Missio finance entry, with who, when, before and after. Written only by trigger.';


-- ============================================================
-- Verify:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename LIKE 'missio_finance_%' ORDER BY 1, 3;
--                     -- entries: SELECT/INSERT/UPDATE/DELETE; events: SELECT only
--   SELECT count(*) FROM public.missio_finance_entries;     -- 0 (no seed)
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (deletes every amount entered and its history):
--   DROP TABLE IF EXISTS public.missio_finance_entry_events;
--   DROP TABLE IF EXISTS public.missio_finance_entries;
--   DROP FUNCTION IF EXISTS public.missio_finance_entries_audit();
--   DROP FUNCTION IF EXISTS public.missio_finance_entries_stamp();
-- ------------------------------------------------------------
