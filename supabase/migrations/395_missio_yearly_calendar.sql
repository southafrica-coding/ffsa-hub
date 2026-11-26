-- ============================================================
-- FFSA Hub — Migration 395: Missio yearly calendar
-- ============================================================
-- DRAFT. Do not apply until Jack says so. (394 is Missio Finance.)
-- Depends on 329 (organisations, has_org_role).
--
-- One calendar per org, made by the app the first time a pastor adds
-- an event or opens Share. No seed rows: public holidays and school
-- terms are code constants (src/lib/missio/calendar/south-africa.ts).
--
--   missio_calendars        the calendar (one per org)
--   missio_calendar_events  pastors' events: all-day, multi-day or timed,
--                           optionally every n weeks (RRULE in the feed)
--   missio_calendar_links   the share link: nonce + SHA-256 of the token,
--                           never the token. Service role only.
--   missio_calendar_feed()  SECURITY DEFINER: token hash in, one
--                           calendar's events out. The public .ics feed
--                           and web view read through this alone.
--
-- Pastors (has_org_role('missio', ['pastor'])) read and write the
-- calendar and its events. Leaders, coaches and FFSA admins don't.
-- Nothing is granted to anon except the feed function.
--
-- Idempotent inside one transaction.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Tables
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.missio_calendars (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT 'Missio' CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  created_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Lets events carry (calendar_id, org_id) as one foreign key.
  CONSTRAINT missio_calendars_id_org_key UNIQUE (id, org_id)
);

-- One calendar per org in v1.
CREATE UNIQUE INDEX IF NOT EXISTS missio_calendars_org_uidx
  ON public.missio_calendars (org_id);

COMMENT ON TABLE public.missio_calendars IS
  'Missio yearly calendar (one per org). Made lazily by the app; no seed rows.';

CREATE TABLE IF NOT EXISTS public.missio_calendar_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id             uuid NOT NULL,
  org_id                  uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  title                   text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  description             text CHECK (description IS NULL OR char_length(description) <= 2000),
  location                text CHECK (location IS NULL OR char_length(location) <= 200),
  category                text NOT NULL CHECK (category IN ('sundays', 'house_church', 'events', 'leaders')),
  campus                  text NOT NULL DEFAULT 'all' CHECK (campus IN ('all', 'potch', 'jhb')),
  -- Days in Johannesburg. ends_on is the last day (inclusive); the feed
  -- writes an exclusive DTEND.
  starts_on               date NOT NULL,
  ends_on                 date NOT NULL,
  -- Both null: all day. Both set: from start_time on starts_on to
  -- end_time on ends_on, Johannesburg time.
  start_time              time,
  end_time                time,
  timezone                text NOT NULL DEFAULT 'Africa/Johannesburg' CHECK (timezone = 'Africa/Johannesburg'),
  -- Weekly series: every n weeks on the start's weekday, until a date
  -- or a number of times (or neither: open-ended). skip_dates are
  -- repeat start dates left out (EXDATE).
  repeat_weekly_interval  smallint CHECK (repeat_weekly_interval IS NULL OR repeat_weekly_interval BETWEEN 1 AND 52),
  repeat_until            date,
  repeat_count            smallint CHECK (repeat_count IS NULL OR repeat_count BETWEEN 1 AND 520),
  skip_dates              date[] NOT NULL DEFAULT '{}'::date[] CHECK (cardinality(skip_dates) <= 200),
  created_by              uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by              uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_calendar_events_calendar_fk
    FOREIGN KEY (calendar_id, org_id) REFERENCES public.missio_calendars (id, org_id) ON DELETE CASCADE,
  CONSTRAINT missio_calendar_events_span
    CHECK (ends_on >= starts_on AND ends_on - starts_on <= 366),
  CONSTRAINT missio_calendar_events_times_paired
    CHECK ((start_time IS NULL) = (end_time IS NULL)),
  CONSTRAINT missio_calendar_events_times_order
    CHECK (start_time IS NULL OR ends_on > starts_on OR end_time > start_time),
  CONSTRAINT missio_calendar_events_repeat_end
    CHECK (repeat_until IS NULL OR repeat_count IS NULL),
  CONSTRAINT missio_calendar_events_repeat_needs_interval
    CHECK (
      repeat_weekly_interval IS NOT NULL
      OR (repeat_until IS NULL AND repeat_count IS NULL AND cardinality(skip_dates) = 0)
    ),
  CONSTRAINT missio_calendar_events_repeat_until_after_start
    CHECK (repeat_until IS NULL OR repeat_until >= starts_on),
  -- One repeat ends before the next starts.
  CONSTRAINT missio_calendar_events_repeat_fits
    CHECK (repeat_weekly_interval IS NULL OR ends_on - starts_on < 7 * repeat_weekly_interval)
);

CREATE INDEX IF NOT EXISTS missio_calendar_events_calendar_idx
  ON public.missio_calendar_events (calendar_id, starts_on);
CREATE INDEX IF NOT EXISTS missio_calendar_events_org_idx
  ON public.missio_calendar_events (org_id, starts_on);

COMMENT ON TABLE public.missio_calendar_events IS
  'Missio calendar events added by pastors. Public holidays and school terms are not stored here (code constants).';

