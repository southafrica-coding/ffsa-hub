-- ============================================================
-- FFSA Hub — Migration 416: L10 teams (Prayer & Worship first)
-- ============================================================
-- Depends on 318 (dept_* helpers) and 320 (public.rocks). Applied by
-- hand, on prod only with Jack's explicit OK.
--
-- A department (a staff_ministries row) can run several L10 teams. P&W
-- runs three: Production, Live and Team 3. Each team has its own roster,
-- rocks, scorecard, to-dos, issues (IDS), headlines and meetings.
--
-- Rocks: 320's public.rocks is extended, not duplicated. A nullable
-- team_id is added. team_id NULL = a department rock, exactly as in 320
-- (same read/write rules). team_id set = a team rock: the team's
-- department must equal rocks.staff_ministry_id (composite FK), and the
-- team rules below apply instead of 320's.
--
-- Issues belong to the team (team_id NOT NULL), not to a meeting. An
-- unsolved issue simply stays open and shows at every meeting until it is
-- solved; nothing is copied. source_meeting_id = where it was raised,
-- resolved_meeting_id = where it was solved (both nullable, SET NULL).
--
-- Slack: l10_teams.slack_channel_id is the recap channel.
-- l10_meetings.recap_posted_at claims the channel recap (idempotency);
-- l10_meetings.followup_sent_at and l10_meeting_attendees.followup_sent_at
-- record follow-up sends.
--
-- Every other team-owned table carries team_id itself. Child rows (a
-- weekly value, an attendee, a to-do's source meeting) point at their
-- parent through a composite FK on (team_id, id), so a row cannot claim
-- one team while hanging off another team's parent. RLS is then one
-- check on team_id per table, with no joins in policies.
--
-- Access, via SECURITY DEFINER helpers (search_path '', no RLS recursion):
--   l10_can_access_team(team)  active caller AND (team member
--                              OR leader of the team's department OR admin)
--   l10_can_manage_team(team)  active caller AND (team leader
--                              OR leader of the team's department OR admin)
--   l10_can_oversee_team(team) active caller AND (leader of the team's
--                              department OR admin)
-- l10_teams:          read = access, write = oversee
-- l10_team_members:   read = access, write = manage
-- all other L10 rows: read/write = access
-- attendee rating:    trigger l10_meeting_attendees_rating_guard; only
--                     the attendee, team leaders, overseers or the
--                     meeting facilitator may set it (42501
--                     l10_rating_not_allowed). service_role is exempt.
-- anon and every other authenticated user: nothing.
--
-- Seed: production, live and team-3 under prayer_and_worship, looked up
-- by slug. ON CONFLICT DO NOTHING, so a re-run does not overwrite a name,
-- schedule or facilitator someone has since set. No people are seeded.
-- Idempotent: safe to run twice.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Teams and rosters
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.l10_teams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id     uuid NOT NULL REFERENCES public.staff_ministries (id) ON DELETE RESTRICT,
  slug              text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name              text NOT NULL CHECK (btrim(name) <> ''),
  meeting_weekday   smallint CHECK (meeting_weekday BETWEEN 1 AND 7),
  meeting_time      time,
  meeting_timezone  text NOT NULL DEFAULT 'Africa/Johannesburg' CHECK (btrim(meeting_timezone) <> ''),
  facilitator_id    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  slack_channel_id  text CHECK (slack_channel_id IS NULL OR btrim(slack_channel_id) <> ''),
  sort_order        int NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT l10_teams_department_slug_key UNIQUE (department_id, slug),
  -- Target for composite FKs that pin a child to the team's department.
  CONSTRAINT l10_teams_id_department_key UNIQUE (id, department_id)
);

CREATE INDEX IF NOT EXISTS l10_teams_facilitator_id_idx ON public.l10_teams (facilitator_id);

COMMENT ON TABLE public.l10_teams IS
  'An EOS L10 team inside one department (staff_ministries). P&W has production, live and team-3.';
COMMENT ON COLUMN public.l10_teams.department_id IS 'staff_ministries.id of the owning department.';
COMMENT ON COLUMN public.l10_teams.meeting_weekday IS 'ISO weekday, 1 = Monday … 7 = Sunday. Null until set.';
COMMENT ON COLUMN public.l10_teams.meeting_time IS 'Local start time in meeting_timezone. Null until set.';
COMMENT ON COLUMN public.l10_teams.slack_channel_id IS 'Slack channel id (for example C0123ABCD) for the post-meeting recap. Null = no channel recap.';

CREATE TABLE IF NOT EXISTS public.l10_team_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES public.l10_teams (id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'leader')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT l10_team_members_team_profile_key UNIQUE (team_id, profile_id)
);

-- (team_id, profile_id) is covered by the unique index; this one serves
-- "which teams am I on" and the profile FK.
CREATE INDEX IF NOT EXISTS l10_team_members_profile_id_idx ON public.l10_team_members (profile_id);

COMMENT ON TABLE public.l10_team_members IS 'Roster of one L10 team. role is member or leader.';

-- ────────────────────────────────────────────────────────────
-- 2. Access helpers
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.l10_can_oversee_team(p_team_id uuid)
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
           FROM public.l10_teams t
          WHERE t.id = p_team_id
            AND public.dept_is_ministry_leader(t.department_id)
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.l10_is_team_member(
  p_team_id uuid,
  p_leaders_only boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND EXISTS (
       SELECT 1
         FROM public.l10_team_members m
        WHERE m.team_id = p_team_id
          AND m.profile_id = auth.uid()
          AND (NOT p_leaders_only OR m.role = 'leader')
     );
$$;

CREATE OR REPLACE FUNCTION public.l10_can_access_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.l10_is_team_member(p_team_id, false)
      OR public.l10_can_oversee_team(p_team_id);
$$;

CREATE OR REPLACE FUNCTION public.l10_can_manage_team(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.l10_is_team_member(p_team_id, true)
      OR public.l10_can_oversee_team(p_team_id);
$$;

REVOKE ALL ON FUNCTION public.l10_can_oversee_team(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.l10_is_team_member(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.l10_can_access_team(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.l10_can_manage_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.l10_can_oversee_team(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.l10_is_team_member(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.l10_can_access_team(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.l10_can_manage_team(uuid) TO authenticated, service_role;

-- Segment timings shape check (used by l10_meetings below).
-- An object whose keys are L10 segments and whose values are objects
-- with only started_at / ended_at (ISO timestamp strings or null).
CREATE OR REPLACE FUNCTION public.l10_segment_timings_valid(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(p) = 'object'
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_each(p) e
        WHERE e.key NOT IN ('segue', 'scorecard', 'rock_review', 'headlines',
                            'todo_list', 'ids', 'conclude')
           OR jsonb_typeof(e.value) <> 'object'
           OR EXISTS (
             SELECT 1
               FROM jsonb_each(e.value) f
              WHERE f.key NOT IN ('started_at', 'ended_at')
                 OR jsonb_typeof(f.value) NOT IN ('string', 'null')
           )
     );
$$;

REVOKE ALL ON FUNCTION public.l10_segment_timings_valid(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.l10_segment_timings_valid(jsonb) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 3. Meetings and attendees
-- ────────────────────────────────────────────────────────────
-- Segment timings are jsonb on the meeting, not a child table: there are
-- seven fixed segments, they are always read and written with their
-- meeting, and nothing queries one segment across meetings. A child table
-- would add a table, an RLS set and a join for no query we need.

CREATE TABLE IF NOT EXISTS public.l10_meetings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid NOT NULL REFERENCES public.l10_teams (id) ON DELETE RESTRICT,
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  facilitator_id    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  segment_timings   jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT l10_meetings_segment_timings_shape CHECK (public.l10_segment_timings_valid(segment_timings)),
  notes             text,
  recap_posted_at   timestamptz,
  followup_sent_at  timestamptz,
  created_by        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT l10_meetings_ended_after_start CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT l10_meetings_team_id_id_key UNIQUE (team_id, id)
);

CREATE INDEX IF NOT EXISTS l10_meetings_team_started_idx ON public.l10_meetings (team_id, started_at DESC);
CREATE INDEX IF NOT EXISTS l10_meetings_facilitator_id_idx ON public.l10_meetings (facilitator_id);
CREATE INDEX IF NOT EXISTS l10_meetings_created_by_idx ON public.l10_meetings (created_by);

COMMENT ON COLUMN public.l10_meetings.segment_timings IS
  'Keys: segue, scorecard, rock_review, headlines, todo_list, ids, conclude. Each value: {"started_at": ISO|null, "ended_at": ISO|null}.';
COMMENT ON COLUMN public.l10_meetings.recap_posted_at IS
  'Idempotency claim for the recap posted to l10_teams.slack_channel_id. Set once; null = not posted.';
COMMENT ON COLUMN public.l10_meetings.followup_sent_at IS
  'When the team-level follow-up (recap) went out. Per-person Slack DMs use l10_meeting_attendees.followup_sent_at.';

CREATE TABLE IF NOT EXISTS public.l10_meeting_attendees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid NOT NULL,
  meeting_id        uuid NOT NULL,
  profile_id        uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  rating            smallint CHECK (rating BETWEEN 1 AND 10),
  followup_sent_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT l10_meeting_attendees_meeting_fkey
    FOREIGN KEY (team_id, meeting_id) REFERENCES public.l10_meetings (team_id, id) ON DELETE CASCADE,
  CONSTRAINT l10_meeting_attendees_meeting_profile_key UNIQUE (meeting_id, profile_id)
);

CREATE INDEX IF NOT EXISTS l10_meeting_attendees_team_meeting_idx ON public.l10_meeting_attendees (team_id, meeting_id);
CREATE INDEX IF NOT EXISTS l10_meeting_attendees_profile_id_idx ON public.l10_meeting_attendees (profile_id);

COMMENT ON COLUMN public.l10_meeting_attendees.rating IS 'The attendee''s 1–10 meeting rating. Null until rated.';
COMMENT ON COLUMN public.l10_meeting_attendees.followup_sent_at IS 'When this attendee''s Slack follow-up DM was sent. Null = not sent.';

-- Ratings. RLS lets anyone with team access write attendee rows; the
-- rating itself is narrower. A caller may set or change a rating only on
-- their own attendee row, unless they are a team leader, an overseer
-- (admin or leader of the team's department) or that meeting's
-- facilitator (the conclude screen: one person enters everyone's 1–10).
-- Other columns (followup_sent_at included) follow the table policies.
-- Only authenticated / anon callers are checked: service_role and the
-- table owner (migrations, SQL editor) are not.

CREATE OR REPLACE FUNCTION public.l10_can_rate_attendee(
  p_team_id uuid,
  p_meeting_id uuid,
  p_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.dept_caller_is_active()
     AND (
       p_profile_id = auth.uid()
       OR public.l10_can_manage_team(p_team_id)
       OR EXISTS (
         SELECT 1
           FROM public.l10_meetings mt
          WHERE mt.id = p_meeting_id
            AND mt.team_id = p_team_id
            AND mt.facilitator_id = auth.uid()
       )
     );
$$;

REVOKE ALL ON FUNCTION public.l10_can_rate_attendee(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.l10_can_rate_attendee(uuid, uuid, uuid) TO authenticated, service_role;

-- SECURITY INVOKER on purpose: current_user must be the caller's role so
-- service_role and the owner can be told apart from authenticated. The
-- membership lookups run inside the SECURITY DEFINER helper above.
CREATE OR REPLACE FUNCTION public.l10_meeting_attendees_rating_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.rating IS NULL THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.rating IS NOT DISTINCT FROM OLD.rating
        AND NEW.profile_id = OLD.profile_id
        AND NEW.meeting_id = OLD.meeting_id
        AND NEW.team_id = OLD.team_id THEN
    -- Rating untouched and still on the same person and meeting.
    RETURN NEW;
  ELSIF NEW.rating IS NULL AND OLD.rating IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.l10_can_rate_attendee(NEW.team_id, NEW.meeting_id, NEW.profile_id)
     OR (TG_OP = 'UPDATE'
         AND OLD.rating IS NOT NULL
         AND NOT public.l10_can_rate_attendee(OLD.team_id, OLD.meeting_id, OLD.profile_id)) THEN
    RAISE EXCEPTION 'l10_rating_not_allowed'
      USING ERRCODE = '42501',
            DETAIL = 'Only the attendee, a team leader, a department leader, an admin or the meeting facilitator can set this rating.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.l10_meeting_attendees_rating_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS l10_meeting_attendees_rating_guard ON public.l10_meeting_attendees;
CREATE TRIGGER l10_meeting_attendees_rating_guard
  BEFORE INSERT OR UPDATE ON public.l10_meeting_attendees
  FOR EACH ROW EXECUTE FUNCTION public.l10_meeting_attendees_rating_guard();

-- ────────────────────────────────────────────────────────────
-- 4. Rocks — extend 320
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.rocks ADD COLUMN IF NOT EXISTS team_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'rocks_team_department_fkey'
       AND conrelid = 'public.rocks'::regclass
  ) THEN
    ALTER TABLE public.rocks
      ADD CONSTRAINT rocks_team_department_fkey
      FOREIGN KEY (team_id, staff_ministry_id)
      REFERENCES public.l10_teams (id, department_id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS rocks_team_quarter_idx
  ON public.rocks (team_id, quarter) WHERE team_id IS NOT NULL;

COMMENT ON COLUMN public.rocks.team_id IS
  'Null: a department rock (320 rules). Set: an L10 team rock; staff_ministry_id must be that team''s department, and the L10 team rules apply.';

-- 320's policies, split on team_id. Department rocks keep exactly the
-- 320 checks. Team rocks use the team helper.
DROP POLICY IF EXISTS "Ministry readers read rocks" ON public.rocks;
CREATE POLICY "Ministry readers read rocks"
  ON public.rocks FOR SELECT TO authenticated
  USING (
    CASE WHEN team_id IS NULL
      THEN (SELECT public.dept_can_read_rock(staff_ministry_id))
      ELSE (SELECT public.l10_can_access_team(team_id))
    END
  );

DROP POLICY IF EXISTS "Ministry leaders insert rocks" ON public.rocks;
CREATE POLICY "Ministry leaders insert rocks"
  ON public.rocks FOR INSERT TO authenticated
  WITH CHECK (
    CASE WHEN team_id IS NULL
      THEN (SELECT public.dept_can_write_rock(staff_ministry_id))
      ELSE (SELECT public.l10_can_access_team(team_id))
    END
  );

DROP POLICY IF EXISTS "Ministry leaders update rocks" ON public.rocks;
CREATE POLICY "Ministry leaders update rocks"
  ON public.rocks FOR UPDATE TO authenticated
  USING (
    CASE WHEN team_id IS NULL
      THEN (SELECT public.dept_can_write_rock(staff_ministry_id))
      ELSE (SELECT public.l10_can_access_team(team_id))
    END
  )
  WITH CHECK (
    CASE WHEN team_id IS NULL
      THEN (SELECT public.dept_can_write_rock(staff_ministry_id))
      ELSE (SELECT public.l10_can_access_team(team_id))
    END
  );

DROP POLICY IF EXISTS "Ministry leaders delete rocks" ON public.rocks;
CREATE POLICY "Ministry leaders delete rocks"
  ON public.rocks FOR DELETE TO authenticated
  USING (
    CASE WHEN team_id IS NULL
      THEN (SELECT public.dept_can_write_rock(staff_ministry_id))
      ELSE (SELECT public.l10_can_access_team(team_id))
    END
  );

-- ────────────────────────────────────────────────────────────
-- 5. Scorecard
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.l10_measurables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid NOT NULL REFERENCES public.l10_teams (id) ON DELETE RESTRICT,
  title           text NOT NULL CHECK (btrim(title) <> ''),
  owner_id        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  unit            text NOT NULL DEFAULT 'number' CHECK (unit IN ('number', 'percent', 'currency', 'yes_no')),
  goal_value      numeric,
  goal_direction  text NOT NULL DEFAULT 'at_least' CHECK (goal_direction IN ('at_least', 'at_most', 'exactly')),
  sort_order      int NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT l10_measurables_team_id_id_key UNIQUE (team_id, id)
);

CREATE INDEX IF NOT EXISTS l10_measurables_owner_id_idx ON public.l10_measurables (owner_id);
CREATE INDEX IF NOT EXISTS l10_measurables_created_by_idx ON public.l10_measurables (created_by);

COMMENT ON TABLE public.l10_measurables IS 'One scorecard row for an L10 team. Retire with is_active = false; weekly values keep it from being deleted.';

CREATE TABLE IF NOT EXISTS public.l10_measurable_values (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid NOT NULL,
  measurable_id   uuid NOT NULL,
  week_start      date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  value           numeric,
  note            text,
  entered_by      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT l10_measurable_values_measurable_fkey
    FOREIGN KEY (team_id, measurable_id) REFERENCES public.l10_measurables (team_id, id) ON DELETE RESTRICT,
  CONSTRAINT l10_measurable_values_measurable_week_key UNIQUE (measurable_id, week_start)
);

CREATE INDEX IF NOT EXISTS l10_measurable_values_team_week_idx ON public.l10_measurable_values (team_id, measurable_id, week_start);
CREATE INDEX IF NOT EXISTS l10_measurable_values_entered_by_idx ON public.l10_measurable_values (entered_by);

COMMENT ON COLUMN public.l10_measurable_values.week_start IS 'Monday (SAST calendar date) of the scorecard week.';
COMMENT ON COLUMN public.l10_measurable_values.value IS 'Null = not entered. yes_no measurables store 1 or 0.';

-- ────────────────────────────────────────────────────────────
-- 6. To-dos, issues (IDS), headlines
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.l10_todos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            uuid NOT NULL REFERENCES public.l10_teams (id) ON DELETE RESTRICT,
  title              text NOT NULL CHECK (btrim(title) <> ''),
  owner_id           uuid REFERENCES public.users (id) ON DELETE SET NULL,
  due_on             date,
  done               boolean NOT NULL DEFAULT false,
  done_at            timestamptz,
  source_meeting_id  uuid,
  created_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT l10_todos_done_at_matches CHECK (done = (done_at IS NOT NULL)),
  CONSTRAINT l10_todos_source_meeting_fkey
    FOREIGN KEY (team_id, source_meeting_id) REFERENCES public.l10_meetings (team_id, id)
    ON DELETE SET NULL (source_meeting_id)
);

CREATE INDEX IF NOT EXISTS l10_todos_team_open_idx ON public.l10_todos (team_id, done, due_on);
CREATE INDEX IF NOT EXISTS l10_todos_owner_id_idx ON public.l10_todos (owner_id);
CREATE INDEX IF NOT EXISTS l10_todos_source_meeting_idx ON public.l10_todos (team_id, source_meeting_id) WHERE source_meeting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS l10_todos_created_by_idx ON public.l10_todos (created_by);

COMMENT ON COLUMN public.l10_todos.done_at IS 'Set exactly when done is true (CHECK).';

CREATE TABLE IF NOT EXISTS public.l10_issues (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            uuid NOT NULL REFERENCES public.l10_teams (id) ON DELETE RESTRICT,
  title              text NOT NULL CHECK (btrim(title) <> ''),
  description        text,
  owner_id           uuid REFERENCES public.users (id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'identified'
    CHECK (status IN ('identified', 'discussed', 'solved')),
  priority           smallint CHECK (priority BETWEEN 1 AND 3),
  solved_at            timestamptz,
  source_meeting_id    uuid,
  resolved_meeting_id  uuid,
  created_by           uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT l10_issues_solved_at_matches CHECK ((status = 'solved') = (solved_at IS NOT NULL)),
  CONSTRAINT l10_issues_resolved_meeting_only_when_solved
    CHECK (resolved_meeting_id IS NULL OR status = 'solved'),
  CONSTRAINT l10_issues_source_meeting_fkey
    FOREIGN KEY (team_id, source_meeting_id) REFERENCES public.l10_meetings (team_id, id)
    ON DELETE SET NULL (source_meeting_id),
  CONSTRAINT l10_issues_resolved_meeting_fkey
    FOREIGN KEY (team_id, resolved_meeting_id) REFERENCES public.l10_meetings (team_id, id)
    ON DELETE SET NULL (resolved_meeting_id)
);

-- (team_id, status) leads this index, so it serves the open-issues list
-- that carries over meeting to meeting.
CREATE INDEX IF NOT EXISTS l10_issues_team_status_idx ON public.l10_issues (team_id, status, priority);
CREATE INDEX IF NOT EXISTS l10_issues_owner_id_idx ON public.l10_issues (owner_id);
CREATE INDEX IF NOT EXISTS l10_issues_source_meeting_idx ON public.l10_issues (team_id, source_meeting_id) WHERE source_meeting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS l10_issues_resolved_meeting_idx ON public.l10_issues (team_id, resolved_meeting_id) WHERE resolved_meeting_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS l10_issues_created_by_idx ON public.l10_issues (created_by);

COMMENT ON TABLE public.l10_issues IS
  'Team IDS list. An issue belongs to the team, not a meeting: it stays open (identified/discussed) and shows at every meeting until solved. Nothing is copied between meetings.';
COMMENT ON COLUMN public.l10_issues.status IS 'IDS: identified, discussed or solved. solved_at is set exactly when solved.';
COMMENT ON COLUMN public.l10_issues.source_meeting_id IS 'Meeting where it was raised. Null if raised outside a meeting or that meeting was deleted.';
COMMENT ON COLUMN public.l10_issues.resolved_meeting_id IS 'Meeting where it was solved. Only allowed when status = solved; may stay null for an issue solved outside a meeting.';
COMMENT ON COLUMN public.l10_issues.priority IS 'Optional top-3 rank for this meeting''s IDS (1 = first). Null = unranked.';

CREATE TABLE IF NOT EXISTS public.l10_headlines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            uuid NOT NULL REFERENCES public.l10_teams (id) ON DELETE RESTRICT,
  body               text NOT NULL CHECK (btrim(body) <> ''),
  author_id          uuid REFERENCES public.users (id) ON DELETE SET NULL,
  source_meeting_id  uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT l10_headlines_source_meeting_fkey
    FOREIGN KEY (team_id, source_meeting_id) REFERENCES public.l10_meetings (team_id, id)
    ON DELETE SET NULL (source_meeting_id)
);

CREATE INDEX IF NOT EXISTS l10_headlines_team_created_idx ON public.l10_headlines (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS l10_headlines_author_id_idx ON public.l10_headlines (author_id);
CREATE INDEX IF NOT EXISTS l10_headlines_source_meeting_idx ON public.l10_headlines (team_id, source_meeting_id) WHERE source_meeting_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 7. updated_at triggers, grants, RLS
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'l10_teams', 'l10_team_members', 'l10_meetings', 'l10_meeting_attendees',
    'l10_measurables', 'l10_measurable_values', 'l10_todos', 'l10_issues', 'l10_headlines'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', t);
  END LOOP;
END
$$;

-- l10_teams: team access reads, department leaders and admins write.
DROP POLICY IF EXISTS "L10 team access reads teams" ON public.l10_teams;
CREATE POLICY "L10 team access reads teams"
  ON public.l10_teams FOR SELECT TO authenticated
  USING ((SELECT public.l10_can_access_team(id)));

DROP POLICY IF EXISTS "L10 overseers insert teams" ON public.l10_teams;
CREATE POLICY "L10 overseers insert teams"
  ON public.l10_teams FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.dept_caller_is_active())
    AND ((SELECT public.is_admin()) OR (SELECT public.dept_is_ministry_leader(department_id)))
  );

DROP POLICY IF EXISTS "L10 overseers update teams" ON public.l10_teams;
CREATE POLICY "L10 overseers update teams"
  ON public.l10_teams FOR UPDATE TO authenticated
  USING ((SELECT public.l10_can_oversee_team(id)))
  WITH CHECK (
    (SELECT public.dept_caller_is_active())
    AND ((SELECT public.is_admin()) OR (SELECT public.dept_is_ministry_leader(department_id)))
  );

DROP POLICY IF EXISTS "L10 overseers delete teams" ON public.l10_teams;
CREATE POLICY "L10 overseers delete teams"
  ON public.l10_teams FOR DELETE TO authenticated
  USING ((SELECT public.l10_can_oversee_team(id)));

-- l10_team_members: team access reads, team leaders / overseers write.
DROP POLICY IF EXISTS "L10 team access reads members" ON public.l10_team_members;
CREATE POLICY "L10 team access reads members"
  ON public.l10_team_members FOR SELECT TO authenticated
  USING ((SELECT public.l10_can_access_team(team_id)));

DROP POLICY IF EXISTS "L10 team managers insert members" ON public.l10_team_members;
CREATE POLICY "L10 team managers insert members"
  ON public.l10_team_members FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.l10_can_manage_team(team_id)));

DROP POLICY IF EXISTS "L10 team managers update members" ON public.l10_team_members;
CREATE POLICY "L10 team managers update members"
  ON public.l10_team_members FOR UPDATE TO authenticated
  USING ((SELECT public.l10_can_manage_team(team_id)))
  WITH CHECK ((SELECT public.l10_can_manage_team(team_id)));

DROP POLICY IF EXISTS "L10 team managers delete members" ON public.l10_team_members;
CREATE POLICY "L10 team managers delete members"
  ON public.l10_team_members FOR DELETE TO authenticated
  USING ((SELECT public.l10_can_manage_team(team_id)));

-- Everything else: anyone with team access reads and writes.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'l10_meetings', 'l10_meeting_attendees', 'l10_measurables',
    'l10_measurable_values', 'l10_todos', 'l10_issues', 'l10_headlines'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "L10 team access reads" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "L10 team access reads" ON public.%I FOR SELECT TO authenticated
         USING ((SELECT public.l10_can_access_team(team_id)))', t);
    EXECUTE format('DROP POLICY IF EXISTS "L10 team access inserts" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "L10 team access inserts" ON public.%I FOR INSERT TO authenticated
         WITH CHECK ((SELECT public.l10_can_access_team(team_id)))', t);
    EXECUTE format('DROP POLICY IF EXISTS "L10 team access updates" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "L10 team access updates" ON public.%I FOR UPDATE TO authenticated
         USING ((SELECT public.l10_can_access_team(team_id)))
         WITH CHECK ((SELECT public.l10_can_access_team(team_id)))', t);
    EXECUTE format('DROP POLICY IF EXISTS "L10 team access deletes" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "L10 team access deletes" ON public.%I FOR DELETE TO authenticated
         USING ((SELECT public.l10_can_access_team(team_id)))', t);
  END LOOP;
END
$$;

-- ────────────────────────────────────────────────────────────
-- 8. Seed the three P&W teams
-- ────────────────────────────────────────────────────────────
-- Looked up by slug. No-op (with a notice) when prayer_and_worship is
-- missing. An existing team row is left exactly as it is.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_ministries WHERE slug = 'prayer_and_worship') THEN
    RAISE NOTICE '416: staff ministry prayer_and_worship not found; P&W L10 teams not seeded';
  END IF;
END
$$;

INSERT INTO public.l10_teams (department_id, slug, name, sort_order)
SELECT sm.id, v.slug, v.name, v.sort_order
  FROM public.staff_ministries sm
  CROSS JOIN (VALUES
    ('production', 'Production', 10),
    ('live',       'Live',       20),
    ('team-3',     'Team 3',     30)
  ) AS v(slug, name, sort_order)
 WHERE sm.slug = 'prayer_and_worship'
ON CONFLICT (department_id, slug) DO NOTHING;
