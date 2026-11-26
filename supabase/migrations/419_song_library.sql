-- ============================================================
-- FFSA Hub — Migration 419: Song Library (base-wide Hub Service)
-- ============================================================
-- Depends on 318 (dept_caller_is_active), 319 (services, service_owners,
-- user_can_use_service) and the existing is_admin() / handle_updated_at().
-- Independent of 416 and 417. 418 is held for the L10 org-links
-- follow-up. Applied by hand, on prod only with Jack's explicit OK.
--
-- What it is. Any signed-in active user can upload a song and read every
-- song in the library (the whole base, no private switch). Prayer &
-- Worship owns and manages the service. Spec:
-- departments/mockups/pw/songlib-v1/data-shape.md.
--
-- Service. services.service_key = 'song_library'. service_owners rows:
--   prayer_and_worship  own     member_role 'member'
--   prayer_and_worship  manage  member_role 'member'
--   (all)               use     open_to_all
-- The slug appears only in that seed. No policy or helper names a
-- ministry: "who manages" is whoever holds a manage grant on
-- song_library in service_owners (alias folding and member_role read
-- the same way as user_can_use_service in 319). "Who reads" is
-- user_can_use_service('song_library'), which the open_to_all row makes
-- every active account.
--
-- Who does what (RLS; admin = active is_admin(), full access except
-- where noted):
--   read      every row, every table, for an active user who can use the
--             service (celebrate notes included). Exceptions:
--             subscriptions and notifications (own rows only).
--   writers   (song_library_writers rows with their user_id, lead or
--             co-writer) edit their song and its versions, writers and
--             splits, pathway, refine, share steps, celebrate notes and
--             publishing. They may move their song between the early
--             stages (idea_entry, writing, set_down, refine,
--             written_needs_demo), but not into or out of demo_ready,
--             share or celebrate. They confirm their own split.
--   managers  (manage grant: every active P&W member) move any stage,
--             set placement, tick every checkpoint except
--             credits_splits_agreed (derived, see Splits; they may
--             untick or delete it to revoke), edit publishing, confirm
--             splits for writers with no Hub account, withdraw any
--             confirmation, and manage help requests and stuck thresholds. A
--             trigger stops a manager who is not a writer from changing
--             anything else on the song.
--   anyone    uploads a song (becomes its lead writer), manages their own
--             helper categories, help sign-ups and subscriptions.
--   anon      nothing. No grants.
--
-- Splits: per-writer sign-off. Each song_library_writers row carries
-- confirmed_at / confirmed_by. A writer with a Hub account confirms only
-- their own row; a row with no account is confirmed by a manager or an
-- admin (or the service role). Splits are agreed exactly when the song has
-- at least one writer, every writer has a split, the splits total 100.00
-- and every row is confirmed.
-- Credit fields are user_id, display_name, role, is_lead and split_pct,
-- plus adding or removing a writer. While not agreed, any credit change
-- clears every confirmation on the song. While agreed, credit changes are
-- refused (23514) on every path; the agreement has to be revoked first.
-- Revoking = un-confirming any row (that writer, a manager or an admin),
-- or a manager/admin unticking or deleting the credits_splits_agreed
-- checkpoint. A revocation clears every confirmation and writes a
-- stage_events row (kind checkpoint, payload revoked/deleted/
-- cleared_confirmations, by_user, at).
-- The credits_splits_agreed checkpoint is derived: a trigger ticks it
-- when the song becomes agreed and unticks it when it stops being agreed.
-- Nobody ticks it by hand. A DEFERRABLE INITIALLY DEFERRED constraint
-- trigger on writers and checkpoints (INSERT, UPDATE and DELETE) checks
-- at commit that it is ticked if and only if the splits are agreed.
-- song_library_song_status.splits_agreed exposes it.
--
-- Storage. Private bucket 'song-library', 200 MB, audio + PDF + images.
-- Object path: {song_id}/{anything}, e.g. {song_id}/v3-<uuid>.mp3 or
-- {song_id}/chart-<uuid>.pdf. storage.objects policies mirror the table
-- RLS: read = can read the library and the song exists; upload and
-- delete = a writer of that song, or an admin. No UPDATE (no overwrite).
--
-- source_training_id is a nullable uuid with NO foreign key yet.
-- pw_songwriting_trainings is created by 417, which is not merged. A
-- conditional FK would make the schema depend on apply order and would
-- make 417's rollback (plain DROP TABLE) fail. Follow-up once 417 is in,
-- in the same migration that teaches 417's rollback to drop it first:
--   ALTER TABLE public.song_library_songs
--     ADD CONSTRAINT song_library_songs_source_training_id_fkey
--     FOREIGN KEY (source_training_id)
--     REFERENCES public.pw_songwriting_trainings (id) ON DELETE SET NULL
--     NOT VALID;
--   ALTER TABLE public.song_library_songs
--     VALIDATE CONSTRAINT song_library_songs_source_training_id_fkey;
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS
-- before CREATE, ON CONFLICT / NOT EXISTS seeds. Safe to re-run.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Access helpers that need no song_library table
-- ────────────────────────────────────────────────────────────
-- search_path '' and schema-qualified names, as 318–321. SECURITY
-- DEFINER so policies can see writers and memberships without passing
-- those tables' own RLS. Policies call them as (SELECT ...) so Postgres
-- runs each once per statement.

CREATE OR REPLACE FUNCTION public.song_library_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active() AND public.is_admin();
$$;

-- Every active account while the open_to_all use row exists.
CREATE OR REPLACE FUNCTION public.song_library_can_read()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (public.is_admin() OR public.user_can_use_service('song_library'));
$$;

-- An active member of an active ministry holding a manage grant on
-- song_library, resolved like user_can_use_service (alias home,
-- member_role). Admins are not included; policies add
-- song_library_is_admin() themselves.
CREATE OR REPLACE FUNCTION public.song_library_can_manage()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND EXISTS (
       SELECT 1
         FROM public.staff_ministry_members mm
         JOIN public.staff_ministries sm
           ON sm.id = mm.staff_ministry_id
          AND sm.is_active
         LEFT JOIN public.staff_ministry_aliases al
           ON al.staff_ministry_id = sm.id
         JOIN public.service_owners so
           ON so.service_key = 'song_library'
          AND so.capability = 'manage'
          AND NOT so.open_to_all
          AND NOT so.any_point_leader
          AND (so.staff_ministry_id = sm.id OR so.staff_ministry_id = al.resolves_to_id)
          AND (
            so.member_role IS NULL
            OR so.member_role = mm.member_role
            OR (so.member_role = 'member' AND mm.member_role = 'leader')
          )
        WHERE mm.user_id = auth.uid()
          AND mm.status = 'active'
     );
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Tables
-- ────────────────────────────────────────────────────────────
-- Enumerations are text + CHECK (repo style), not Postgres enums.
-- Stages, in order: idea_entry, writing, set_down, refine,
-- written_needs_demo, demo_ready, share, celebrate.
-- Finished = demo_ready or later. Needs demo = written_needs_demo.

CREATE TABLE IF NOT EXISTS public.song_library_songs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                  text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  created_by             uuid REFERENCES public.users (id) ON DELETE SET NULL,
  entry_point            text NOT NULL CHECK (entry_point IN ('lyric', 'melody', 'instrumental')),
  pathway                text CHECK (pathway IN ('b1', 'b2')),
  holy_spirit_interrupt  boolean NOT NULL DEFAULT false,
  stage                  text NOT NULL DEFAULT 'idea_entry' CHECK (stage IN (
                           'idea_entry', 'writing', 'set_down', 'refine',
                           'written_needs_demo', 'demo_ready', 'share', 'celebrate')),
  placement              text NOT NULL DEFAULT 'inbox' CHECK (placement IN (
                           'inbox', 'prayer_sets', 'ministry_nights', 'events',
                           'ffsa_music', 'personal')),
  music_key              text CHECK (music_key IS NULL OR char_length(btrim(music_key)) BETWEEN 1 AND 12),
  bpm                    smallint CHECK (bpm IS NULL OR bpm BETWEEN 20 AND 400),
  lyrics_md              text CHECK (lyrics_md IS NULL OR char_length(lyrics_md) <= 20000),
  chart_path             text,
  current_version_id     uuid,
  visibility             text NOT NULL DEFAULT 'base' CHECK (visibility = 'base'),
  source_training_id     uuid,
  last_activity_at       timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT song_library_songs_chart_path_in_song_folder
    CHECK (chart_path IS NULL OR (chart_path LIKE id::text || '/_%' AND position('..' IN chart_path) = 0))
);

CREATE INDEX IF NOT EXISTS song_library_songs_created_by_idx ON public.song_library_songs (created_by);
CREATE INDEX IF NOT EXISTS song_library_songs_stage_activity_idx ON public.song_library_songs (stage, last_activity_at);
CREATE INDEX IF NOT EXISTS song_library_songs_placement_idx ON public.song_library_songs (placement);
CREATE INDEX IF NOT EXISTS song_library_songs_source_training_id_idx
  ON public.song_library_songs (source_training_id) WHERE source_training_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS song_library_songs_current_version_idx
  ON public.song_library_songs (current_version_id) WHERE current_version_id IS NOT NULL;

COMMENT ON TABLE public.song_library_songs IS
  'Song Library song. Readable by every active account (visibility is always base). Writers edit; managers of the song_library service move stage and placement.';
COMMENT ON COLUMN public.song_library_songs.pathway IS
  'Order of the two steps after entry_point. b1 = the remaining two in lyric, melody, instrumental order; b2 = reversed. Melody entry: b1 = lyric then instrumental. Null = not chosen (for example a Holy Spirit moment).';
COMMENT ON COLUMN public.song_library_songs.placement IS
  'personal = Personal (Devo/Balladeers). Only managers (and admins) change it.';
COMMENT ON COLUMN public.song_library_songs.chart_path IS
  'Object name in the song-library bucket, under this song''s folder: {song_id}/...';
COMMENT ON COLUMN public.song_library_songs.current_version_id IS
  'Version the player opens. Set to the first upload automatically; writers change it. Must belong to this song.';
