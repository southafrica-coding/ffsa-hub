-- ============================================================
-- FFSA Hub — Migration 396: Missio WhatsApp inbox (the Missio number)
-- ============================================================
-- DRAFT — DO NOT APPLY until Jack has reviewed PR "Missio WhatsApp — send
-- from the Missio number". 395 is taken by the Missio calendar (PR #700).
-- The Hub runs without this: /missio/whatsapp says WhatsApp isn't switched
-- on yet, sends answer 503 not_installed, and the webhook answers 503 so
-- Meta retries later.
--
-- APPLY ORDER: after 329 (organisations, org_staff_roles, has_org_role_id)
-- and 068 (contacts). Nothing else depends on it.
--
-- Pastors message people from Missio's WhatsApp Business number
-- (+27 82 360 7000) inside the Hub, instead of from their own phones.
--
--   missio_whatsapp_threads         one per phone number that Missio has
--                                   written to or heard from. Linked to a
--                                   contact when exactly one Missio person
--                                   has that number; otherwise kept by
--                                   number so a reply is never lost.
--                                   Opt-out (STOP) lives here.
--   missio_whatsapp_messages        every message in and out. wamid (Meta's
--                                   message id) is UNIQUE, so a webhook
--                                   delivered twice stores one row.
--   missio_whatsapp_status_events   every status Meta reports (sent,
--                                   delivered, read, failed), once each.
--                                   Lets a status that beats its message
--                                   be applied when the send finishes.
--
-- Who: Missio pastors only (has_org_role_id(org_id, ['pastor'])) can read
-- threads and messages, and may reset a thread's unread count — nothing
-- else. Every other write is the service role: the webhook (no session)
-- and the send route after its pastor check. Leaders, coaches, FFSA admins
-- and anon get nothing. No secrets, tokens or raw Graph requests are stored.
--
-- Only adds objects. Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE,
-- and triggers and policies are dropped by name first. No seed rows.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Threads
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.missio_whatsapp_threads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  contact_id       uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  -- E.164 with the plus (+27823607000): the key, and the Graph `to`.
  phone_e164       text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- As WhatsApp writes it (27823607000).
  wa_id            text NOT NULL CHECK (wa_id ~ '^[1-9][0-9]{7,14}$'),
  -- The name they use on WhatsApp, from the webhook. Shown when unmatched.
  profile_name     text CHECK (profile_name IS NULL OR length(profile_name) <= 120),
  -- Their last message: opens the 24-hour free-reply window.
  last_inbound_at  timestamptz,
  last_outbound_at timestamptz,
  last_message_at  timestamptz,
  last_message_id  uuid,
  last_preview     text CHECK (last_preview IS NULL OR length(last_preview) <= 200),
  last_direction   text CHECK (last_direction IS NULL OR last_direction IN ('in', 'out')),
  unread_count     integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_read_at     timestamptz,
  -- Set by an inbound STOP / UNSUBSCRIBE, cleared only by an inbound START / YES.
  opted_out_at     timestamptz,
  opt_changed_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_whatsapp_threads_number_match CHECK (phone_e164 = '+' || wa_id),
  CONSTRAINT missio_whatsapp_threads_org_phone_key UNIQUE (org_id, phone_e164),
  -- Target of the messages' composite FK, so a message can't point at another org's thread.
  CONSTRAINT missio_whatsapp_threads_id_org_key UNIQUE (id, org_id)
);