CREATE TABLE IF NOT EXISTS public.missio_calendar_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id   uuid NOT NULL REFERENCES public.missio_calendars (id) ON DELETE CASCADE,
  nonce         text NOT NULL CHECK (char_length(nonce) >= 32),
  token_hash    text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix  text NOT NULL CHECK (token_prefix ~ '^[A-Za-z0-9_-]{6}$'),
  created_by    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  rotated_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS missio_calendar_links_calendar_uidx
  ON public.missio_calendar_links (calendar_id);
CREATE UNIQUE INDEX IF NOT EXISTS missio_calendar_links_hash_uidx
  ON public.missio_calendar_links (token_hash);

COMMENT ON TABLE public.missio_calendar_links IS
  'Share link for a Missio calendar. Token = HMAC(server secret, calendar id, nonce); only the nonce and the token''s SHA-256 are stored. Reset replaces both. Service role only.';

-- ────────────────────────────────────────────────────────────
-- 2. Audit: updated_at, and who wrote it
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.missio_calendar_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE((SELECT auth.uid()), NEW.created_by);
    NEW.updated_by := COALESCE((SELECT auth.uid()), NEW.updated_by, NEW.created_by);
  ELSE
    -- Creation facts can't be rewritten.
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.updated_by := COALESCE((SELECT auth.uid()), NEW.updated_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_calendars;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_calendars
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS missio_calendar_stamp ON public.missio_calendars;
CREATE TRIGGER missio_calendar_stamp
  BEFORE INSERT OR UPDATE ON public.missio_calendars
  FOR EACH ROW EXECUTE FUNCTION public.missio_calendar_stamp();

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_calendar_events;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS missio_calendar_stamp ON public.missio_calendar_events;
CREATE TRIGGER missio_calendar_stamp
  BEFORE INSERT OR UPDATE ON public.missio_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.missio_calendar_stamp();

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_calendar_links;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_calendar_links
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.missio_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_calendar_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.missio_calendars FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_calendar_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_calendar_links FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.missio_calendars TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.missio_calendar_events TO authenticated;
GRANT ALL ON TABLE public.missio_calendars TO service_role;
GRANT ALL ON TABLE public.missio_calendar_events TO service_role;
GRANT ALL ON TABLE public.missio_calendar_links TO service_role;
-- missio_calendar_links: no authenticated policy and no grant. The app
-- reaches it with the service role after the pastor check.

DROP POLICY IF EXISTS "Pastors read the calendar" ON public.missio_calendars;
CREATE POLICY "Pastors read the calendar"
  ON public.missio_calendars FOR SELECT TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors create the calendar" ON public.missio_calendars;
CREATE POLICY "Pastors create the calendar"
  ON public.missio_calendars FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors rename the calendar" ON public.missio_calendars;
CREATE POLICY "Pastors rename the calendar"
  ON public.missio_calendars FOR UPDATE TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors read calendar events" ON public.missio_calendar_events;
CREATE POLICY "Pastors read calendar events"
  ON public.missio_calendar_events FOR SELECT TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors add calendar events" ON public.missio_calendar_events;
CREATE POLICY "Pastors add calendar events"
  ON public.missio_calendar_events FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors edit calendar events" ON public.missio_calendar_events;
CREATE POLICY "Pastors edit calendar events"
  ON public.missio_calendar_events FOR UPDATE TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors delete calendar events" ON public.missio_calendar_events;
CREATE POLICY "Pastors delete calendar events"
  ON public.missio_calendar_events FOR DELETE TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

-- ────────────────────────────────────────────────────────────
-- 4. Public feed: token hash in, one calendar out
-- ────────────────────────────────────────────────────────────
-- Returns null for an unknown hash, so the caller can't tell a reset
-- link from one that never existed. Audit columns stay out.

CREATE OR REPLACE FUNCTION public.missio_calendar_feed(p_token_hash text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'name', c.name,
    'events', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'title', e.title,
          'description', e.description,
          'location', e.location,
          'category', e.category,
          'campus', e.campus,
          'starts_on', e.starts_on,
          'ends_on', e.ends_on,
          'start_time', e.start_time,
          'end_time', e.end_time,
          'repeat_weekly_interval', e.repeat_weekly_interval,
          'repeat_until', e.repeat_until,
          'repeat_count', e.repeat_count,
          'skip_dates', e.skip_dates,
          'updated_at', e.updated_at
        )
        ORDER BY e.starts_on, e.start_time NULLS FIRST, e.id
      )
      FROM public.missio_calendar_events e
      WHERE e.calendar_id = c.id
    ), '[]'::jsonb)
  )
  FROM public.missio_calendar_links l
  JOIN public.missio_calendars c ON c.id = l.calendar_id
  WHERE p_token_hash ~ '^[0-9a-f]{64}$'
    AND l.token_hash = p_token_hash;
$$;

REVOKE ALL ON FUNCTION public.missio_calendar_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.missio_calendar_feed(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.missio_calendar_feed(text) IS
  'Public Missio calendar feed: SHA-256 of the share token in, the calendar''s name and events out (null when unknown). The only public read path.';

REVOKE ALL ON FUNCTION public.missio_calendar_stamp() FROM PUBLIC, anon, authenticated;

COMMIT;