COMMENT ON COLUMN public.song_library_songs.source_training_id IS
  'Optional pw_songwriting_trainings.id (migration 417). No FK until 417 is merged; see the 419 header for the follow-up.';
COMMENT ON COLUMN public.song_library_songs.last_activity_at IS
  'Last progress: stage, placement, new version, checkpoint, pathway step or refine change. Maintained by triggers; drives stuck.';

CREATE TABLE IF NOT EXISTS public.song_library_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id       uuid NOT NULL REFERENCES public.song_library_songs (id) ON DELETE CASCADE,
  n             integer NOT NULL CHECK (n >= 1),
  label         text CHECK (label IS NULL OR char_length(label) <= 200),
  storage_path  text NOT NULL UNIQUE,
  mime_type     text CHECK (mime_type IS NULL OR mime_type ~ '^(audio|application|image)/[A-Za-z0-9.+-]+$'),
  size_bytes    bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  duration_s    numeric(8, 2) CHECK (duration_s IS NULL OR duration_s >= 0),
  is_demo       boolean NOT NULL DEFAULT false,
  isrc          text CHECK (isrc IS NULL OR isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
  uploaded_by   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT song_library_versions_song_n_key UNIQUE (song_id, n),
  CONSTRAINT song_library_versions_song_id_id_key UNIQUE (song_id, id),
  CONSTRAINT song_library_versions_path_in_song_folder
    CHECK (storage_path LIKE song_id::text || '/_%' AND position('..' IN storage_path) = 0)
);

CREATE INDEX IF NOT EXISTS song_library_versions_uploaded_by_idx ON public.song_library_versions (uploaded_by);

COMMENT ON TABLE public.song_library_versions IS
  'Audio versions of a song. n is assigned 1, 2, 3... per song by trigger. storage_path is the object name in the private song-library bucket.';
COMMENT ON COLUMN public.song_library_versions.isrc IS
  'ISRC of this recording, 12 characters without hyphens (CCYYYNNNNNNN style: 2 letters, 3 alphanumerics, 7 digits).';

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'song_library_songs_current_version_fkey'
       AND conrelid = 'public.song_library_songs'::regclass
  ) THEN
    ALTER TABLE public.song_library_songs
      ADD CONSTRAINT song_library_songs_current_version_fkey
      FOREIGN KEY (id, current_version_id)
      REFERENCES public.song_library_versions (song_id, id)
      ON DELETE SET NULL (current_version_id);
  END IF;
END
$fk$;

CREATE TABLE IF NOT EXISTS public.song_library_pathway_steps (
  song_id   uuid NOT NULL REFERENCES public.song_library_songs (id) ON DELETE CASCADE,
  step      text NOT NULL CHECK (step IN ('lyric', 'melody', 'instrumental')),
  done_at   timestamptz NOT NULL DEFAULT now(),
  by_user   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  PRIMARY KEY (song_id, step)
);
CREATE INDEX IF NOT EXISTS song_library_pathway_steps_by_user_idx ON public.song_library_pathway_steps (by_user);
COMMENT ON TABLE public.song_library_pathway_steps IS 'Writing sub-progress. A row means that step is done; delete it to undo.';

CREATE TABLE IF NOT EXISTS public.song_library_stage_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id     uuid NOT NULL REFERENCES public.song_library_songs (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('stage', 'placement', 'checkpoint', 'version', 'writer')),
  from_stage  text CHECK (from_stage IN ('idea_entry', 'writing', 'set_down', 'refine',
                'written_needs_demo', 'demo_ready', 'share', 'celebrate')),
  to_stage    text CHECK (to_stage IN ('idea_entry', 'writing', 'set_down', 'refine',
                'written_needs_demo', 'demo_ready', 'share', 'celebrate')),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  by_user     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  note        text CHECK (note IS NULL OR char_length(note) <= 1000),
  CONSTRAINT song_library_stage_events_stage_cols
    CHECK ((kind = 'stage') = (to_stage IS NOT NULL) AND (kind = 'stage' OR from_stage IS NULL))
);
CREATE INDEX IF NOT EXISTS song_library_stage_events_song_at_idx ON public.song_library_stage_events (song_id, at DESC);
CREATE INDEX IF NOT EXISTS song_library_stage_events_by_user_idx ON public.song_library_stage_events (by_user);
COMMENT ON TABLE public.song_library_stage_events IS
  '"Where it''s been". Written only by triggers. payload: placement {from,to}; checkpoint {checkpoint,done,note}; version {version_id,n,label}; writer {action,writer_id,user_id,display_name}; stage on insert {created:true}. The actor may edit note.';

CREATE TABLE IF NOT EXISTS public.song_library_refine_items (
  song_id   uuid NOT NULL REFERENCES public.song_library_songs (id) ON DELETE CASCADE,
  q_no      smallint NOT NULL CHECK (q_no BETWEEN 1 AND 11),
  checked   boolean NOT NULL DEFAULT false,
  note      text CHECK (note IS NULL OR char_length(note) <= 2000),
  by_user   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (song_id, q_no)
);
CREATE INDEX IF NOT EXISTS song_library_refine_items_by_user_idx ON public.song_library_refine_items (by_user);
COMMENT ON TABLE public.song_library_refine_items IS
  'Refine checklist answers. q_no 1-10 are the handbook questions (text lives in code); 11 is the bonus "Are you satisfied and happy with the song?". by_user and at are stamped on every write.';

CREATE TABLE IF NOT EXISTS public.song_library_share_steps (
  song_id   uuid NOT NULL REFERENCES public.song_library_songs (id) ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind IN ('close_friend', 'group_open_mic', 'social', 'congregation', 'record_release')),
  done_at   timestamptz NOT NULL DEFAULT now(),
  by_user   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  PRIMARY KEY (song_id, kind)
);
CREATE INDEX IF NOT EXISTS song_library_share_steps_by_user_idx ON public.song_library_share_steps (by_user);

CREATE TABLE IF NOT EXISTS public.song_library_celebrate_notes (
  song_id     uuid NOT NULL REFERENCES public.song_library_songs (id) ON DELETE CASCADE,
  prompt_no   smallint NOT NULL CHECK (prompt_no BETWEEN 1 AND 5),
  body        text NOT NULL CHECK (btrim(body) <> '' AND char_length(body) <= 4000),
  by_user     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (song_id, prompt_no)
);
CREATE INDEX IF NOT EXISTS song_library_celebrate_notes_by_user_idx ON public.song_library_celebrate_notes (by_user);
COMMENT ON TABLE public.song_library_celebrate_notes IS 'Optional Celebrate reflections. Read by every active user like the rest of the song; written by the song''s writers (and admins).';

CREATE TABLE IF NOT EXISTS public.song_library_writers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id       uuid NOT NULL REFERENCES public.song_library_songs (id) ON DELETE CASCADE,
  user_id       uuid REFERENCES public.users (id) ON DELETE SET NULL,
  display_name  text CHECK (display_name IS NULL OR (btrim(display_name) <> '' AND char_length(display_name) <= 120)),
  role          text CHECK (role IS NULL OR char_length(role) <= 120),
  is_lead       boolean NOT NULL DEFAULT false,
  split_pct     numeric(5, 2) CHECK (split_pct IS NULL OR (split_pct >= 0 AND split_pct <= 100)),
  added_by      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  confirmed_at  timestamptz,
  confirmed_by  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT song_library_writers_song_user_key UNIQUE (song_id, user_id),
  CONSTRAINT song_library_writers_named CHECK (user_id IS NOT NULL OR display_name IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS song_library_writers_one_lead
  ON public.song_library_writers (song_id) WHERE is_lead;
CREATE INDEX IF NOT EXISTS song_library_writers_user_id_idx ON public.song_library_writers (user_id);
CREATE INDEX IF NOT EXISTS song_library_writers_added_by_idx ON public.song_library_writers (added_by);
CREATE INDEX IF NOT EXISTS song_library_writers_confirmed_by_idx ON public.song_library_writers (confirmed_by);
COMMENT ON TABLE public.song_library_writers IS
  'Writers and co-writers with splits. The uploader becomes the lead writer automatically. user_id null = someone without a Hub account (display_name required). Agreed = total 100.00 and every row confirmed; any split change or writer add/remove clears all confirmations.';
COMMENT ON COLUMN public.song_library_writers.confirmed_at IS
  'This writer''s sign-off on the current splits. Set by the writer themself (account rows) or by a manager/admin (no-account rows); confirmed_by and the time are stamped by trigger. Needs a split.';
COMMENT ON COLUMN public.song_library_writers.role IS 'Free-text credit, for example "Melody, music" or "Bridge lyric".';

CREATE TABLE IF NOT EXISTS public.song_library_publishing (
  song_id        uuid PRIMARY KEY REFERENCES public.song_library_songs (id) ON DELETE CASCADE,
  ccli_no        text CHECK (ccli_no IS NULL OR ccli_no ~ '^[0-9]{1,10}$'),
  publisher      text CHECK (publisher IS NULL OR char_length(publisher) <= 200),
  pro_by_writer  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pro_by_writer) = 'object'),
  notes          text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  updated_by     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS song_library_publishing_updated_by_idx ON public.song_library_publishing (updated_by);
COMMENT ON COLUMN public.song_library_publishing.pro_by_writer IS
  'Object keyed by song_library_writers.id: {"<writer id>": {"pro": "SAMRO", "member_no": "123"}}. ISRC is per recording, on song_library_versions.';

CREATE TABLE IF NOT EXISTS public.song_library_checkpoints (
  song_id     uuid NOT NULL REFERENCES public.song_library_songs (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('credits_splits_agreed', 'prayer_room_test',
                'ministry_night_debut', 'event', 'recording')),
  done_at     timestamptz,
  by_user     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  note        text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (song_id, kind)
);
CREATE INDEX IF NOT EXISTS song_library_checkpoints_by_user_idx ON public.song_library_checkpoints (by_user);
COMMENT ON TABLE public.song_library_checkpoints IS
  'Placement checkpoints. Ticked = done_at not null. credits_splits_agreed is derived from the writers'' confirmations and is never written directly; the rest are ticked by managers.';

