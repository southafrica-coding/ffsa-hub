-- ============================================================
-- FFSA Hub — Migration 417: P&W songwriting (Op. Dandelion)
-- ============================================================
-- Depends on 318 (dept_* helpers) only. Independent of 416. Applied by
-- hand, on prod only with Jack's explicit OK.
--
-- Prayer & Worship tracks songwriting trainings by nation, who
-- facilitated them, and the songs that came out of them. Totals are a
-- view (pw_songwriting_totals), never stored.
--
-- No data here. Nations and past trainings come from the import script
-- supabase/scripts/ops/pw_songwriting_import.ts (dry run by default).
--
-- Access: active members of the prayer_and_worship staff ministry
-- (any member_role) and admins read and write everything. Nobody else
-- gets anything; anon has no grants. Same shape as 318–321: active
-- account check first, then is_admin() or ministry membership.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Access helper
-- ────────────────────────────────────────────────────────────
-- No argument, so policies call it as (SELECT ...) and Postgres runs it
-- once per statement.

CREATE OR REPLACE FUNCTION public.pw_can_access_songwriting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (
       public.is_admin()
       OR EXISTS (
         SELECT 1
           FROM public.staff_ministries sm
          WHERE sm.slug = 'prayer_and_worship'
            AND public.dept_is_ministry_member(sm.id, false)
       )
     );
$$;

REVOKE ALL ON FUNCTION public.pw_can_access_songwriting() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pw_can_access_songwriting() TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 2. Tables
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pw_nations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  continent   text CHECK (continent IN ('africa', 'asia', 'europe', 'north_america',
                                        'south_america', 'oceania', 'antarctica')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'tentative')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pw_nations IS
  'Nations P&W songwriting has reached. tentative = counted with a caveat (for example Italy, trained in Potch).';

