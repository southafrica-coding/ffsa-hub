-- ============================================================
-- FFSA Hub — Migration 167: prayer room seat vocabulary
-- Prayer room rebuild, PHASE A. See docs/redesign/07-prayer-room-reconciliation.md
-- ============================================================
-- Seats are currently a CHECK constraint on prayer_room_set_slots.role with
-- four values. The redesign needs a real lineup (co-lead, keys, acoustic,
-- sound, scribe) and — more importantly — needs seats to be a thing other
-- tables can point at: per-seat qualifications (Phase B) and evaluator scope
-- both key off the seat, and neither can reference a CHECK constraint.
--
-- This migration only introduces the vocabulary. No behaviour changes.
--
-- SAFE AGAINST THE CURRENTLY-DEPLOYED CODE
-- ------------------------------------------------------------
-- Migrations here are applied by hand, sometimes before the matching code
-- ships. So `role` is NOT dropped: production still writes and reads it. It
-- becomes nullable, its CHECK is replaced by the seat-type foreign key, and a
-- trigger keeps it in sync for the four legacy values so old readers keep
-- working. `role` is retired in a later migration, once the new UI has shipped.
--
-- Seat ids deliberately reuse the EXISTING role strings
-- (worship_leader / vocals / instrument / prayer_leader) so the backfill is an
-- identity copy and no live row changes meaning. The handoff's spellings
-- ("prayer_lead", "worship_lead") are NOT adopted — renaming live data buys
-- nothing here.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. The seat vocabulary
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prayer_room_seat_types (
  id          text PRIMARY KEY,               -- 'prayer_leader', 'keys', …
  label       text NOT NULL,                  -- 'PRAYER LEAD'
  -- Matches the evaluator scopes in Phase B (all / worship / intercession / tech),
  -- so an evaluator scoped to 'worship' can be resolved to the seats they cover.
  category    text NOT NULL
              CHECK (category IN ('lead', 'worship', 'intercession', 'tech')),
  -- A set is "live" only if one of its lead seats is filled (design rule 1).
  -- Flagging it here keeps that rule out of hard-coded id lists in the app.
  is_lead     boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.prayer_room_seat_types IS
  'Named seats a prayer set can offer. Reference data (~10 rows). Qualifications and evaluator scope key off these.';
COMMENT ON COLUMN public.prayer_room_seat_types.is_lead IS
  'Prayer lead and worship lead. A set with neither filled is not live — it holds its slot as a NEEDS A LEAD block. They are separately evaluated: holding one says nothing about the other.';

-- The four legacy values keep their ids so the backfill below is an identity
-- copy. The rest are new seats the redesigned lineup offers.
INSERT INTO public.prayer_room_seat_types (id, label, category, is_lead, sort_order) VALUES
  ('prayer_leader',  'PRAYER LEAD',   'lead',         true,  10),
  ('worship_leader', 'WORSHIP LEAD',  'lead',         true,  20),
  ('co_lead',        'CO-LEAD',       'lead',         false, 30),
  ('keys',           'KEYS',          'worship',      false, 40),
  ('acoustic',       'ACOUSTIC',      'worship',      false, 50),
  ('vocals',         'VOCALS / BGV',  'worship',      false, 60),
  ('instrument',     'INSTRUMENT',    'worship',      false, 70),
  ('sound',          'SOUND',         'tech',         false, 80),
  ('scribe',         'SCRIBE',        'intercession', false, 90)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.prayer_room_seat_types ENABLE ROW LEVEL SECURITY;

-- Same shape as the other prayer-room reference tables (084): everyone signed
-- in reads the vocabulary; only prayer-room staff change it.
DROP POLICY IF EXISTS "Read seat types" ON public.prayer_room_seat_types;
CREATE POLICY "Read seat types" ON public.prayer_room_seat_types
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Staff manage seat types" ON public.prayer_room_seat_types;
CREATE POLICY "Staff manage seat types" ON public.prayer_room_seat_types
  FOR ALL TO authenticated
  USING (public.is_prayer_room_staff())
  WITH CHECK (public.is_prayer_room_staff());

-- ────────────────────────────────────────────────────────────
-- 2. Point the seats at it
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.prayer_room_set_slots
  ADD COLUMN IF NOT EXISTS seat_type_id text REFERENCES public.prayer_room_seat_types(id);

-- Identity backfill — the four legacy role strings ARE seat type ids.
UPDATE public.prayer_room_set_slots
   SET seat_type_id = role
 WHERE seat_type_id IS NULL;

-- Guard: refuse to proceed if anything failed to map, rather than silently
-- leaving unclassified seats behind.
DO $$
DECLARE unmapped int;
BEGIN
  SELECT count(*) INTO unmapped
    FROM public.prayer_room_set_slots WHERE seat_type_id IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % slot(s) have no seat_type_id', unmapped;
  END IF;
END $$;

ALTER TABLE public.prayer_room_set_slots
  ALTER COLUMN seat_type_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prayer_set_slots_seat_type
  ON public.prayer_room_set_slots (seat_type_id);

-- ────────────────────────────────────────────────────────────
-- 3. Retire the CHECK, keep the column
-- ────────────────────────────────────────────────────────────
-- The old CHECK only allowed the four legacy values, so it would reject any
-- new seat. The foreign key above now governs which seats exist.
-- Found by definition rather than by name: a surviving CHECK under an
-- unexpected name would silently block every new seat type, and that failure
-- would only surface the first time someone adds a KEYS or SOUND seat.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = 'public'
       AND rel.relname = 'prayer_room_set_slots'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%role%'
       AND pg_get_constraintdef(con.oid) ILIKE '%worship_leader%'
  LOOP
    EXECUTE format('ALTER TABLE public.prayer_room_set_slots DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped legacy role CHECK: %', c.conname;
  END LOOP;
END $$;

-- Nullable so new-style writes need not supply a legacy value at all.
ALTER TABLE public.prayer_room_set_slots
  ALTER COLUMN role DROP NOT NULL;

COMMENT ON COLUMN public.prayer_room_set_slots.role IS
  'DEPRECATED — superseded by seat_type_id. Kept (and trigger-synced for the four legacy values) so already-deployed code keeps working. Dropped in a later migration once the redesigned prayer room has shipped.';

-- Keep `role` mirroring seat_type_id for the legacy four, so anything still
-- reading it renders correctly. Seats outside that set leave role NULL —
-- old code never knew about them anyway.
CREATE OR REPLACE FUNCTION public.prayer_room_sync_slot_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.seat_type_id IN ('worship_leader', 'vocals', 'instrument', 'prayer_leader') THEN
    NEW.role := NEW.seat_type_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prayer_room_sync_slot_role ON public.prayer_room_set_slots;
CREATE TRIGGER trg_prayer_room_sync_slot_role
  BEFORE INSERT OR UPDATE OF seat_type_id ON public.prayer_room_set_slots
  FOR EACH ROW EXECUTE FUNCTION public.prayer_room_sync_slot_role();

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- every slot classified, and role still agrees for legacy seats:
--   SELECT count(*) FILTER (WHERE seat_type_id IS NULL)              AS unmapped,
--          count(*) FILTER (WHERE role IS NOT NULL
--                             AND role <> seat_type_id)              AS disagreeing
--   FROM public.prayer_room_set_slots;
--   -- expect 0, 0
--
--   -- the lineup:
--   SELECT id, label, category, is_lead FROM public.prayer_room_seat_types
--   ORDER BY sort_order;
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (nothing here destroys data):
--   DROP TRIGGER IF EXISTS trg_prayer_room_sync_slot_role ON public.prayer_room_set_slots;
--   DROP FUNCTION IF EXISTS public.prayer_room_sync_slot_role();
--   ALTER TABLE public.prayer_room_set_slots DROP COLUMN IF EXISTS seat_type_id;
--   DROP TABLE IF EXISTS public.prayer_room_seat_types;
--   -- then restore the old CHECK if you want it back:
--   -- ALTER TABLE public.prayer_room_set_slots
--   --   ADD CONSTRAINT prayer_room_set_slots_role_check
--   --   CHECK (role IN ('worship_leader','vocals','instrument','prayer_leader'));
-- ------------------------------------------------------------