CREATE TABLE IF NOT EXISTS public.song_library_helpers (
  user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  category    text NOT NULL CHECK (category IN ('vocals', 'keys', 'guitar', 'bass', 'drums',
                'demo_production', 'lyric_feedback', 'charts')),
  note        text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);
CREATE INDEX IF NOT EXISTS song_library_helpers_category_idx ON public.song_library_helpers (category);
COMMENT ON TABLE public.song_library_helpers IS 'Helper profile: one row per category a person helps with. Each person manages their own.';

CREATE TABLE IF NOT EXISTS public.song_library_help_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id         uuid NOT NULL REFERENCES public.song_library_songs (id) ON DELETE CASCADE,
  asked_by        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  categories      text[] NOT NULL CHECK (
                    cardinality(categories) BETWEEN 1 AND 8
                    AND categories <@ ARRAY['vocals', 'keys', 'guitar', 'bass', 'drums',
                      'demo_production', 'lyric_feedback', 'charts']::text[]),
  body            text NOT NULL CHECK (btrim(body) <> '' AND char_length(body) <= 2000),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'closed')),
  helper_user_id  uuid REFERENCES public.users (id) ON DELETE SET NULL,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT song_library_help_requests_closed_at CHECK ((status = 'open') = (closed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS song_library_help_requests_song_id_idx ON public.song_library_help_requests (song_id);
CREATE INDEX IF NOT EXISTS song_library_help_requests_asked_by_idx ON public.song_library_help_requests (asked_by);
CREATE INDEX IF NOT EXISTS song_library_help_requests_helper_user_id_idx ON public.song_library_help_requests (helper_user_id);
CREATE INDEX IF NOT EXISTS song_library_help_requests_open_idx
  ON public.song_library_help_requests (created_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS song_library_help_requests_categories_gin
  ON public.song_library_help_requests USING gin (categories);
COMMENT ON COLUMN public.song_library_help_requests.helper_user_id IS
  'Who helped, set by the requester or a manager when filling it. closed_at is stamped when status leaves open.';

CREATE TABLE IF NOT EXISTS public.song_library_help_signups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES public.song_library_help_requests (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  note        text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT song_library_help_signups_request_user_key UNIQUE (request_id, user_id)
);
CREATE INDEX IF NOT EXISTS song_library_help_signups_user_id_idx ON public.song_library_help_signups (user_id);
COMMENT ON TABLE public.song_library_help_signups IS '"I can help" on a request. Only while the request is open.';

CREATE TABLE IF NOT EXISTS public.song_library_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  target_type     text NOT NULL CHECK (target_type IN ('all_uploads', 'writer')),
  target_user_id  uuid REFERENCES public.users (id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT song_library_subscriptions_target
    CHECK ((target_type = 'writer') = (target_user_id IS NOT NULL)),
  CONSTRAINT song_library_subscriptions_not_self
    CHECK (target_user_id IS DISTINCT FROM user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS song_library_subscriptions_all_uploads_key
  ON public.song_library_subscriptions (user_id) WHERE target_type = 'all_uploads';
CREATE UNIQUE INDEX IF NOT EXISTS song_library_subscriptions_writer_key
  ON public.song_library_subscriptions (user_id, target_user_id) WHERE target_type = 'writer';
CREATE INDEX IF NOT EXISTS song_library_subscriptions_user_id_idx ON public.song_library_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS song_library_subscriptions_target_user_id_idx ON public.song_library_subscriptions (target_user_id);
COMMENT ON TABLE public.song_library_subscriptions IS
  'Slack DM subscriptions. all_uploads = every new song and every move to demo_ready or later; writer = the same for songs that writer is on. Each person sees and manages only their own; song_library_writer_subscriber_count() gives the count.';

CREATE TABLE IF NOT EXISTS public.song_library_notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  song_id          uuid NOT NULL REFERENCES public.song_library_songs (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('new_upload', 'stage_moved', 'help_asked')),
  stage_event_id   uuid REFERENCES public.song_library_stage_events (id) ON DELETE CASCADE,
  help_request_id  uuid REFERENCES public.song_library_help_requests (id) ON DELETE CASCADE,
  reason           text NOT NULL CHECK (reason IN ('all_uploads', 'writer', 'helper_category')),
  slack_ts         text,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT song_library_notifications_refs CHECK (
    ((kind = 'stage_moved') = (stage_event_id IS NOT NULL))
    AND ((kind = 'help_asked') = (help_request_id IS NOT NULL))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS song_library_notifications_new_upload_key
  ON public.song_library_notifications (user_id, song_id) WHERE kind = 'new_upload';
CREATE UNIQUE INDEX IF NOT EXISTS song_library_notifications_stage_moved_key
  ON public.song_library_notifications (user_id, stage_event_id) WHERE kind = 'stage_moved';
CREATE UNIQUE INDEX IF NOT EXISTS song_library_notifications_help_asked_key
  ON public.song_library_notifications (user_id, help_request_id) WHERE kind = 'help_asked';
CREATE INDEX IF NOT EXISTS song_library_notifications_user_id_idx ON public.song_library_notifications (user_id);
CREATE INDEX IF NOT EXISTS song_library_notifications_song_id_idx ON public.song_library_notifications (song_id);
CREATE INDEX IF NOT EXISTS song_library_notifications_stage_event_id_idx
  ON public.song_library_notifications (stage_event_id) WHERE stage_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS song_library_notifications_help_request_id_idx
  ON public.song_library_notifications (help_request_id) WHERE help_request_id IS NOT NULL;
COMMENT ON TABLE public.song_library_notifications IS
  'Slack DM outbox and idempotency claim: one row per person per upload / stage event / help request (INSERT ... ON CONFLICT DO NOTHING, then DM, then set slack_ts and sent_at). Service role writes; each person reads their own.';

CREATE TABLE IF NOT EXISTS public.song_library_stage_settings (
  stage             text PRIMARY KEY CHECK (stage IN ('idea_entry', 'writing', 'set_down', 'refine',
                      'written_needs_demo', 'demo_ready', 'share', 'celebrate')),
  stuck_after_days  smallint CHECK (stuck_after_days IS NULL OR stuck_after_days BETWEEN 1 AND 365),
  updated_by        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS song_library_stage_settings_updated_by_idx ON public.song_library_stage_settings (updated_by);
COMMENT ON TABLE public.song_library_stage_settings IS
  'Stuck threshold per stage, a manager setting. Null = never stuck (celebrate). Seeded 14 days, set_down 7.';

INSERT INTO public.song_library_stage_settings (stage, stuck_after_days) VALUES
  ('idea_entry', 14), ('writing', 14), ('set_down', 7), ('refine', 14),
  ('written_needs_demo', 14), ('demo_ready', 14), ('share', 14), ('celebrate', NULL)
ON CONFLICT (stage) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. Helpers that read song_library tables
-- ────────────────────────────────────────────────────────────

-- Songs the caller writes on (lead or co-writer). Empty for an inactive
-- account. Policies use song_id IN (SELECT public.song_library_my_song_ids()).
CREATE OR REPLACE FUNCTION public.song_library_my_song_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT w.song_id
    FROM public.song_library_writers w
   WHERE w.user_id = auth.uid()
     AND public.dept_caller_is_active();
$$;

-- Songs where the caller is the lead writer (may delete the song).
CREATE OR REPLACE FUNCTION public.song_library_my_lead_song_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT w.song_id
    FROM public.song_library_writers w
   WHERE w.user_id = auth.uid()
     AND w.is_lead
     AND public.dept_caller_is_active();
$$;

-- Subscriptions are private rows; the writer page only needs the count.
CREATE OR REPLACE FUNCTION public.song_library_writer_subscriber_count(p_writer_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN public.song_library_can_read() THEN (
    SELECT count(*)::integer
      FROM public.song_library_subscriptions s
     WHERE s.target_type = 'writer'
       AND s.target_user_id = p_writer_id
  ) END;
$$;

-- Storage object names are {song_id}/... . Null when the first segment
-- is not a uuid.
CREATE OR REPLACE FUNCTION public.song_library_storage_song_id(p_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]'
         AND position('..' IN p_name) = 0
    THEN split_part(p_name, '/', 1)::uuid
  END;
$$;

CREATE OR REPLACE FUNCTION public.song_library_storage_can_read(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.song_library_can_read()
     AND EXISTS (
       SELECT 1 FROM public.song_library_songs s
        WHERE s.id = public.song_library_storage_song_id(p_name)
     );
$$;

CREATE OR REPLACE FUNCTION public.song_library_storage_can_write(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.song_library_songs s
            WHERE s.id = public.song_library_storage_song_id(p_name)
         )
     AND (
       public.song_library_is_admin()
       OR public.song_library_storage_song_id(p_name) IN (SELECT public.song_library_my_song_ids())
     );
$$;

REVOKE ALL ON FUNCTION public.song_library_is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.song_library_can_read() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.song_library_can_manage() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.song_library_my_song_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.song_library_my_lead_song_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.song_library_writer_subscriber_count(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.song_library_storage_song_id(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.song_library_storage_can_read(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.song_library_storage_can_write(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.song_library_is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.song_library_can_read() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.song_library_can_manage() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.song_library_my_song_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.song_library_my_lead_song_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.song_library_writer_subscriber_count(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.song_library_storage_song_id(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.song_library_storage_can_read(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.song_library_storage_can_write(text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 4. Triggers
-- ────────────────────────────────────────────────────────────
-- Trigger functions are SECURITY DEFINER (they write the event log and
-- bump songs past RLS) and are not callable directly by anyone.
-- pg_trigger_depth() > 1 means "fired by another trigger or by an FK
-- cascade", which only this migration's own functions and FK actions do.

-- 4a. Stamp the acting user into a column (TG_ARGV[0]) and optionally
-- now() into a timestamp column (TG_ARGV[1]). Service role (no auth.uid())
-- keeps what it wrote.
CREATE OR REPLACE FUNCTION public.song_library_stamp_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_patch jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NOT NULL THEN
    v_patch := jsonb_build_object(TG_ARGV[0], v_uid);
  END IF;
  IF TG_NARGS > 1 THEN
    v_patch := v_patch || jsonb_build_object(TG_ARGV[1], now());
  END IF;
  IF v_patch <> '{}'::jsonb THEN
    NEW := jsonb_populate_record(NEW, v_patch);
  END IF;
  RETURN NEW;
END;
$$;

-- 4b. song_id (or request_id/user_id) never moves to another parent.
CREATE OR REPLACE FUNCTION public.song_library_parent_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
      RAISE EXCEPTION '%.% cannot be changed; delete and re-create instead', TG_TABLE_NAME, col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

-- 4c. Songs: insert defaults, then column locks on update.
CREATE OR REPLACE FUNCTION public.song_library_songs_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.visibility := 'base';
  NEW.current_version_id := NULL;
  NEW.last_activity_at := now();
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
    IF NOT (public.song_library_is_admin() OR public.song_library_can_manage()) THEN
      NEW.stage := 'idea_entry';
      NEW.placement := 'inbox';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Who may change which columns. Admins and the service role: anything.
-- placement: managers only. stage: managers any move; writers only from
-- an early stage to another early stage (idea_entry, writing, set_down,
-- refine, written_needs_demo). Every other column a user may set (title,
-- entry_point, pathway, holy_spirit_interrupt, music_key, bpm, lyrics_md,
-- chart_path, current_version_id, source_training_id): writers only. id,
-- created_by, created_at, visibility and last_activity_at: nobody but
-- admins and triggers.
CREATE OR REPLACE FUNCTION public.song_library_songs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_early text[] := ARRAY['idea_entry', 'writing', 'set_down', 'refine', 'written_needs_demo'];
  v_stage_moved boolean := NEW.stage IS DISTINCT FROM OLD.stage;
  v_place_moved boolean := NEW.placement IS DISTINCT FROM OLD.placement;
  v_skip text[] := ARRAY['stage', 'placement', 'updated_at', 'last_activity_at'];
  v_system text[] := ARRAY['id', 'created_by', 'created_at', 'visibility', 'last_activity_at'];
  v_manager boolean;
  v_writer boolean;
  col text;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.song_library_is_admin() THEN
    FOREACH col IN ARRAY v_system LOOP
      IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
        RAISE EXCEPTION 'song_library_songs.% is set by the Hub', col USING ERRCODE = '42501';
      END IF;
    END LOOP;
    v_manager := public.song_library_can_manage();
    v_writer := EXISTS (
      SELECT 1 FROM public.song_library_writers w
       WHERE w.song_id = OLD.id AND w.user_id = auth.uid()
    );
    IF v_place_moved AND NOT v_manager THEN
      RAISE EXCEPTION 'Only Song Library managers can change placement' USING ERRCODE = '42501';
    END IF;
    IF v_stage_moved AND NOT v_manager THEN
      IF NOT v_writer THEN
        RAISE EXCEPTION 'Only the song''s writers or Song Library managers can move its stage' USING ERRCODE = '42501';
      END IF;
      IF NOT (OLD.stage = ANY (v_early) AND NEW.stage = ANY (v_early)) THEN
        RAISE EXCEPTION 'Only Song Library managers can move a song into or out of demo_ready, share or celebrate'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    IF (to_jsonb(NEW) - v_skip) IS DISTINCT FROM (to_jsonb(OLD) - v_skip) AND NOT v_writer THEN
      RAISE EXCEPTION 'Only the song''s writers can edit it' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_stage_moved OR v_place_moved THEN
    NEW.last_activity_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- Uploader becomes the lead writer; creation is the first event.
CREATE OR REPLACE FUNCTION public.song_library_songs_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.song_library_writers (song_id, user_id, is_lead, added_by)
    VALUES (NEW.id, NEW.created_by, true, NEW.created_by)
    ON CONFLICT (song_id, user_id) DO NOTHING;
  END IF;
  INSERT INTO public.song_library_stage_events (song_id, kind, to_stage, payload, by_user)
  VALUES (NEW.id, 'stage', NEW.stage,
          jsonb_build_object('created', true, 'entry_point', NEW.entry_point,
                             'holy_spirit_interrupt', NEW.holy_spirit_interrupt),
          COALESCE(auth.uid(), NEW.created_by));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.song_library_songs_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.song_library_stage_events (song_id, kind, from_stage, to_stage, by_user)
    VALUES (NEW.id, 'stage', OLD.stage, NEW.stage, auth.uid());
  END IF;
  IF NEW.placement IS DISTINCT FROM OLD.placement THEN
    INSERT INTO public.song_library_stage_events (song_id, kind, payload, by_user)
    VALUES (NEW.id, 'placement', jsonb_build_object('from', OLD.placement, 'to', NEW.placement), auth.uid());
  END IF;
  RETURN NULL;
END;
$$;

-- 4d. Versions: number them, lock identity columns, log and bump.
CREATE OR REPLACE FUNCTION public.song_library_versions_before()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Serialise numbering per song.
    PERFORM 1 FROM public.song_library_songs s WHERE s.id = NEW.song_id FOR UPDATE;
    SELECT COALESCE(max(v.n), 0) + 1 INTO NEW.n
      FROM public.song_library_versions v WHERE v.song_id = NEW.song_id;
    NEW.uploaded_at := now();
    IF auth.uid() IS NOT NULL THEN
      NEW.uploaded_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.song_id IS DISTINCT FROM OLD.song_id
     OR NEW.n IS DISTINCT FROM OLD.n
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
     OR (NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by AND NEW.uploaded_by IS NOT NULL) THEN
    RAISE EXCEPTION 'A version''s song, number, file and uploader cannot change; upload a new version'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.song_library_versions_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.song_library_stage_events (song_id, kind, payload, by_user)
  VALUES (NEW.song_id, 'version',
          jsonb_build_object('version_id', NEW.id, 'n', NEW.n, 'label', NEW.label, 'is_demo', NEW.is_demo),
          COALESCE(auth.uid(), NEW.uploaded_by));
  UPDATE public.song_library_songs s
     SET last_activity_at = now(),
         current_version_id = COALESCE(s.current_version_id, NEW.id)
   WHERE s.id = NEW.song_id;
  RETURN NULL;
END;
$$;

-- 4e. Progress bump for pathway, refine and checkpoint changes.
CREATE OR REPLACE FUNCTION public.song_library_touch_song()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.song_library_songs s
     SET last_activity_at = now()
   WHERE s.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.song_id ELSE NEW.song_id END;
  RETURN NULL;
END;
$$;

-- 4f. Checkpoints: log ticks and unticks. Unticking or deleting a ticked
-- credits_splits_agreed is a revocation: it clears every writer
-- confirmation on the song, and the event records who did it, when, and
-- how many confirmations were cleared.
CREATE OR REPLACE FUNCTION public.song_library_checkpoints_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.song_library_checkpoints;
  v_revoked boolean := false;
  v_cleared integer := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
  ELSE
    r := NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.done_at IS NULL) = (OLD.done_at IS NULL)
     AND NEW.note IS NOT DISTINCT FROM OLD.note THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.song_library_songs s WHERE s.id = r.song_id) THEN
    RETURN NULL;  -- the song itself is being deleted
  END IF;

  IF r.kind = 'credits_splits_agreed'
     AND TG_OP <> 'INSERT'
     AND OLD.done_at IS NOT NULL
     AND (TG_OP = 'DELETE' OR NEW.done_at IS NULL) THEN
    v_revoked := true;
    UPDATE public.song_library_writers w
       SET confirmed_at = NULL, confirmed_by = NULL
     WHERE w.song_id = r.song_id
       AND w.confirmed_at IS NOT NULL;
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  END IF;

  INSERT INTO public.song_library_stage_events (song_id, kind, payload, by_user)
  VALUES (r.song_id, 'checkpoint',
          jsonb_build_object('checkpoint', r.kind,
                             'done', TG_OP <> 'DELETE' AND r.done_at IS NOT NULL,
                             'note', r.note)
          || CASE WHEN v_revoked
                  THEN jsonb_build_object('revoked', true, 'deleted', TG_OP = 'DELETE',
                                          'cleared_confirmations', v_cleared)
                  ELSE '{}'::jsonb END,
          auth.uid());
  RETURN NULL;
END;
$$;

-- 4g. Writers: stamp added_by, keep song/person fixed, lock credits while
-- agreed, per-writer confirmation rules, and what a manager who is not a
-- writer may touch.
--
-- Credit fields: user_id, display_name, role, is_lead, split_pct, plus
-- adding or removing a row. While credits_splits_agreed is ticked, none of
-- them can change (23514): revoke first, by un-confirming a row (the
-- writer themself, a manager or an admin) or by a manager/admin unticking
-- or deleting the checkpoint. Revoking clears every confirmation and is
-- logged. While not agreed, a credit change clears every confirmation.
CREATE OR REPLACE FUNCTION public.song_library_writers_before()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_song uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.song_id ELSE NEW.song_id END;
  v_credit text[] := ARRAY['user_id', 'display_name', 'role', 'is_lead', 'split_pct'];
  v_conf text[] := ARRAY['confirmed_at', 'confirmed_by', 'updated_at'];
  v_credit_change boolean := false;
  col text;
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.song_id IS DISTINCT FROM OLD.song_id
       OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'A writer row''s song and person cannot change; remove and add instead'
      USING ERRCODE = '42501';
  END IF;

  -- Triggers (clearing confirmations, the uploader's own row) and FK
  -- cascades (song or user deleted) pass straight through.
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'INSERT' THEN
      NEW.confirmed_at := NULL;
      NEW.confirmed_by := NULL;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOREACH col IN ARRAY v_credit LOOP
      IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
        v_credit_change := true;
      END IF;
    END LOOP;
  ELSE
    v_credit_change := true;
  END IF;

  IF v_credit_change AND EXISTS (
       SELECT 1 FROM public.song_library_checkpoints c
        WHERE c.song_id = v_song
          AND c.kind = 'credits_splits_agreed'
          AND c.done_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Credits are agreed for this song; revoke the agreement (un-confirm) before changing writers or splits'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN
      NEW.added_by := v_uid;
    END IF;
    -- A new row starts unconfirmed; adding it clears the others too.
    NEW.confirmed_at := NULL;
    NEW.confirmed_by := NULL;
    RETURN NEW;
  END IF;

  IF v_uid IS NOT NULL
     AND NOT public.song_library_is_admin()
     AND NOT EXISTS (
       SELECT 1 FROM public.song_library_writers w
        WHERE w.song_id = OLD.song_id AND w.user_id = v_uid
     )
     AND (to_jsonb(NEW) - v_conf) IS DISTINCT FROM (to_jsonb(OLD) - v_conf) THEN
    RAISE EXCEPTION 'Managers who are not writers can only confirm splits for writers without a Hub account'
      USING ERRCODE = '42501';
  END IF;

  IF v_credit_change THEN
    NEW.confirmed_at := NULL;
    NEW.confirmed_by := NULL;
    RETURN NEW;
  END IF;

  IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    IF NEW.confirmed_at IS NOT NULL THEN
      IF NEW.split_pct IS NULL THEN
        RAISE EXCEPTION 'Give this writer a split before confirming it' USING ERRCODE = '23514';
      END IF;
      IF v_uid IS NOT NULL THEN
        IF OLD.user_id IS NOT NULL AND OLD.user_id <> v_uid THEN
          RAISE EXCEPTION 'Only that writer can confirm their own split' USING ERRCODE = '42501';
        END IF;
        IF OLD.user_id IS NULL
           AND NOT (public.song_library_is_admin() OR public.song_library_can_manage()) THEN
          RAISE EXCEPTION 'A writer without a Hub account is confirmed by a Song Library manager or an admin'
            USING ERRCODE = '42501';
        END IF;
      END IF;
      NEW.confirmed_at := now();
      NEW.confirmed_by := COALESCE(v_uid, NEW.confirmed_by);
    ELSE
      -- Un-confirming: the writer themself, a manager or an admin.
      IF v_uid IS NOT NULL
         AND OLD.user_id IS DISTINCT FROM v_uid
         AND NOT (public.song_library_is_admin() OR public.song_library_can_manage()) THEN
        RAISE EXCEPTION 'Only that writer, a Song Library manager or an admin can withdraw this confirmation'
          USING ERRCODE = '42501';
      END IF;
      NEW.confirmed_by := NULL;
    END IF;
  ELSIF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
        AND NEW.confirmed_by IS NOT NULL THEN
    RAISE EXCEPTION 'confirmed_by is set by the Hub' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Agreed = at least one writer, every writer has a split, total 100.00,
-- every row confirmed.
CREATE OR REPLACE FUNCTION public.song_library_splits_agreed(p_song_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*) > 0
     AND count(*) FILTER (WHERE w.split_pct IS NULL) = 0
     AND COALESCE(sum(w.split_pct), 0) = 100
     AND count(*) FILTER (WHERE w.confirmed_at IS NULL) = 0
    FROM public.song_library_writers w
   WHERE w.song_id = p_song_id;
$$;

-- Tick or untick the derived credits_splits_agreed checkpoint.
CREATE OR REPLACE FUNCTION public.song_library_sync_splits_agreed(p_song_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.song_library_songs s WHERE s.id = p_song_id) THEN
    RETURN;
  END IF;
  IF public.song_library_splits_agreed(p_song_id) THEN
    INSERT INTO public.song_library_checkpoints (song_id, kind, done_at)
    VALUES (p_song_id, 'credits_splits_agreed', now())
    ON CONFLICT (song_id, kind) DO UPDATE
      SET done_at = now()
      WHERE public.song_library_checkpoints.done_at IS NULL;
  ELSE
    UPDATE public.song_library_checkpoints c
       SET done_at = NULL
     WHERE c.song_id = p_song_id
       AND c.kind = 'credits_splits_agreed'
       AND c.done_at IS NOT NULL;
  END IF;
END;
$$;

-- After any writer change: a credit change (add, remove, or any credit
-- field) by a user clears every confirmation on the song; log joins,
-- removals, confirmations, withdrawals and clears; then re-derive the
-- checkpoint. If that unticks a ticked checkpoint, song_library_checkpoints_log
-- records the revocation.
CREATE OR REPLACE FUNCTION public.song_library_writers_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.song_library_writers;
  v_credit text[] := ARRAY['user_id', 'display_name', 'role', 'is_lead', 'split_pct'];
  v_credit_change boolean := TG_OP <> 'UPDATE';
  v_cleared integer := 0;
  col text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
  ELSE
    r := NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.song_library_songs s WHERE s.id = r.song_id) THEN
    RETURN NULL;  -- the song itself is being deleted
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOREACH col IN ARRAY v_credit LOOP
      IF (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
        v_credit_change := true;
      END IF;
    END LOOP;
  END IF;

  IF v_credit_change AND pg_trigger_depth() = 1 THEN
    UPDATE public.song_library_writers w
       SET confirmed_at = NULL, confirmed_by = NULL
     WHERE w.song_id = r.song_id
       AND w.confirmed_at IS NOT NULL;
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
    -- writers_before already cleared this row's own confirmation.
    IF TG_OP = 'UPDATE' AND OLD.confirmed_at IS NOT NULL THEN
      v_cleared := v_cleared + 1;
    END IF;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    INSERT INTO public.song_library_stage_events (song_id, kind, payload, by_user)
    VALUES (r.song_id, 'writer',
            jsonb_build_object('action', CASE WHEN TG_OP = 'DELETE' THEN 'removed' ELSE 'added' END,
                               'writer_id', r.id, 'user_id', r.user_id,
                               'display_name', r.display_name, 'is_lead', r.is_lead),
            auth.uid());
  ELSIF pg_trigger_depth() = 1 AND OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL THEN
    INSERT INTO public.song_library_stage_events (song_id, kind, payload, by_user)
    VALUES (r.song_id, 'writer',
            jsonb_build_object('action', 'confirmed', 'writer_id', r.id, 'user_id', r.user_id,
                               'display_name', r.display_name, 'split_pct', r.split_pct),
            auth.uid());
  ELSIF pg_trigger_depth() = 1 AND OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS NULL
        AND NOT v_credit_change THEN
    INSERT INTO public.song_library_stage_events (song_id, kind, payload, by_user)
    VALUES (r.song_id, 'writer',
            jsonb_build_object('action', 'unconfirmed', 'writer_id', r.id, 'user_id', r.user_id,
                               'display_name', r.display_name),
            auth.uid());
  END IF;
  IF v_cleared > 0 THEN
    INSERT INTO public.song_library_stage_events (song_id, kind, payload, by_user)
    VALUES (r.song_id, 'writer',
            jsonb_build_object('action', 'confirmations_cleared', 'writer_id', r.id,
                               'cleared_confirmations', v_cleared),
            auth.uid());
  END IF;

  PERFORM public.song_library_sync_splits_agreed(r.song_id);
  RETURN NULL;
END;
$$;

-- credits_splits_agreed is derived: users (admins included) cannot tick
-- it or edit it. Managers and admins (RLS) may untick or delete it, which
-- revokes the agreement (see song_library_checkpoints_log). Triggers and
-- the service role can write it, and the deferred check below still holds
-- them to the rule.
CREATE OR REPLACE FUNCTION public.song_library_checkpoints_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND NEW.kind = 'credits_splits_agreed' THEN
      RAISE EXCEPTION 'credits_splits_agreed follows the writers'' confirmations; confirm splits instead'
        USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.kind = 'credits_splits_agreed'
       AND (NEW.done_at IS NOT NULL
            OR NEW.note IS DISTINCT FROM OLD.note) THEN
      RAISE EXCEPTION 'credits_splits_agreed can only be revoked (unticked) by hand'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- 4h. Splits rule, checked at commit: credits_splits_agreed is ticked if
-- and only if the splits are agreed.
CREATE OR REPLACE FUNCTION public.song_library_check_splits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_song uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.song_id ELSE NEW.song_id END;
  v_ticked boolean;
  v_agreed boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.song_library_songs s WHERE s.id = v_song) THEN
    RETURN NULL;
  END IF;
  v_ticked := EXISTS (
    SELECT 1 FROM public.song_library_checkpoints c
     WHERE c.song_id = v_song
       AND c.kind = 'credits_splits_agreed'
       AND c.done_at IS NOT NULL
  );
  v_agreed := public.song_library_splits_agreed(v_song);
  IF v_ticked AND NOT v_agreed THEN
    RAISE EXCEPTION 'Splits must total 100%% and every writer must confirm before credits are agreed (song %)', v_song
      USING ERRCODE = '23514';
  ELSIF v_agreed AND NOT v_ticked THEN
    RAISE EXCEPTION 'Splits for song % are agreed but credits_splits_agreed is not ticked', v_song
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- 4i. Help requests: requester stamp and closed_at.
CREATE OR REPLACE FUNCTION public.song_library_help_requests_before()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.asked_by := auth.uid();
    END IF;
  ELSIF NEW.asked_by IS DISTINCT FROM OLD.asked_by AND NEW.asked_by IS NOT NULL THEN
    RAISE EXCEPTION 'asked_by cannot change' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'open' THEN
    NEW.closed_at := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.status = 'open' OR NEW.closed_at IS NULL THEN
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  END IF;
  RETURN NEW;
END;
$$;

-- 4j. Sign-ups only on open requests.
CREATE OR REPLACE FUNCTION public.song_library_help_signups_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.song_library_help_requests r
     WHERE r.id = NEW.request_id AND r.status = 'open'
  ) THEN
    RAISE EXCEPTION 'This help request is no longer open' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DO $revoke$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'song_library_stamp_actor()', 'song_library_parent_immutable()',
    'song_library_songs_before_insert()', 'song_library_songs_guard()',
    'song_library_songs_after_insert()', 'song_library_songs_after_update()',
    'song_library_versions_before()', 'song_library_versions_after_insert()',
    'song_library_touch_song()', 'song_library_checkpoints_log()',
    'song_library_writers_before()', 'song_library_writers_after()',
    'song_library_checkpoints_guard()', 'song_library_sync_splits_agreed(uuid)',
    'song_library_check_splits()', 'song_library_help_requests_before()',
    'song_library_help_signups_before_insert()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END
$revoke$;

-- updated_at
DROP TRIGGER IF EXISTS handle_updated_at ON public.song_library_songs;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.song_library_songs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at ON public.song_library_versions;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.song_library_versions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at ON public.song_library_celebrate_notes;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.song_library_celebrate_notes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at ON public.song_library_writers;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.song_library_writers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at ON public.song_library_publishing;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.song_library_publishing
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at ON public.song_library_checkpoints;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.song_library_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at ON public.song_library_help_requests;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.song_library_help_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at ON public.song_library_help_signups;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.song_library_help_signups
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS handle_updated_at ON public.song_library_stage_settings;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.song_library_stage_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- songs
DROP TRIGGER IF EXISTS song_library_songs_before_insert ON public.song_library_songs;
CREATE TRIGGER song_library_songs_before_insert BEFORE INSERT ON public.song_library_songs
  FOR EACH ROW EXECUTE FUNCTION public.song_library_songs_before_insert();
DROP TRIGGER IF EXISTS song_library_songs_guard ON public.song_library_songs;
CREATE TRIGGER song_library_songs_guard BEFORE UPDATE ON public.song_library_songs
  FOR EACH ROW EXECUTE FUNCTION public.song_library_songs_guard();
DROP TRIGGER IF EXISTS song_library_songs_after_insert ON public.song_library_songs;
CREATE TRIGGER song_library_songs_after_insert AFTER INSERT ON public.song_library_songs
  FOR EACH ROW EXECUTE FUNCTION public.song_library_songs_after_insert();
DROP TRIGGER IF EXISTS song_library_songs_after_update ON public.song_library_songs;
CREATE TRIGGER song_library_songs_after_update AFTER UPDATE OF stage, placement ON public.song_library_songs
  FOR EACH ROW EXECUTE FUNCTION public.song_library_songs_after_update();

-- versions
DROP TRIGGER IF EXISTS song_library_versions_before ON public.song_library_versions;
CREATE TRIGGER song_library_versions_before BEFORE INSERT OR UPDATE ON public.song_library_versions
  FOR EACH ROW EXECUTE FUNCTION public.song_library_versions_before();
DROP TRIGGER IF EXISTS song_library_versions_after_insert ON public.song_library_versions;
CREATE TRIGGER song_library_versions_after_insert AFTER INSERT ON public.song_library_versions
  FOR EACH ROW EXECUTE FUNCTION public.song_library_versions_after_insert();

-- song_id never moves
DROP TRIGGER IF EXISTS song_library_parent_immutable ON public.song_library_pathway_steps;
CREATE TRIGGER song_library_parent_immutable BEFORE UPDATE ON public.song_library_pathway_steps
  FOR EACH ROW EXECUTE FUNCTION public.song_library_parent_immutable('song_id');
DROP TRIGGER IF EXISTS song_library_parent_immutable ON public.song_library_stage_events;
CREATE TRIGGER song_library_parent_immutable BEFORE UPDATE ON public.song_library_stage_events
  FOR EACH ROW EXECUTE FUNCTION public.song_library_parent_immutable('song_id', 'kind', 'from_stage', 'to_stage', 'payload', 'at');
DROP TRIGGER IF EXISTS song_library_parent_immutable ON public.song_library_refine_items;
CREATE TRIGGER song_library_parent_immutable BEFORE UPDATE ON public.song_library_refine_items
  FOR EACH ROW EXECUTE FUNCTION public.song_library_parent_immutable('song_id');
DROP TRIGGER IF EXISTS song_library_parent_immutable ON public.song_library_share_steps;
CREATE TRIGGER song_library_parent_immutable BEFORE UPDATE ON public.song_library_share_steps
  FOR EACH ROW EXECUTE FUNCTION public.song_library_parent_immutable('song_id');
DROP TRIGGER IF EXISTS song_library_parent_immutable ON public.song_library_celebrate_notes;
CREATE TRIGGER song_library_parent_immutable BEFORE UPDATE ON public.song_library_celebrate_notes
  FOR EACH ROW EXECUTE FUNCTION public.song_library_parent_immutable('song_id');
DROP TRIGGER IF EXISTS song_library_parent_immutable ON public.song_library_publishing;
CREATE TRIGGER song_library_parent_immutable BEFORE UPDATE ON public.song_library_publishing
  FOR EACH ROW EXECUTE FUNCTION public.song_library_parent_immutable('song_id');
DROP TRIGGER IF EXISTS song_library_parent_immutable ON public.song_library_checkpoints;
CREATE TRIGGER song_library_parent_immutable BEFORE UPDATE ON public.song_library_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.song_library_parent_immutable('song_id', 'kind');
DROP TRIGGER IF EXISTS song_library_parent_immutable ON public.song_library_help_requests;
CREATE TRIGGER song_library_parent_immutable BEFORE UPDATE ON public.song_library_help_requests
  FOR EACH ROW EXECUTE FUNCTION public.song_library_parent_immutable('song_id');
DROP TRIGGER IF EXISTS song_library_parent_immutable ON public.song_library_help_signups;
CREATE TRIGGER song_library_parent_immutable BEFORE UPDATE ON public.song_library_help_signups
  FOR EACH ROW EXECUTE FUNCTION public.song_library_parent_immutable('request_id', 'user_id');
DROP TRIGGER IF EXISTS song_library_parent_immutable ON public.song_library_subscriptions;
CREATE TRIGGER song_library_parent_immutable BEFORE UPDATE ON public.song_library_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.song_library_parent_immutable('user_id');
DROP TRIGGER IF EXISTS song_library_parent_immutable ON public.song_library_helpers;
CREATE TRIGGER song_library_parent_immutable BEFORE UPDATE ON public.song_library_helpers
  FOR EACH ROW EXECUTE FUNCTION public.song_library_parent_immutable('user_id');

-- actor stamps
DROP TRIGGER IF EXISTS song_library_stamp_actor ON public.song_library_pathway_steps;
CREATE TRIGGER song_library_stamp_actor BEFORE INSERT OR UPDATE ON public.song_library_pathway_steps
  FOR EACH ROW EXECUTE FUNCTION public.song_library_stamp_actor('by_user');
DROP TRIGGER IF EXISTS song_library_stamp_actor ON public.song_library_refine_items;
CREATE TRIGGER song_library_stamp_actor BEFORE INSERT OR UPDATE ON public.song_library_refine_items
  FOR EACH ROW EXECUTE FUNCTION public.song_library_stamp_actor('by_user', 'at');
DROP TRIGGER IF EXISTS song_library_stamp_actor ON public.song_library_share_steps;
CREATE TRIGGER song_library_stamp_actor BEFORE INSERT OR UPDATE ON public.song_library_share_steps
  FOR EACH ROW EXECUTE FUNCTION public.song_library_stamp_actor('by_user');
DROP TRIGGER IF EXISTS song_library_stamp_actor ON public.song_library_celebrate_notes;
CREATE TRIGGER song_library_stamp_actor BEFORE INSERT OR UPDATE ON public.song_library_celebrate_notes
  FOR EACH ROW EXECUTE FUNCTION public.song_library_stamp_actor('by_user');
DROP TRIGGER IF EXISTS song_library_stamp_actor ON public.song_library_publishing;
CREATE TRIGGER song_library_stamp_actor BEFORE INSERT OR UPDATE ON public.song_library_publishing
  FOR EACH ROW EXECUTE FUNCTION public.song_library_stamp_actor('updated_by');
DROP TRIGGER IF EXISTS song_library_stamp_actor ON public.song_library_checkpoints;
CREATE TRIGGER song_library_stamp_actor BEFORE INSERT OR UPDATE ON public.song_library_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.song_library_stamp_actor('by_user');
DROP TRIGGER IF EXISTS song_library_stamp_actor ON public.song_library_stage_settings;
CREATE TRIGGER song_library_stamp_actor BEFORE UPDATE ON public.song_library_stage_settings
  FOR EACH ROW EXECUTE FUNCTION public.song_library_stamp_actor('updated_by');

-- progress bumps
DROP TRIGGER IF EXISTS song_library_touch_song ON public.song_library_pathway_steps;
CREATE TRIGGER song_library_touch_song AFTER INSERT OR UPDATE OR DELETE ON public.song_library_pathway_steps
  FOR EACH ROW EXECUTE FUNCTION public.song_library_touch_song();
DROP TRIGGER IF EXISTS song_library_touch_song ON public.song_library_refine_items;
CREATE TRIGGER song_library_touch_song AFTER INSERT OR UPDATE OR DELETE ON public.song_library_refine_items
  FOR EACH ROW EXECUTE FUNCTION public.song_library_touch_song();
DROP TRIGGER IF EXISTS song_library_touch_song ON public.song_library_checkpoints;
CREATE TRIGGER song_library_touch_song AFTER INSERT OR UPDATE OR DELETE ON public.song_library_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.song_library_touch_song();

-- checkpoints and writers log
DROP TRIGGER IF EXISTS song_library_checkpoints_log ON public.song_library_checkpoints;
CREATE TRIGGER song_library_checkpoints_log AFTER INSERT OR UPDATE OR DELETE ON public.song_library_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.song_library_checkpoints_log();
DROP TRIGGER IF EXISTS song_library_writers_before ON public.song_library_writers;
CREATE TRIGGER song_library_writers_before BEFORE INSERT OR UPDATE OR DELETE ON public.song_library_writers
  FOR EACH ROW EXECUTE FUNCTION public.song_library_writers_before();
DROP TRIGGER IF EXISTS song_library_writers_log ON public.song_library_writers;
DROP TRIGGER IF EXISTS song_library_writers_after ON public.song_library_writers;
CREATE TRIGGER song_library_writers_after AFTER INSERT OR UPDATE OR DELETE ON public.song_library_writers
  FOR EACH ROW EXECUTE FUNCTION public.song_library_writers_after();
DROP TRIGGER IF EXISTS song_library_checkpoints_guard ON public.song_library_checkpoints;
CREATE TRIGGER song_library_checkpoints_guard BEFORE INSERT OR UPDATE OR DELETE ON public.song_library_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.song_library_checkpoints_guard();
DROP FUNCTION IF EXISTS public.song_library_writers_log();

REVOKE ALL ON FUNCTION public.song_library_splits_agreed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.song_library_splits_agreed(uuid) TO authenticated, service_role;

-- splits rule (deferred to commit)
DROP TRIGGER IF EXISTS song_library_writers_splits_agreed ON public.song_library_writers;
CREATE CONSTRAINT TRIGGER song_library_writers_splits_agreed
  AFTER INSERT OR UPDATE OR DELETE ON public.song_library_writers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.song_library_check_splits();
DROP TRIGGER IF EXISTS song_library_checkpoints_splits_agreed ON public.song_library_checkpoints;
CREATE CONSTRAINT TRIGGER song_library_checkpoints_splits_agreed
  AFTER INSERT OR UPDATE OR DELETE ON public.song_library_checkpoints
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.song_library_check_splits();

-- help
DROP TRIGGER IF EXISTS song_library_help_requests_before ON public.song_library_help_requests;
CREATE TRIGGER song_library_help_requests_before BEFORE INSERT OR UPDATE ON public.song_library_help_requests
  FOR EACH ROW EXECUTE FUNCTION public.song_library_help_requests_before();
DROP TRIGGER IF EXISTS song_library_help_signups_before_insert ON public.song_library_help_signups;
CREATE TRIGGER song_library_help_signups_before_insert BEFORE INSERT ON public.song_library_help_signups
  FOR EACH ROW EXECUTE FUNCTION public.song_library_help_signups_before_insert();

-- ────────────────────────────────────────────────────────────
-- 5. Stuck view
-- ────────────────────────────────────────────────────────────
-- security_invoker: callers see only songs their RLS lets them see.
-- stuck_days = whole days since last_activity_at. Never stuck when the
-- stage threshold is null (celebrate).

CREATE OR REPLACE VIEW public.song_library_song_status
WITH (security_invoker = true) AS
SELECT
  s.id AS song_id,
  s.stage,
  s.placement,
  s.last_activity_at,
  floor(extract(epoch FROM (now() - s.last_activity_at)) / 86400)::integer AS stuck_days,
  st.stuck_after_days,
  (st.stuck_after_days IS NOT NULL
   AND floor(extract(epoch FROM (now() - s.last_activity_at)) / 86400) >= st.stuck_after_days) AS is_stuck,
  s.stage IN ('demo_ready', 'share', 'celebrate') AS is_finished,
  s.stage = 'written_needs_demo' AS needs_demo,
  COALESCE(sp.agreed, false) AS splits_agreed,
  COALESCE(sp.total_pct, 0)::numeric(6, 2) AS splits_total_pct,
  COALESCE(sp.writers, 0)::integer AS writers_count,
  COALESCE(sp.confirmed, 0)::integer AS writers_confirmed
FROM public.song_library_songs s
LEFT JOIN public.song_library_stage_settings st ON st.stage = s.stage
LEFT JOIN LATERAL (
  SELECT count(*) AS writers,
         count(*) FILTER (WHERE w.confirmed_at IS NOT NULL) AS confirmed,
         sum(w.split_pct) AS total_pct,
         (count(*) > 0
          AND count(*) FILTER (WHERE w.split_pct IS NULL) = 0
          AND COALESCE(sum(w.split_pct), 0) = 100
          AND count(*) FILTER (WHERE w.confirmed_at IS NULL) = 0) AS agreed
    FROM public.song_library_writers w
   WHERE w.song_id = s.id
) sp ON true;

COMMENT ON VIEW public.song_library_song_status IS
  'Per song: stuck_days, is_stuck (against song_library_stage_settings), is_finished (demo_ready or later), needs_demo, and splits: splits_agreed (total 100 and every writer confirmed), splits_total_pct, writers_count, writers_confirmed. security_invoker.';

-- ────────────────────────────────────────────────────────────
-- 6. Grants and RLS
-- ────────────────────────────────────────────────────────────

DO $grants$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'song_library_songs', 'song_library_versions', 'song_library_pathway_steps',
    'song_library_stage_events', 'song_library_refine_items', 'song_library_share_steps',
    'song_library_celebrate_notes', 'song_library_writers', 'song_library_publishing',
    'song_library_checkpoints', 'song_library_helpers', 'song_library_help_requests',
    'song_library_help_signups', 'song_library_subscriptions', 'song_library_notifications',
    'song_library_stage_settings'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$grants$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.song_library_songs, public.song_library_versions, public.song_library_pathway_steps,
  public.song_library_refine_items, public.song_library_share_steps,
  public.song_library_celebrate_notes, public.song_library_writers, public.song_library_publishing,
  public.song_library_checkpoints, public.song_library_helpers, public.song_library_help_requests,
  public.song_library_help_signups, public.song_library_subscriptions
TO authenticated;
-- Event log: read, and the actor may edit the note. Rows come from triggers.
GRANT SELECT ON public.song_library_stage_events TO authenticated;
GRANT UPDATE (note) ON public.song_library_stage_events TO authenticated;
-- Outbox: read own. The service role writes.
GRANT SELECT ON public.song_library_notifications TO authenticated;
-- Thresholds: fixed eight rows.
GRANT SELECT ON public.song_library_stage_settings TO authenticated;
GRANT UPDATE (stuck_after_days) ON public.song_library_stage_settings TO authenticated;

REVOKE ALL ON public.song_library_song_status FROM PUBLIC, anon;
GRANT SELECT ON public.song_library_song_status TO authenticated, service_role;

-- Shorthands used below:
--   R = (SELECT public.song_library_can_read())
--   A = (SELECT public.song_library_is_admin())
--   M = (SELECT public.song_library_can_manage())
--   W = song_id IN (SELECT public.song_library_my_song_ids())

-- songs
DROP POLICY IF EXISTS "Song library: read songs" ON public.song_library_songs;
CREATE POLICY "Song library: read songs" ON public.song_library_songs
  FOR SELECT TO authenticated
  USING ((SELECT public.song_library_can_read()));
DROP POLICY IF EXISTS "Song library: upload songs" ON public.song_library_songs;
CREATE POLICY "Song library: upload songs" ON public.song_library_songs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.song_library_can_read()) AND created_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Song library: writers and managers update songs" ON public.song_library_songs;
CREATE POLICY "Song library: writers and managers update songs" ON public.song_library_songs
  FOR UPDATE TO authenticated
  USING ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage())
         OR id IN (SELECT public.song_library_my_song_ids()))
  WITH CHECK ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage())
              OR id IN (SELECT public.song_library_my_song_ids()));
DROP POLICY IF EXISTS "Song library: lead writer deletes song" ON public.song_library_songs;
CREATE POLICY "Song library: lead writer deletes song" ON public.song_library_songs
  FOR DELETE TO authenticated
  USING ((SELECT public.song_library_is_admin()) OR id IN (SELECT public.song_library_my_lead_song_ids()));

-- Writer-edited children: read by all readers, written by writers and admins.
DO $writer_tables$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'song_library_versions', 'song_library_pathway_steps', 'song_library_refine_items',
    'song_library_share_steps', 'song_library_writers', 'song_library_celebrate_notes'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Song library: read" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "Song library: read" ON public.%I
      FOR SELECT TO authenticated
      USING ((SELECT public.song_library_can_read()))$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS "Song library: writers insert" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "Song library: writers insert" ON public.%I
      FOR INSERT TO authenticated
      WITH CHECK ((SELECT public.song_library_is_admin())
                  OR song_id IN (SELECT public.song_library_my_song_ids()))$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS "Song library: writers update" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "Song library: writers update" ON public.%I
      FOR UPDATE TO authenticated
      USING ((SELECT public.song_library_is_admin())
             OR song_id IN (SELECT public.song_library_my_song_ids()))
      WITH CHECK ((SELECT public.song_library_is_admin())
                  OR song_id IN (SELECT public.song_library_my_song_ids()))$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS "Song library: writers delete" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "Song library: writers delete" ON public.%I
      FOR DELETE TO authenticated
      USING ((SELECT public.song_library_is_admin())
             OR song_id IN (SELECT public.song_library_my_song_ids()))$p$, t);
  END LOOP;
END
$writer_tables$;

-- Earlier draft of 419 made celebrate notes writers-only; they are now
-- read like the rest of the song (policies from the loop above).
DROP POLICY IF EXISTS "Song library: writers only" ON public.song_library_celebrate_notes;

-- writers: managers may also update (to confirm splits for writers with
-- no Hub account). song_library_writers_before limits a manager who is
-- not a writer to the confirmation columns.
DROP POLICY IF EXISTS "Song library: writers update" ON public.song_library_writers;
CREATE POLICY "Song library: writers update" ON public.song_library_writers
  FOR UPDATE TO authenticated
  USING ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage())
         OR song_id IN (SELECT public.song_library_my_song_ids()))
  WITH CHECK ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage())
              OR song_id IN (SELECT public.song_library_my_song_ids()));

-- publishing: writers, managers and admins. Everyone reads.
DROP POLICY IF EXISTS "Song library: read" ON public.song_library_publishing;
CREATE POLICY "Song library: read" ON public.song_library_publishing
  FOR SELECT TO authenticated
  USING ((SELECT public.song_library_can_read()));
DROP POLICY IF EXISTS "Song library: writers insert" ON public.song_library_publishing;
DROP POLICY IF EXISTS "Song library: writers update" ON public.song_library_publishing;
DROP POLICY IF EXISTS "Song library: writers delete" ON public.song_library_publishing;
DROP POLICY IF EXISTS "Song library: writers and managers write publishing" ON public.song_library_publishing;
CREATE POLICY "Song library: writers and managers write publishing" ON public.song_library_publishing
  FOR ALL TO authenticated
  USING ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage())
         OR song_id IN (SELECT public.song_library_my_song_ids()))
  WITH CHECK ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage())
              OR song_id IN (SELECT public.song_library_my_song_ids()));

-- stage events: everyone reads; the actor (or an admin) edits the note.
DROP POLICY IF EXISTS "Song library: read events" ON public.song_library_stage_events;
CREATE POLICY "Song library: read events" ON public.song_library_stage_events
  FOR SELECT TO authenticated
  USING ((SELECT public.song_library_can_read()));
DROP POLICY IF EXISTS "Song library: actor edits event note" ON public.song_library_stage_events;
CREATE POLICY "Song library: actor edits event note" ON public.song_library_stage_events
  FOR UPDATE TO authenticated
  USING ((SELECT public.song_library_is_admin())
         OR ((SELECT public.song_library_can_read()) AND by_user = (SELECT auth.uid())))
  WITH CHECK ((SELECT public.song_library_is_admin())
              OR ((SELECT public.song_library_can_read()) AND by_user = (SELECT auth.uid())));

-- checkpoints: managers (and admins) tick every kind except
-- credits_splits_agreed, which only triggers tick (song_library_checkpoints_guard);
-- managers may untick or delete it, which revokes the agreement.
DROP POLICY IF EXISTS "Song library: read checkpoints" ON public.song_library_checkpoints;
CREATE POLICY "Song library: read checkpoints" ON public.song_library_checkpoints
  FOR SELECT TO authenticated
  USING ((SELECT public.song_library_can_read()));
DROP POLICY IF EXISTS "Song library: write checkpoints" ON public.song_library_checkpoints;
CREATE POLICY "Song library: write checkpoints" ON public.song_library_checkpoints
  FOR ALL TO authenticated
  USING ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage()))
  WITH CHECK ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage()));