CREATE TABLE IF NOT EXISTS public.pw_songwriting_trainings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year            smallint NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month           smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  location_text   text CHECK (location_text IS NULL OR btrim(location_text) <> ''),
  nation_id       uuid REFERENCES public.pw_nations (id) ON DELETE RESTRICT,
  audience_label  text,
  people_trained  int CHECK (people_trained >= 0),
  songs_workshop  int CHECK (songs_workshop >= 0),
  songs_post      int CHECK (songs_post >= 0),
  notes           text,
  languages       text[] NOT NULL DEFAULT '{}'::text[],
  status          text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'draft')),
  source          text NOT NULL DEFAULT 'hub' CHECK (source IN ('imported', 'hub')),
  import_key      text UNIQUE,
  created_by      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pw_songwriting_trainings_import_key_source
    CHECK ((source = 'imported') = (import_key IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS pw_songwriting_trainings_year_month_idx
  ON public.pw_songwriting_trainings (year, month);
CREATE INDEX IF NOT EXISTS pw_songwriting_trainings_nation_id_idx
  ON public.pw_songwriting_trainings (nation_id);
CREATE INDEX IF NOT EXISTS pw_songwriting_trainings_created_by_idx
  ON public.pw_songwriting_trainings (created_by);

COMMENT ON COLUMN public.pw_songwriting_trainings.people_trained IS 'Null = not known (the sheet had ?).';
COMMENT ON COLUMN public.pw_songwriting_trainings.songs_workshop IS 'Songs written during the workshop.';
COMMENT ON COLUMN public.pw_songwriting_trainings.songs_post IS 'Songs known to be written after the workshop. Null = not known.';
COMMENT ON COLUMN public.pw_songwriting_trainings.import_key IS
  'Stable natural key for imported rows (year-month-location-audience-trainers). Set exactly when source = imported.';

CREATE TABLE IF NOT EXISTS public.pw_training_facilitators (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id   uuid NOT NULL REFERENCES public.pw_songwriting_trainings (id) ON DELETE CASCADE,
  person_id     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  display_name  text NOT NULL CHECK (btrim(display_name) <> ''),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pw_training_facilitators_training_name_key UNIQUE (training_id, display_name)
);

CREATE INDEX IF NOT EXISTS pw_training_facilitators_person_id_idx
  ON public.pw_training_facilitators (person_id);

COMMENT ON COLUMN public.pw_training_facilitators.person_id IS
  'Hub user, when known. display_name is always kept (outside facilitators have no account).';

CREATE TABLE IF NOT EXISTS public.pw_songs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL CHECK (btrim(title) <> ''),
  language            text,
  nation_id           uuid REFERENCES public.pw_nations (id) ON DELETE RESTRICT,
  source_training_id  uuid REFERENCES public.pw_songwriting_trainings (id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'written'
    CHECK (status IN ('draft', 'written', 'recorded', 'released')),
  notes               text,
  written_on          date,
  created_by          uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pw_songs_nation_id_idx ON public.pw_songs (nation_id);
CREATE INDEX IF NOT EXISTS pw_songs_source_training_id_idx ON public.pw_songs (source_training_id);
CREATE INDEX IF NOT EXISTS pw_songs_created_by_idx ON public.pw_songs (created_by);

COMMENT ON COLUMN public.pw_songs.status IS
  'draft = still being written; written = finished (default); recorded = has a recording; released = shared publicly.';

CREATE TABLE IF NOT EXISTS public.pw_song_writers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id       uuid NOT NULL REFERENCES public.pw_songs (id) ON DELETE CASCADE,
  person_id     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  display_name  text NOT NULL CHECK (btrim(display_name) <> ''),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pw_song_writers_song_name_key UNIQUE (song_id, display_name)
);

CREATE INDEX IF NOT EXISTS pw_song_writers_person_id_idx ON public.pw_song_writers (person_id);

-- ────────────────────────────────────────────────────────────
-- 3. Triggers, grants, RLS
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pw_nations', 'pw_songwriting_trainings', 'pw_training_facilitators',
    'pw_songs', 'pw_song_writers'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', t);

    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting reads" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "P&W songwriting reads" ON public.%I FOR SELECT TO authenticated
         USING ((SELECT public.pw_can_access_songwriting()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting inserts" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "P&W songwriting inserts" ON public.%I FOR INSERT TO authenticated
         WITH CHECK ((SELECT public.pw_can_access_songwriting()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting updates" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "P&W songwriting updates" ON public.%I FOR UPDATE TO authenticated
         USING ((SELECT public.pw_can_access_songwriting()))
         WITH CHECK ((SELECT public.pw_can_access_songwriting()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting deletes" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "P&W songwriting deletes" ON public.%I FOR DELETE TO authenticated
         USING ((SELECT public.pw_can_access_songwriting()))', t);
  END LOOP;
END
$$;

-- ────────────────────────────────────────────────────────────
-- 4. Totals view
-- ────────────────────────────────────────────────────────────
-- security_invoker, so the caller's RLS on the tables applies: anyone
-- without songwriting access sees no rows. Only status = completed
-- trainings count. One row per grouping:
--   scope 'overall'  year null, nation null
--   scope 'year'     year set,  nation null
--   scope 'nation'   year null, nation set (trainings with no nation are
--                    left out of the nation rows, and still count above)
-- Sums treat unknown (null) counts as 0. songs_total = workshop + post.
-- songs_logged counts pw_songs rows whose source training is in the
-- group (songs logged without a training are not in this view).
-- nations / continents count distinct values in the group; tentative
-- nations are counted and also reported separately.

CREATE OR REPLACE VIEW public.pw_songwriting_totals
WITH (security_invoker = true) AS
WITH t AS (
  SELECT tr.id,
         tr.year,
         tr.nation_id,
         tr.people_trained,
         tr.songs_workshop,
         tr.songs_post,
         n.name AS nation_name,
         n.continent,
         n.status AS nation_status,
         (SELECT count(*) FROM public.pw_songs s WHERE s.source_training_id = tr.id) AS songs_logged
    FROM public.pw_songwriting_trainings tr
    LEFT JOIN public.pw_nations n ON n.id = tr.nation_id
   WHERE tr.status = 'completed'
)
SELECT
  CASE
    WHEN GROUPING(t.year) = 0 THEN 'year'
    WHEN GROUPING(t.nation_id) = 0 THEN 'nation'
    ELSE 'overall'
  END AS scope,
  t.year,
  t.nation_id,
  CASE WHEN GROUPING(t.nation_id) = 0 THEN max(t.nation_name) END AS nation_name,
  count(*)::int AS trainings,
  coalesce(sum(t.people_trained), 0)::int AS people_trained,
  coalesce(sum(t.songs_workshop), 0)::int AS songs_workshop,
  coalesce(sum(t.songs_post), 0)::int AS songs_post,
  (coalesce(sum(t.songs_workshop), 0) + coalesce(sum(t.songs_post), 0))::int AS songs_total,
  coalesce(sum(t.songs_logged), 0)::int AS songs_logged,
  count(DISTINCT t.nation_id)::int AS nations,
  count(DISTINCT t.nation_id) FILTER (WHERE t.nation_status = 'tentative')::int AS tentative_nations,
  count(DISTINCT t.continent)::int AS continents
FROM t
GROUP BY GROUPING SETS ((), (t.year), (t.nation_id))
HAVING GROUPING(t.nation_id) = 1 OR t.nation_id IS NOT NULL;

COMMENT ON VIEW public.pw_songwriting_totals IS
  'Songwriting totals from completed trainings: scope overall | year | nation. security_invoker. Never stored.';

REVOKE ALL ON public.pw_songwriting_totals FROM PUBLIC, anon;
GRANT SELECT ON public.pw_songwriting_totals TO authenticated, service_role;