CREATE INDEX IF NOT EXISTS missio_whatsapp_threads_org_last_idx
  ON public.missio_whatsapp_threads (org_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS missio_whatsapp_threads_contact_idx
  ON public.missio_whatsapp_threads (contact_id) WHERE contact_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 2. Messages
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.missio_whatsapp_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  thread_id         uuid NOT NULL,
  direction         text NOT NULL CHECK (direction IN ('in', 'out')),
  -- text: typed words. template: an approved template, body filled in.
  -- placeholder: media or a type v1 doesn't show ("[Photo]").
  kind              text NOT NULL CHECK (kind IN ('text', 'template', 'placeholder')),
  -- WhatsApp's own type (text, image, button, …) for debugging.
  wa_type           text CHECK (wa_type IS NULL OR length(wa_type) <= 40),
  body              text NOT NULL CHECK (length(body) <= 8000),
  template_name     text CHECK (template_name IS NULL OR length(template_name) <= 512),
  template_language text CHECK (template_language IS NULL OR length(template_language) <= 15),
  -- The values filled into the template's blanks, keyed "body:1" / "header:name".
  template_vars     jsonb CHECK (template_vars IS NULL OR jsonb_typeof(template_vars) = 'object'),
  -- Meta's message id. NULL only while an outbound message is being handed to Meta.
  wamid             text UNIQUE CHECK (wamid IS NULL OR length(wamid) BETWEEN 1 AND 256),
  status            text NOT NULL CHECK (status IN ('received', 'pending', 'accepted', 'sent', 'delivered', 'read', 'failed')),
  error_code        integer,
  error_title       text CHECK (error_title IS NULL OR length(error_title) <= 300),
  opt_change        text CHECK (opt_change IS NULL OR opt_change IN ('opt_out', 'opt_in')),
  -- The pastor who sent it. NULL for inbound.
  sent_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- WhatsApp's timestamp for inbound; when the pastor pressed send for outbound.
  sent_at           timestamptz NOT NULL,
  status_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_whatsapp_messages_thread_fkey
    FOREIGN KEY (thread_id, org_id) REFERENCES public.missio_whatsapp_threads (id, org_id) ON DELETE CASCADE,
  CONSTRAINT missio_whatsapp_messages_direction_shape CHECK (
    (direction = 'in'  AND status = 'received' AND wamid IS NOT NULL AND sent_by IS NULL AND kind <> 'template')
    OR
    (direction = 'out' AND status <> 'received' AND kind <> 'placeholder'
       AND (status = 'pending' OR status = 'failed' OR wamid IS NOT NULL))
  ),
  CONSTRAINT missio_whatsapp_messages_template_shape CHECK (
    (kind = 'template') = (template_name IS NOT NULL AND template_language IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS missio_whatsapp_messages_thread_idx
  ON public.missio_whatsapp_messages (thread_id, sent_at DESC);


-- ────────────────────────────────────────────────────────────
-- 3. Status log
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.missio_whatsapp_status_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES public.organisations(id) ON DELETE RESTRICT,
  wamid       text NOT NULL CHECK (length(wamid) BETWEEN 1 AND 256),
  status      text NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  at          timestamptz NOT NULL,
  error_code  integer,
  error_title text CHECK (error_title IS NULL OR length(error_title) <= 300),
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_whatsapp_status_events_wamid_status_key UNIQUE (wamid, status)
);


-- ────────────────────────────────────────────────────────────
-- 4. updated_at
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.missio_whatsapp_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS missio_whatsapp_threads_touch ON public.missio_whatsapp_threads;
CREATE TRIGGER missio_whatsapp_threads_touch
  BEFORE UPDATE ON public.missio_whatsapp_threads
  FOR EACH ROW EXECUTE FUNCTION public.missio_whatsapp_touch();

DROP TRIGGER IF EXISTS missio_whatsapp_messages_touch ON public.missio_whatsapp_messages;
CREATE TRIGGER missio_whatsapp_messages_touch
  BEFORE UPDATE ON public.missio_whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.missio_whatsapp_touch();


-- ────────────────────────────────────────────────────────────
-- 5. A new message moves its thread on (service role only)
-- ────────────────────────────────────────────────────────────
-- One UPDATE, so two webhooks at once can't lose an unread count. "Last"
-- fields and opt-out follow WhatsApp's timestamps, so a late-delivered old
-- message never overwrites a newer one, and an old STOP never undoes a
-- newer START.
CREATE OR REPLACE FUNCTION public.missio_whatsapp_bump_thread(
  p_thread_id  uuid,
  p_message_id uuid,
  p_direction  text,
  p_at         timestamptz,
  p_preview    text,
  p_opt_change text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = '' AS $$
BEGIN
  IF p_direction NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'missio_whatsapp_bad_direction';
  END IF;
  IF p_opt_change IS NOT NULL AND p_opt_change NOT IN ('opt_out', 'opt_in') THEN
    RAISE EXCEPTION 'missio_whatsapp_bad_opt_change';
  END IF;

  UPDATE public.missio_whatsapp_threads t SET
    last_inbound_at  = CASE WHEN p_direction = 'in'
                            THEN greatest(coalesce(t.last_inbound_at, p_at), p_at)
                            ELSE t.last_inbound_at END,
    last_outbound_at = CASE WHEN p_direction = 'out'
                            THEN greatest(coalesce(t.last_outbound_at, p_at), p_at)
                            ELSE t.last_outbound_at END,
    unread_count     = t.unread_count + CASE WHEN p_direction = 'in' THEN 1 ELSE 0 END,
    last_message_at  = CASE WHEN t.last_message_at IS NULL OR p_at >= t.last_message_at THEN p_at ELSE t.last_message_at END,
    last_message_id  = CASE WHEN t.last_message_at IS NULL OR p_at >= t.last_message_at THEN p_message_id ELSE t.last_message_id END,
    last_preview     = CASE WHEN t.last_message_at IS NULL OR p_at >= t.last_message_at THEN left(p_preview, 200) ELSE t.last_preview END,
    last_direction   = CASE WHEN t.last_message_at IS NULL OR p_at >= t.last_message_at THEN p_direction ELSE t.last_direction END,
    opted_out_at     = CASE WHEN p_opt_change IS NOT NULL AND (t.opt_changed_at IS NULL OR p_at >= t.opt_changed_at)
                            THEN CASE WHEN p_opt_change = 'opt_out' THEN p_at ELSE NULL END
                            ELSE t.opted_out_at END,
    opt_changed_at   = CASE WHEN p_opt_change IS NOT NULL AND (t.opt_changed_at IS NULL OR p_at >= t.opt_changed_at)
                            THEN p_at ELSE t.opt_changed_at END
  WHERE t.id = p_thread_id;
END;
$$;

REVOKE ALL ON FUNCTION public.missio_whatsapp_bump_thread(uuid, uuid, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.missio_whatsapp_bump_thread(uuid, uuid, text, timestamptz, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.missio_whatsapp_touch() FROM PUBLIC, anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- 6. RLS — Missio pastors read; they may only mark read; no anon
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.missio_whatsapp_threads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_whatsapp_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_whatsapp_status_events ENABLE ROW LEVEL SECURITY;

-- No TRUNCATE / REFERENCES / TRIGGER for anyone. service_role keeps ALL
-- (default privileges): the webhook and the send route write through it.
REVOKE ALL ON TABLE public.missio_whatsapp_threads       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_whatsapp_messages      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_whatsapp_status_events FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.missio_whatsapp_threads  TO authenticated;
GRANT UPDATE (unread_count, last_read_at) ON TABLE public.missio_whatsapp_threads TO authenticated;
GRANT SELECT ON TABLE public.missio_whatsapp_messages TO authenticated;
-- missio_whatsapp_status_events: nothing for authenticated. Service role only.

DROP POLICY IF EXISTS "Missio pastors read WhatsApp threads" ON public.missio_whatsapp_threads;
CREATE POLICY "Missio pastors read WhatsApp threads"
  ON public.missio_whatsapp_threads FOR SELECT
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']));

DROP POLICY IF EXISTS "Missio pastors mark WhatsApp threads read" ON public.missio_whatsapp_threads;
CREATE POLICY "Missio pastors mark WhatsApp threads read"
  ON public.missio_whatsapp_threads FOR UPDATE
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']))
  WITH CHECK (public.has_org_role_id(org_id, ARRAY['pastor']));

DROP POLICY IF EXISTS "Missio pastors read WhatsApp messages" ON public.missio_whatsapp_messages;
CREATE POLICY "Missio pastors read WhatsApp messages"
  ON public.missio_whatsapp_messages FOR SELECT
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor']));


-- ────────────────────────────────────────────────────────────
-- 7. Comments
-- ────────────────────────────────────────────────────────────
COMMENT ON TABLE public.missio_whatsapp_threads IS
  'One conversation per phone number on the Missio WhatsApp number. contact_id when exactly one Missio person has the number. opted_out_at set by an inbound STOP, cleared only by an inbound START/YES. Pastors read and mark read; writes are service role.';
COMMENT ON COLUMN public.missio_whatsapp_threads.last_inbound_at IS
  'WhatsApp timestamp of their latest message. Free text may be sent for 24 hours after it; otherwise only an approved template.';
COMMENT ON TABLE public.missio_whatsapp_messages IS
  'Every WhatsApp message in and out of the Missio number. wamid is unique (webhook retries store one row). Outbound status only moves forward: pending → accepted → sent → delivered → read, or failed. Media is not stored (placeholder text).';
COMMENT ON TABLE public.missio_whatsapp_status_events IS
  'Every status Meta reported for a Missio message, once per (wamid, status). Service role only.';
COMMENT ON FUNCTION public.missio_whatsapp_bump_thread(uuid, uuid, text, timestamptz, text, text) IS
  'Moves a thread on after a new message: last fields, unread count (inbound) and opt-out, by WhatsApp timestamp. Service role only.';

COMMIT;


-- ============================================================
-- Verify:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename LIKE 'missio_whatsapp_%' ORDER BY 1, 3;
--                     -- threads: SELECT, UPDATE; messages: SELECT; status_events: none
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name LIKE 'missio_whatsapp_%' AND grantee IN ('PUBLIC','anon','authenticated') ORDER BY 1, 2, 3;
--                     -- authenticated only: threads SELECT, messages SELECT
--   SELECT table_name, column_name, privilege_type FROM information_schema.column_privileges
--    WHERE table_name = 'missio_whatsapp_threads' AND grantee = 'authenticated' AND privilege_type = 'UPDATE';
--                     -- unread_count, last_read_at (plus SELECT on every column)
--   SELECT has_function_privilege('authenticated',
--     'public.missio_whatsapp_bump_thread(uuid, uuid, text, timestamptz, text, text)', 'EXECUTE');   -- false
--   SELECT count(*) FROM public.missio_whatsapp_threads;   -- 0 (no seed)
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK (deletes every stored WhatsApp message and opt-out):
--   DROP FUNCTION IF EXISTS public.missio_whatsapp_bump_thread(uuid, uuid, text, timestamptz, text, text);
--   DROP TABLE IF EXISTS public.missio_whatsapp_status_events;
--   DROP TABLE IF EXISTS public.missio_whatsapp_messages;
--   DROP TABLE IF EXISTS public.missio_whatsapp_threads;
--   DROP FUNCTION IF EXISTS public.missio_whatsapp_touch();
-- ------------------------------------------------------------