-- FOR ALL includes SELECT; the read policy above already covers readers.

-- helpers: everyone reads; each person writes their own.
DROP POLICY IF EXISTS "Song library: read helpers" ON public.song_library_helpers;
CREATE POLICY "Song library: read helpers" ON public.song_library_helpers
  FOR SELECT TO authenticated
  USING ((SELECT public.song_library_can_read()));
DROP POLICY IF EXISTS "Song library: own helper rows" ON public.song_library_helpers;
CREATE POLICY "Song library: own helper rows" ON public.song_library_helpers
  FOR ALL TO authenticated
  USING ((SELECT public.song_library_is_admin())
         OR ((SELECT public.song_library_can_read()) AND user_id = (SELECT auth.uid())))
  WITH CHECK ((SELECT public.song_library_is_admin())
              OR ((SELECT public.song_library_can_read()) AND user_id = (SELECT auth.uid())));

-- help requests: writers of the song (or managers) ask; the requester and
-- managers manage.
DROP POLICY IF EXISTS "Song library: read help requests" ON public.song_library_help_requests;
CREATE POLICY "Song library: read help requests" ON public.song_library_help_requests
  FOR SELECT TO authenticated
  USING ((SELECT public.song_library_can_read()));
DROP POLICY IF EXISTS "Song library: ask for help" ON public.song_library_help_requests;
CREATE POLICY "Song library: ask for help" ON public.song_library_help_requests
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage())
              OR (song_id IN (SELECT public.song_library_my_song_ids()) AND asked_by = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Song library: requester and managers update help requests" ON public.song_library_help_requests;
CREATE POLICY "Song library: requester and managers update help requests" ON public.song_library_help_requests
  FOR UPDATE TO authenticated
  USING ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage())
         OR ((SELECT public.song_library_can_read()) AND asked_by = (SELECT auth.uid())))
  WITH CHECK ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage())
              OR ((SELECT public.song_library_can_read()) AND asked_by = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Song library: requester and managers delete help requests" ON public.song_library_help_requests;
CREATE POLICY "Song library: requester and managers delete help requests" ON public.song_library_help_requests
  FOR DELETE TO authenticated
  USING ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage())
         OR ((SELECT public.song_library_can_read()) AND asked_by = (SELECT auth.uid())));

