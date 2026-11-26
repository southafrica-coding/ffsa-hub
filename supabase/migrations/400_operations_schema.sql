-- ============================================================
-- FFSA Hub — Migration 400: Operations (step 1–2 of docs/operations-plan.md)
-- ============================================================
-- One shared idea across all eight operations areas: an ITEM — something
-- that needs someone's attention — with a running log of updates.
-- Maintenance requests arrive from the Slack form in
-- #maintenance-request-submissions; meeting tasks are typed in at the
-- Wednesday operations meeting.
--
-- Numbered 400 to leave room for branches in flight (Fleet uses 350s).
-- RLS is in 401. Grants nothing to any role or user.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.ops_reminder_log, public.ops_digest_log,
--     public.ops_item_updates, public.ops_items, public.ops_settings;
--   DROP FUNCTION IF EXISTS public.is_ops_team();
--   DELETE FROM public.permissions WHERE key = 'operations.team';
-- ============================================================

-- ── 1. Who is the operations team ───────────────────────────
-- Operations is a DEPARTMENT (Departments & Services, Jack's 318–321):
-- the staff ministry with slug 'operations', which already exists (126).
-- Its active members and leaders are the team. Admins pass. The
-- operations.team key is for a helper from outside the department
-- (seeded, not assigned).
INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('operations', 'operations.team', 'Operations (helper outside the Operations department): see and update every area', 10)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_ops_team()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_admin()
      OR public.has_permission('operations.team')
      OR EXISTS (
           SELECT 1
             FROM public.staff_ministry_members mm
             JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id
             JOIN public.users u ON u.id = mm.user_id
            WHERE mm.user_id = auth.uid()
              AND mm.status = 'active'
              AND sm.slug = 'operations'
              AND sm.is_active
              AND u.is_active IS NOT FALSE);
$$;
REVOKE ALL ON FUNCTION public.is_ops_team() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_ops_team() TO authenticated;

-- ── 2. Settings (one row) ───────────────────────────────────
-- Slack channel ids. area_channels maps an area to the channel its 07:00
-- message goes to, e.g. {"maintenance": "C0…"}. No channel = no message.
CREATE TABLE IF NOT EXISTS public.ops_settings (
  id                       boolean PRIMARY KEY DEFAULT true CHECK (id),
  maintenance_intake_channel text,             -- where the Slack form posts
  ops_channel              text,               -- weekly summary + meeting recap
  area_channels            jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_intake_ts           text,               -- newest Slack ts imported
  updated_at               timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ops_settings (id, maintenance_intake_channel)
VALUES (true, 'C089YJB8XD1')   -- #maintenance-request-submissions
ON CONFLICT (id) DO NOTHING;

-- ── 3. Items ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area                   text NOT NULL,
  title                  text NOT NULL,
  details                text,
  location               text,
  status                 text NOT NULL DEFAULT 'new',
  owner_user_id          uuid REFERENCES public.users (id) ON DELETE SET NULL,
  due_on                 date,
  source                 text NOT NULL DEFAULT 'hub',
  -- Who asked (Slack form). Slack id kept so they can be told when it moves.
  requested_by_name      text,
  requested_by_slack_id  text,
  requested_by_user_id   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  slack_channel          text,
  slack_ts               text,
  created_by             uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  last_activity_at       timestamptz NOT NULL DEFAULT now(),
  closed_at              timestamptz,
  CONSTRAINT ops_items_area CHECK (area IN (
    'maintenance', 'transport', 'buildings', 'innovations',
    'hospitality', 'teams', 'events', 'equipment')),
  CONSTRAINT ops_items_status CHECK (status IN (
    'new', 'seen', 'in_progress', 'more_time', 'done', 'wont_do')),
  CONSTRAINT ops_items_source CHECK (source IN ('slack', 'hub', 'meeting')),
  CONSTRAINT ops_items_title_len CHECK (char_length(btrim(title)) BETWEEN 2 AND 200),
  CONSTRAINT ops_items_closed CHECK ((status IN ('done', 'wont_do')) = (closed_at IS NOT NULL))
);

-- Not partial: the import's ON CONFLICT (slack_channel, slack_ts) needs a
-- plain unique index. NULLs never collide, so Hub items are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS ops_items_slack_message
  ON public.ops_items (slack_channel, slack_ts);
CREATE INDEX IF NOT EXISTS ops_items_open
  ON public.ops_items (area, created_at DESC) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS ops_items_owner
  ON public.ops_items (owner_user_id, due_on) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS ops_items_closed_at
  ON public.ops_items (closed_at DESC) WHERE closed_at IS NOT NULL;

-- ── 4. Updates (the log) ────────────────────────────────────
-- Every status change, note, assignment and date change. author_name
-- covers Slack presses by someone with no Hub account linked.
CREATE TABLE IF NOT EXISTS public.ops_item_updates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         uuid NOT NULL REFERENCES public.ops_items (id) ON DELETE CASCADE,
  author_user_id  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  author_name     text,
  kind            text NOT NULL,
  status_to       text,
  owner_to        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  due_to          date,
  note            text,
  via             text NOT NULL DEFAULT 'hub',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_item_updates_kind CHECK (kind IN ('created', 'status', 'note', 'assign', 'due')),
  CONSTRAINT ops_item_updates_via CHECK (via IN ('hub', 'slack', 'meeting')),
  CONSTRAINT ops_item_updates_note_len CHECK (note IS NULL OR char_length(note) <= 4000)
);
CREATE INDEX IF NOT EXISTS ops_item_updates_item ON public.ops_item_updates (item_id, created_at);

-- ── 5. Sent-message logs (service role only) ────────────────
-- One row per morning/weekly message, so Monday covers since Friday.
CREATE TABLE IF NOT EXISTS public.ops_digest_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('morning', 'weekly', 'recap')),
  area        text,
  channel     text,
  slack_ts    text,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_digest_log_kind ON public.ops_digest_log (kind, area, sent_at DESC);

-- A personal reminder is sent once per item per kind (and per due date,
-- so moving the date earns a fresh day-before nudge).
CREATE TABLE IF NOT EXISTS public.ops_reminder_log (
  item_id   uuid NOT NULL REFERENCES public.ops_items (id) ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind IN ('assigned', 'day_before', 'due_day', 'past_due')),
  due_on    date,
  user_id   uuid REFERENCES public.users (id) ON DELETE CASCADE,
  sent_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ops_reminder_log_once
  ON public.ops_reminder_log (item_id, kind, COALESCE(due_on, '1900-01-01'::date), user_id);

-- ── 6. Keep updated_at / last_activity_at / closed_at honest ─
CREATE OR REPLACE FUNCTION public.ops_items_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IN ('done', 'wont_do') THEN
    NEW.closed_at := COALESCE(CASE WHEN OLD.status IN ('done', 'wont_do') THEN OLD.closed_at END, now());
  ELSE
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ops_items_touch ON public.ops_items;
CREATE TRIGGER ops_items_touch BEFORE UPDATE ON public.ops_items
  FOR EACH ROW EXECUTE FUNCTION public.ops_items_touch();

CREATE OR REPLACE FUNCTION public.ops_item_updates_bump()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ops_items SET last_activity_at = NEW.created_at WHERE id = NEW.item_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_item_updates_bump() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ops_item_updates_bump ON public.ops_item_updates;
CREATE TRIGGER ops_item_updates_bump AFTER INSERT ON public.ops_item_updates
  FOR EACH ROW EXECUTE FUNCTION public.ops_item_updates_bump();
