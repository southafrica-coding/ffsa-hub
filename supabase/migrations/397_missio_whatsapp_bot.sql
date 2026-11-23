-- ============================================================
-- FFSA Hub — Migration 397: Missio WhatsApp menu bot (serving path)
-- ============================================================
-- DRAFT — DO NOT APPLY until Jack has reviewed PR "Missio WhatsApp menu
-- bot + serving path". 396 (the inbox) is already applied and is not
-- changed here.
--
-- The Hub runs without this: the inbox reads fall back to the 396
-- columns, the bot does nothing (its tables aren't there), and a pastor's
-- send still goes out (the auto-pause is skipped and logged).
--
-- APPLY ORDER: after 396 (missio_whatsapp_*), 333 (missio_teams) and
-- 329 (organisations, has_org_role_id). Nothing else depends on it.
--
-- A simple menu on Missio's WhatsApp number answers people who write in.
-- In this step only "I want to serve" and "Talk to a person" are built;
-- the other menu rows hand the chat to a pastor.
--
--   missio_whatsapp_threads (columns)  bot_mode: on | paused | handed_off.
--                                      Pastors take over, pause and resume.
--   missio_whatsapp_messages (columns) wa_reply_id: the id of the button or
--                                      list row someone tapped.
--                                      sent_by_bot: the menu sent it.
--   missio_whatsapp_bot_sessions       where someone is in a menu flow.
--                                      At most one open per thread.
--   missio_whatsapp_bot_outbox         every bot send, keyed by the inbound
--                                      wamid it answers, so a webhook retry
--                                      can't send the menu twice.
--   missio_serving_interests           "I want to serve" answers. Never
--                                      creates a person: contact_id only when
--                                      the thread already belongs to exactly
--                                      one Missio person.
--
-- Who: Missio pastors only (has_org_role_id(org_id, ['pastor'])), the same
-- wall as 396. Pastors read sessions and serving interests, may change a
-- thread's bot mode, and may change an interest's status — nothing else.
-- The bot writes through the service role. Leaders, coaches, FFSA admins
-- and anon get nothing. No tokens, secrets or raw Graph requests stored.
--
-- Only adds objects. Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE,
-- constraints added only when missing, triggers and policies dropped by
-- name first. No seed rows.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Threads: who has the chat
-- ────────────────────────────────────────────────────────────
-- on          the menu answers
-- paused      a pastor has the chat (Pause, Take over, or they sent a reply)
-- handed_off  the person asked for a person (or a path that isn't built yet)
ALTER TABLE public.missio_whatsapp_threads
  ADD COLUMN IF NOT EXISTS bot_mode           text NOT NULL DEFAULT 'on',
  ADD COLUMN IF NOT EXISTS bot_paused_at      timestamptz,
  ADD COLUMN IF NOT EXISTS bot_paused_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bot_handoff_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missio_whatsapp_threads_bot_mode_check') THEN
    ALTER TABLE public.missio_whatsapp_threads
      ADD CONSTRAINT missio_whatsapp_threads_bot_mode_check CHECK (bot_mode IN ('on', 'paused', 'handed_off'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missio_whatsapp_threads_bot_reason_check') THEN
    ALTER TABLE public.missio_whatsapp_threads
      ADD CONSTRAINT missio_whatsapp_threads_bot_reason_check
      CHECK (bot_handoff_reason IS NULL OR bot_handoff_reason IN ('human', 'care', 'pastor', 'deferred'));
  END IF;
  -- Back on means nobody holds it: no reason, no pause stamp.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missio_whatsapp_threads_bot_on_shape') THEN
    ALTER TABLE public.missio_whatsapp_threads
      ADD CONSTRAINT missio_whatsapp_threads_bot_on_shape
      CHECK (bot_mode <> 'on' OR (bot_handoff_reason IS NULL AND bot_paused_at IS NULL AND bot_paused_by IS NULL));
  END IF;
END $$;

-- A pastor changing the bot mode is stamped as themselves, whatever they
-- send: bot_paused_by can't name someone else. The service role (the bot
-- handing off, the send route auto-pausing) passes its own values.
CREATE OR REPLACE FUNCTION public.missio_whatsapp_bot_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.bot_mode IS DISTINCT FROM OLD.bot_mode
     OR NEW.bot_handoff_reason IS DISTINCT FROM OLD.bot_handoff_reason
     OR NEW.bot_paused_by IS DISTINCT FROM OLD.bot_paused_by
     OR NEW.bot_paused_at IS DISTINCT FROM OLD.bot_paused_at THEN
    IF NEW.bot_mode = 'on' THEN
      NEW.bot_paused_at := NULL;
      NEW.bot_paused_by := NULL;
      NEW.bot_handoff_reason := NULL;
    ELSE
      NEW.bot_paused_at := now();
      NEW.bot_paused_by := v_uid;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS missio_whatsapp_threads_bot_stamp ON public.missio_whatsapp_threads;
CREATE TRIGGER missio_whatsapp_threads_bot_stamp
  BEFORE UPDATE ON public.missio_whatsapp_threads
  FOR EACH ROW EXECUTE FUNCTION public.missio_whatsapp_bot_stamp();

REVOKE ALL ON FUNCTION public.missio_whatsapp_bot_stamp() FROM PUBLIC, anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- 2. Messages: the tapped reply id, and "the menu sent this"
-- ────────────────────────────────────────────────────────────
-- body keeps the readable title for the thread; wa_reply_id is what the
-- bot routes on (titles can repeat; ids don't).
ALTER TABLE public.missio_whatsapp_messages
  ADD COLUMN IF NOT EXISTS wa_reply_id text,
  ADD COLUMN IF NOT EXISTS sent_by_bot boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missio_whatsapp_messages_reply_id_check') THEN
    ALTER TABLE public.missio_whatsapp_messages
      ADD CONSTRAINT missio_whatsapp_messages_reply_id_check
      CHECK (wa_reply_id IS NULL OR (direction = 'in' AND length(wa_reply_id) BETWEEN 1 AND 256));
  END IF;
  -- Only outbound can be the bot's, and the bot is nobody's login.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'missio_whatsapp_messages_bot_shape') THEN
    ALTER TABLE public.missio_whatsapp_messages
      ADD CONSTRAINT missio_whatsapp_messages_bot_shape
      CHECK (NOT sent_by_bot OR (direction = 'out' AND sent_by IS NULL));
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- 3. Bot sessions
-- ────────────────────────────────────────────────────────────
-- flow / step say where someone is ("serve" / "availability"). data holds
-- their answers so far (teams, availability, experience); failures counts
-- replies the menu didn't understand at this step. Closed (closed_at set)
-- when a flow finishes, is cancelled or is handed off; closed rows are
-- kept so pastors can see what the last flow was.
CREATE TABLE IF NOT EXISTS public.missio_whatsapp_bot_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  thread_id          uuid NOT NULL,
  flow               text NOT NULL CHECK (flow IN ('menu', 'serve', 'rest')),
  step               text NOT NULL CHECK (length(step) BETWEEN 1 AND 40),
  data               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  failures           integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  last_inbound_wamid text CHECK (last_inbound_wamid IS NULL OR length(last_inbound_wamid) BETWEEN 1 AND 256),
  closed_at          timestamptz,
  closed_reason      text CHECK (closed_reason IS NULL OR closed_reason IN ('done', 'cancelled', 'handed_off', 'expired', 'opted_out', 'paused')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_whatsapp_bot_sessions_thread_fkey
    FOREIGN KEY (thread_id, org_id) REFERENCES public.missio_whatsapp_threads (id, org_id) ON DELETE CASCADE,
  CONSTRAINT missio_whatsapp_bot_sessions_closed_shape CHECK ((closed_at IS NULL) = (closed_reason IS NULL))
);

-- One open session per thread.
CREATE UNIQUE INDEX IF NOT EXISTS missio_whatsapp_bot_sessions_open_key
  ON public.missio_whatsapp_bot_sessions (thread_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS missio_whatsapp_bot_sessions_thread_idx
  ON public.missio_whatsapp_bot_sessions (thread_id, created_at DESC);


-- ────────────────────────────────────────────────────────────
-- 4. Bot outbox
-- ────────────────────────────────────────────────────────────
-- purpose 'turn'  one row per inbound wamid: whoever inserts it handles
--                 that message. A second delivery finds it and stops.
-- purpose 'reply' one row per message the bot sends for it (seq 1, 2, …).
-- inbound_at lets the bot skip an older message that arrives after a
-- newer one has been answered. payload is the message the bot sends
-- (text, buttons, list) without the phone number or any token.
CREATE TABLE IF NOT EXISTS public.missio_whatsapp_bot_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  thread_id     uuid NOT NULL,
  inbound_wamid text NOT NULL CHECK (length(inbound_wamid) BETWEEN 1 AND 256),
  inbound_at    timestamptz NOT NULL,
  purpose       text NOT NULL CHECK (purpose IN ('turn', 'reply')),
  seq           integer NOT NULL DEFAULT 0 CHECK (seq BETWEEN 0 AND 20),
  payload       jsonb CHECK (payload IS NULL OR jsonb_typeof(payload) = 'object'),
  message_id    uuid REFERENCES public.missio_whatsapp_messages(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_code    integer,
  error_title   text CHECK (error_title IS NULL OR length(error_title) <= 300),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_whatsapp_bot_outbox_thread_fkey
    FOREIGN KEY (thread_id, org_id) REFERENCES public.missio_whatsapp_threads (id, org_id) ON DELETE CASCADE,
  CONSTRAINT missio_whatsapp_bot_outbox_key UNIQUE (inbound_wamid, purpose, seq),
  CONSTRAINT missio_whatsapp_bot_outbox_shape CHECK (
    (purpose = 'turn' AND seq = 0 AND payload IS NULL) OR (purpose = 'reply' AND seq >= 1 AND payload IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS missio_whatsapp_bot_outbox_thread_turn_idx
  ON public.missio_whatsapp_bot_outbox (thread_id, inbound_at DESC) WHERE purpose = 'turn';


-- ────────────────────────────────────────────────────────────
-- 5. Serving interests
-- ────────────────────────────────────────────────────────────
-- teams: [{ "id": "<missio_teams id>" | "welcome" | null, "name": "Kids" }]
--        (id null for a team they typed under "Other").
CREATE TABLE IF NOT EXISTS public.missio_serving_interests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  -- Only when the thread already belongs to exactly one Missio person.
  -- The bot never creates people or contacts.
  contact_id   uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  thread_id    uuid,
  teams        jsonb NOT NULL CHECK (jsonb_typeof(teams) = 'array' AND jsonb_array_length(teams) BETWEEN 1 AND 20),
  availability text CHECK (availability IS NULL OR availability IN ('most_sundays', 'monthly', 'midweek', 'not_sure')),
  experience   text CHECK (experience IS NULL OR experience IN ('yes', 'a_little', 'not_yet')),
  note         text CHECK (note IS NULL OR length(note) <= 1000),
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'placed', 'closed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_serving_interests_org_fkey FOREIGN KEY (org_id) REFERENCES public.organisations(id) ON DELETE RESTRICT,
  -- SET NULL on the thread only (org_id stays), so the interest outlives a deleted conversation.
  CONSTRAINT missio_serving_interests_thread_fkey
    FOREIGN KEY (thread_id) REFERENCES public.missio_whatsapp_threads (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS missio_serving_interests_org_status_idx
  ON public.missio_serving_interests (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS missio_serving_interests_thread_idx
  ON public.missio_serving_interests (thread_id) WHERE thread_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 6. updated_at (the 396 SECURITY DEFINER stamp)
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS missio_whatsapp_bot_sessions_touch ON public.missio_whatsapp_bot_sessions;
CREATE TRIGGER missio_whatsapp_bot_sessions_touch
  BEFORE UPDATE ON public.missio_whatsapp_bot_sessions
  FOR EACH ROW EXECUTE FUNCTION public.missio_whatsapp_touch();

DROP TRIGGER IF EXISTS missio_whatsapp_bot_outbox_touch ON public.missio_whatsapp_bot_outbox;
CREATE TRIGGER missio_whatsapp_bot_outbox_touch
  BEFORE UPDATE ON public.missio_whatsapp_bot_outbox
  FOR EACH ROW EXECUTE FUNCTION public.missio_whatsapp_touch();

DROP TRIGGER IF EXISTS missio_serving_interests_touch ON public.missio_serving_interests;
CREATE TRIGGER missio_serving_interests_touch
  BEFORE UPDATE ON public.missio_serving_interests
  FOR EACH ROW EXECUTE FUNCTION public.missio_whatsapp_touch();


-- ────────────────────────────────────────────────────────────
-- 7. RLS — Missio pastors only; no anon
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.missio_whatsapp_bot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_whatsapp_bot_outbox   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_serving_interests     ENABLE ROW LEVEL SECURITY;

-- No TRUNCATE / REFERENCES / TRIGGER for anyone. service_role keeps ALL
-- (default privileges): the bot writes through it.
REVOKE ALL ON TABLE public.missio_whatsapp_bot_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_whatsapp_bot_outbox   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_serving_interests     FROM PUBLIC, anon, authenticated;

-- Threads: 396 granted UPDATE (unread_count, last_read_at). Add the bot
-- controls; the 396 UPDATE policy already limits rows to Missio pastors.
GRANT UPDATE (bot_mode, bot_paused_at, bot_paused_by, bot_handoff_reason) ON TABLE public.missio_whatsapp_threads TO authenticated;

GRANT SELECT ON TABLE public.missio_whatsapp_bot_sessions TO authenticated;
GRANT SELECT ON TABLE public.missio_serving_interests     TO authenticated;
GRANT UPDATE (status) ON TABLE public.missio_serving_interests TO authenticated;
-- missio_whatsapp_bot_outbox: nothing for authenticated. Service role only.

DROP POLICY IF EXISTS "Missio pastors read WhatsApp bot sessions" ON public.missio_whatsapp_bot_sessions;
CREATE POLICY "Missio pastors read WhatsApp bot sessions"
  ON public.missio_whatsapp_bot_sessions FOR SELECT
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']));

DROP POLICY IF EXISTS "Missio pastors read serving interests" ON public.missio_serving_interests;
CREATE POLICY "Missio pastors read serving interests"
  ON public.missio_serving_interests FOR SELECT
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']));

DROP POLICY IF EXISTS "Missio pastors update serving interest status" ON public.missio_serving_interests;
CREATE POLICY "Missio pastors update serving interest status"
  ON public.missio_serving_interests FOR UPDATE
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']))
  WITH CHECK (public.has_org_role_id(org_id, ARRAY['pastor']));


-- ────────────────────────────────────────────────────────────
-- 8. Comments
-- ────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.missio_whatsapp_threads.bot_mode IS
  'on: the WhatsApp menu answers. paused: a pastor has the chat (Pause, Take over, or a pastor reply). handed_off: the person asked for a person. Only on lets the bot send.';
COMMENT ON COLUMN public.missio_whatsapp_messages.wa_reply_id IS
  'Inbound only: the id of the button or list row they tapped. The bot routes on this, not the title.';
COMMENT ON COLUMN public.missio_whatsapp_messages.sent_by_bot IS
  'Outbound only: the WhatsApp menu sent this, not a pastor.';
COMMENT ON TABLE public.missio_whatsapp_bot_sessions IS
  'Where someone is in a WhatsApp menu flow. At most one open (closed_at NULL) per thread. Pastors read; the bot (service role) writes.';
COMMENT ON TABLE public.missio_whatsapp_bot_outbox IS
  'WhatsApp menu sends keyed by the inbound wamid they answer (turn row + one reply row per message), so a retried webhook never sends twice. Service role only.';
COMMENT ON TABLE public.missio_serving_interests IS
  'Answers to "I want to serve" on WhatsApp. contact_id only when the thread is already one Missio person; never creates people. Pastors read and set status.';
COMMENT ON FUNCTION public.missio_whatsapp_bot_stamp() IS
  'Stamps bot_paused_at / bot_paused_by as the signed-in pastor when they change the bot mode; clears them when it goes back on.';

COMMIT;


-- ============================================================
-- Verify:
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--    WHERE table_name = 'missio_whatsapp_threads' AND column_name LIKE 'bot_%' ORDER BY 1;
--                     -- bot_handoff_reason, bot_mode ('on'), bot_paused_at, bot_paused_by
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('missio_whatsapp_bot_sessions', 'missio_whatsapp_bot_outbox', 'missio_serving_interests') ORDER BY 1, 3;
--                     -- sessions: SELECT; interests: SELECT, UPDATE; outbox: none
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name IN ('missio_whatsapp_bot_sessions', 'missio_whatsapp_bot_outbox', 'missio_serving_interests')
--      AND grantee IN ('PUBLIC', 'anon', 'authenticated') ORDER BY 1, 2, 3;
--                     -- authenticated only: sessions SELECT, interests SELECT
--   SELECT table_name, column_name FROM information_schema.column_privileges
--    WHERE grantee = 'authenticated' AND privilege_type = 'UPDATE'
--      AND table_name IN ('missio_whatsapp_threads', 'missio_serving_interests') ORDER BY 1, 2;
--                     -- threads: bot_handoff_reason, bot_mode, bot_paused_at, bot_paused_by,
--                     --          last_read_at, unread_count; interests: status
--   SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'missio_whatsapp_bot_stamp';
--                     -- true, {search_path=""}
--   SELECT count(*) FROM public.missio_whatsapp_bot_sessions;   -- 0 (no seed)
--   SELECT count(*) FROM public.missio_serving_interests;       -- 0 (no seed)
--   Full role matrix: supabase/tests/missio_whatsapp_bot_rls.sql (disposable DB only).
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (deletes every bot session, bot send log and serving interest;
-- 396's threads and messages stay):
--   DROP TABLE IF EXISTS public.missio_serving_interests;
--   DROP TABLE IF EXISTS public.missio_whatsapp_bot_outbox;
--   DROP TABLE IF EXISTS public.missio_whatsapp_bot_sessions;
--   DROP TRIGGER IF EXISTS missio_whatsapp_threads_bot_stamp ON public.missio_whatsapp_threads;
--   DROP FUNCTION IF EXISTS public.missio_whatsapp_bot_stamp();
--   REVOKE UPDATE (bot_mode, bot_paused_at, bot_paused_by, bot_handoff_reason)
--     ON TABLE public.missio_whatsapp_threads FROM authenticated;
--   ALTER TABLE public.missio_whatsapp_messages
--     DROP CONSTRAINT IF EXISTS missio_whatsapp_messages_bot_shape,
--     DROP CONSTRAINT IF EXISTS missio_whatsapp_messages_reply_id_check,
--     DROP COLUMN IF EXISTS sent_by_bot,
--     DROP COLUMN IF EXISTS wa_reply_id;
--   ALTER TABLE public.missio_whatsapp_threads
--     DROP CONSTRAINT IF EXISTS missio_whatsapp_threads_bot_on_shape,
--     DROP CONSTRAINT IF EXISTS missio_whatsapp_threads_bot_reason_check,
--     DROP CONSTRAINT IF EXISTS missio_whatsapp_threads_bot_mode_check,
--     DROP COLUMN IF EXISTS bot_handoff_reason,
--     DROP COLUMN IF EXISTS bot_paused_by,
--     DROP COLUMN IF EXISTS bot_paused_at,
--     DROP COLUMN IF EXISTS bot_mode;
-- ------------------------------------------------------------