-- help sign-ups: the helper writes their own row; the requester and
-- managers may also remove one.
DROP POLICY IF EXISTS "Song library: read help sign-ups" ON public.song_library_help_signups;
CREATE POLICY "Song library: read help sign-ups" ON public.song_library_help_signups
  FOR SELECT TO authenticated
  USING ((SELECT public.song_library_can_read()));
DROP POLICY IF EXISTS "Song library: sign up to help" ON public.song_library_help_signups;
CREATE POLICY "Song library: sign up to help" ON public.song_library_help_signups
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.song_library_is_admin())
              OR ((SELECT public.song_library_can_read()) AND user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Song library: edit own sign-up" ON public.song_library_help_signups;
CREATE POLICY "Song library: edit own sign-up" ON public.song_library_help_signups
  FOR UPDATE TO authenticated
  USING ((SELECT public.song_library_is_admin())
         OR ((SELECT public.song_library_can_read()) AND user_id = (SELECT auth.uid())))
  WITH CHECK ((SELECT public.song_library_is_admin())
              OR ((SELECT public.song_library_can_read()) AND user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "Song library: remove sign-up" ON public.song_library_help_signups;
CREATE POLICY "Song library: remove sign-up" ON public.song_library_help_signups
  FOR DELETE TO authenticated
  USING ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage())
         OR ((SELECT public.song_library_can_read()) AND (
               user_id = (SELECT auth.uid())
               OR request_id IN (SELECT r.id FROM public.song_library_help_requests r
                                  WHERE r.asked_by = (SELECT auth.uid())))));

-- subscriptions: own rows only.
DROP POLICY IF EXISTS "Song library: own subscriptions" ON public.song_library_subscriptions;
CREATE POLICY "Song library: own subscriptions" ON public.song_library_subscriptions
  FOR ALL TO authenticated
  USING ((SELECT public.song_library_is_admin())
         OR ((SELECT public.song_library_can_read()) AND user_id = (SELECT auth.uid())))
  WITH CHECK ((SELECT public.song_library_is_admin())
              OR ((SELECT public.song_library_can_read()) AND user_id = (SELECT auth.uid())));

-- notifications: read own.
DROP POLICY IF EXISTS "Song library: read own notifications" ON public.song_library_notifications;
CREATE POLICY "Song library: read own notifications" ON public.song_library_notifications
  FOR SELECT TO authenticated
  USING ((SELECT public.song_library_is_admin())
         OR ((SELECT public.song_library_can_read()) AND user_id = (SELECT auth.uid())));

-- stage settings: everyone reads; managers set thresholds.
DROP POLICY IF EXISTS "Song library: read stage settings" ON public.song_library_stage_settings;
CREATE POLICY "Song library: read stage settings" ON public.song_library_stage_settings
  FOR SELECT TO authenticated
  USING ((SELECT public.song_library_can_read()));
DROP POLICY IF EXISTS "Song library: managers set thresholds" ON public.song_library_stage_settings;
CREATE POLICY "Song library: managers set thresholds" ON public.song_library_stage_settings
  FOR UPDATE TO authenticated
  USING ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage()))
  WITH CHECK ((SELECT public.song_library_is_admin()) OR (SELECT public.song_library_can_manage()));

-- ────────────────────────────────────────────────────────────
-- 7. Storage: private 'song-library' bucket
-- ────────────────────────────────────────────────────────────
-- 200 MB per object (uncompressed WAV demos). Audio for versions, PDF and
-- images for charts.
-- The app should serve reads as short-lived signed URLs; these policies
-- are the gate for any direct storage call.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'song-library',
  'song-library',
  false,
  209715200,
  ARRAY[
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav',
    'audio/wave', 'audio/ogg', 'audio/webm', 'audio/flac',
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Song library bucket: readers read" ON storage.objects;
CREATE POLICY "Song library bucket: readers read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'song-library' AND public.song_library_storage_can_read(name));

DROP POLICY IF EXISTS "Song library bucket: writers upload" ON storage.objects;
CREATE POLICY "Song library bucket: writers upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'song-library' AND public.song_library_storage_can_write(name));

DROP POLICY IF EXISTS "Song library bucket: writers delete" ON storage.objects;
CREATE POLICY "Song library bucket: writers delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'song-library' AND public.song_library_storage_can_write(name));

-- No UPDATE policy: objects are never overwritten in place.

-- ────────────────────────────────────────────────────────────
-- 8. Service catalogue (seed data; the only place a slug appears)
-- ────────────────────────────────────────────────────────────

INSERT INTO public.services (service_key, label, admin_href)
VALUES ('song_library', 'Song Library', '/song-library')
ON CONFLICT (service_key) DO NOTHING;

INSERT INTO public.service_owners (
  service_key, staff_ministry_id, capability, member_role, any_point_leader, open_to_all, admin_href
)
SELECT s.service_key, m.id, v.capability, v.member_role, false, v.open_to_all, s.admin_href
  FROM (VALUES
    ('prayer_and_worship', 'own',    'member', false),
    ('prayer_and_worship', 'manage', 'member', false),
    (NULL,                 'use',    NULL,     true)
  ) AS v(slug, capability, member_role, open_to_all)
  JOIN public.services s ON s.service_key = 'song_library'
  LEFT JOIN public.staff_ministries m ON m.slug = v.slug
 WHERE (v.slug IS NULL OR m.id IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1
       FROM public.service_owners so
      WHERE so.service_key = s.service_key
        AND so.capability = v.capability
        AND so.any_point_leader = false
        AND so.open_to_all = v.open_to_all
        AND so.staff_ministry_id IS NOT DISTINCT FROM m.id
   );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_ministries WHERE slug = 'prayer_and_worship') THEN
    RAISE NOTICE '419 song_library: no prayer_and_worship staff ministry, so no own/manage grant was seeded';
  END IF;
END $$;

COMMIT;

-- ============================================================
-- Verify after applying:
--   SELECT service_key, capability, member_role, open_to_all, staff_ministry_id
--     FROM public.service_owners WHERE service_key = 'song_library';
--     -- expect own + manage for prayer_and_worship, use open_to_all
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname LIKE 'song\_library\_%' AND relkind = 'r';
--     -- expect 16 rows, all true
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'song-library';
--   SELECT policyname FROM pg_policies
--    WHERE schemaname = 'storage' AND policyname LIKE 'Song library bucket%';
--     -- expect 3
-- ============================================================
