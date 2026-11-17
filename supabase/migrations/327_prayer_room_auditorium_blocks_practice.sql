-- 327_prayer_room_auditorium_blocks_practice.sql
--
-- An approved booking of the auditorium closes the prayer room for practice,
-- including its set-up and set-down. A prayer-room block-out does the same.
-- Pending, denied and cancelled bookings do not, and neither does any other
-- venue.
--
-- The occupied window is the earlier of set-up and event start through the
-- later of set-down and event end. A set-down earlier than set-up on a single
-- day runs through 24:00 on that booking's date. The morning after is not
-- blocked: the teardown is stored on this row, and nothing is written onto
-- the next calendar day. Touching an edge is free.
--
-- practice_book_station / practice_book_band / practice_move_and_book_band /
-- practice_move_plan keep their signatures. Bookings go through
-- practice_validate_booking, which calls practice_assert_room_open. A band
-- move drops any remainder that overlaps a closure, so that leftover cannot
-- roll the move back. Same rule as remainderSegments in
-- src/lib/prayer-room/room-closure.ts.
--
-- The check is SECURITY DEFINER so a practice member who may not hold
-- bookings.view is still refused. It returns no booking row. If the read
-- itself fails, nothing is booked.

CREATE OR REPLACE FUNCTION public.practice_room_closure_reason(p_date date, p_start time, p_end time)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auditorium boolean;
  v_blockout   boolean;
BEGIN
  -- A zero-length ask is not a closure. Callers decide what to do with it.
  IF p_date IS NULL OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RETURN 'invalid';
  END IF;

  BEGIN
    SELECT EXISTS (
      SELECT 1
        FROM public.venue_bookings b
        JOIN public.venues v ON v.id = b.venue_id
       WHERE v.slug = 'auditorium'
         AND b.status = 'approved'
         AND p_date >= b.booking_date
         AND p_date <= COALESCE(b.end_date, b.booking_date)
         AND (
           (b.end_date IS NOT NULL AND b.end_date > b.booking_date)
           OR LEAST(b.setup_time, b.start_time) IS NULL
           OR GREATEST(b.setdown_time, b.end_time) IS NULL
           OR (
             LEAST(b.setup_time, b.start_time) < p_end
             AND p_start < CASE
               WHEN b.setdown_time IS NOT NULL
                AND b.setup_time IS NOT NULL
                AND b.setdown_time < b.setup_time
                 THEN time '24:00'
               WHEN GREATEST(b.setdown_time, b.end_time) < LEAST(b.setup_time, b.start_time)
                 THEN time '24:00'
               ELSE GREATEST(b.setdown_time, b.end_time)
             END
           )
         )
    ) INTO v_auditorium;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'The prayer room could not be checked against Auditorium bookings. Nothing was booked.'
        USING ERRCODE = 'check_violation';
  END;

  BEGIN
    SELECT EXISTS (
      SELECT 1
        FROM public.prayer_room_blockouts o
       WHERE p_date >= o.block_date
         AND p_date <= o.end_date
         AND (
           o.start_time IS NULL
           OR o.end_time IS NULL
           OR (o.start_time < p_end AND p_start < o.end_time)
         )
    ) INTO v_blockout;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'The prayer room could not be checked. Nothing was booked.'
        USING ERRCODE = 'check_violation';
  END;

  IF v_auditorium IS NULL OR v_blockout IS NULL THEN
    RAISE EXCEPTION 'The prayer room could not be checked. Nothing was booked.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_auditorium THEN
    RETURN 'auditorium';
  END IF;
  IF v_blockout THEN
    RETURN 'blockout';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.practice_assert_room_open(p_date date, p_start time, p_end time)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  reason text;
BEGIN
  IF p_date IS NULL OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'That practice time is not valid.'
      USING ERRCODE = 'check_violation';
  END IF;

  reason := public.practice_room_closure_reason(p_date, p_start, p_end);
  IF reason = 'auditorium' THEN
    RAISE EXCEPTION 'The Auditorium is booked then, so practice is closed.'
      USING ERRCODE = 'check_violation';
  ELSIF reason IS NOT NULL THEN
    RAISE EXCEPTION 'The prayer room is blocked out then, so practice is closed.'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.practice_room_closure_reason(date, time, time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.practice_assert_room_open(date, time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.practice_room_closure_reason(date, time, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.practice_assert_room_open(date, time, time) TO authenticated;

-- Same signature and search_path as migration 224. The room check is the
-- only addition, and it runs for a new or moved active booking. Cancelling
-- one, or saving it without changing when it is, stays allowed.
CREATE OR REPLACE FUNCTION public.practice_validate_booking()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s          public.practice_settings%ROWTYPE;
  dow        int;
  win_start  int;
  m_start    int;
  m_end      int;
  span_start time;
  span_end   time;
  st_active  boolean;
BEGIN
  -- Only an active booking has to obey the rules. Cancelling or moving one
  -- is always allowed.
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'active'
     AND NEW.practice_date = OLD.practice_date
     AND NEW.start_time = OLD.start_time
     AND NEW.end_time = OLD.end_time
     AND NEW.kind = OLD.kind
     AND NEW.station_id IS NOT DISTINCT FROM OLD.station_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM public.practice_settings LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Practice is not set up yet.' USING ERRCODE = 'check_violation';
  END IF;

  dow := extract(dow FROM NEW.practice_date)::int;
  IF dow IN (0, 6) OR dow = ANY (s.closed_weekdays) THEN
    RAISE EXCEPTION 'There is no practice on %s.', to_char(NEW.practice_date, 'FMDay')
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.start_time < s.start_time OR NEW.end_time > s.end_time THEN
    RAISE EXCEPTION 'Practice runs % to %.', to_char(s.start_time, 'HH24:MI'), to_char(s.end_time, 'HH24:MI')
      USING ERRCODE = 'check_violation';
  END IF;

  win_start := extract(epoch FROM s.start_time)::int / 60;
  m_start   := extract(epoch FROM NEW.start_time)::int / 60;
  m_end     := extract(epoch FROM NEW.end_time)::int / 60;
  IF (m_start - win_start) % s.slot_minutes <> 0 OR (m_end - win_start) % s.slot_minutes <> 0
     OR extract(second FROM NEW.start_time) <> 0 OR extract(second FROM NEW.end_time) <> 0 THEN
    RAISE EXCEPTION 'Practice is booked in %-minute rows.', s.slot_minutes
      USING ERRCODE = 'check_violation';
  END IF;

  IF m_end - m_start > s.max_minutes THEN
    RAISE EXCEPTION 'A booking can be % minutes at most.', s.max_minutes
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.kind = 'station' THEN
    SELECT is_active INTO st_active FROM public.practice_stations WHERE id = NEW.station_id;
    IF NOT coalesce(st_active, false) THEN
      RAISE EXCEPTION 'That station is not available.' USING ERRCODE = 'check_violation';
    END IF;

    -- 60 minutes means the same station in adjoining rows, however it was
    -- booked: two touching 30s by the same person count as one stretch.
    -- With a 30-minute step and a 60-minute cap a stretch is never more than
    -- two rows, so the direct neighbours are all there is to find.
    SELECT least(NEW.start_time, min(b.start_time)), greatest(NEW.end_time, max(b.end_time))
      INTO span_start, span_end
      FROM public.practice_bookings b
     WHERE b.status = 'active'
       AND b.kind = 'station'
       AND b.station_id = NEW.station_id
       AND b.booked_by = NEW.booked_by
       AND b.practice_date = NEW.practice_date
       AND b.id <> NEW.id
       AND b.start_time <= NEW.end_time
       AND b.end_time >= NEW.start_time;
    IF (extract(epoch FROM span_end) - extract(epoch FROM span_start)) / 60 > s.max_minutes THEN
      RAISE EXCEPTION 'That would be more than % minutes on the same station in a row.', s.max_minutes
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- The opening and the past only bind NEW bookings. The half-hour an admin
  -- leaves someone after a move is a continuation, not a new booking.
  IF NEW.replaces_booking_id IS NULL THEN
    IF NEW.practice_date + NEW.end_time <= public.practice_now() THEN
      RAISE EXCEPTION 'That time has already gone.' USING ERRCODE = 'check_violation';
    END IF;
    IF public.practice_now() < public.practice_opens_at(NEW.practice_date) THEN
      RAISE EXCEPTION 'Bookings for that week open %.',
        to_char(public.practice_opens_at(NEW.practice_date), 'FMDy DD Mon "at" HH24:MI')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  PERFORM public.practice_assert_room_open(NEW.practice_date, NEW.start_time, NEW.end_time);

  RETURN NEW;
END;
$$;

-- Same signature as migration 224. A remainder that overlaps a closure is
-- left out of "you still have", matching the rows the move actually writes.
CREATE OR REPLACE FUNCTION public.practice_move_plan(
  p_date date, p_start time, p_end time, p_reason text
) RETURNS TABLE (
  booking_id   uuid,
  user_id      uuid,
  person_name  text,
  station      text,
  booked_start time,
  booked_end   time,
  lost_start   time,
  lost_end     time,
  kept         text,
  message      text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  admin_name text;
  why        text := btrim(coalesce(p_reason, ''));
BEGIN
  IF NOT public.is_prayer_room_staff() THEN
    RAISE EXCEPTION 'Only an admin can move people.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, ''))
    INTO admin_name FROM public.users u WHERE u.id = auth.uid();

  why := regexp_replace(why, '[.\s]+$', '');
  IF why <> '' THEN
    why := lower(left(why, 1)) || substr(why, 2);
  END IF;

  RETURN QUERY
  WITH hit AS (
    SELECT b.id, b.start_time AS bs, b.end_time AS be, st.label AS st_label,
           greatest(b.start_time, p_start) AS ls,
           least(b.end_time, p_end)        AS le
      FROM public.practice_bookings b
      JOIN public.practice_stations st ON st.id = b.station_id
     WHERE b.status = 'active'
       AND b.kind = 'station'
       AND b.practice_date = p_date
       AND b.start_time < p_end
       AND b.end_time > p_start
  ), keep AS (
    SELECT h.*,
           CASE WHEN h.bs < h.ls THEN public.practice_room_closure_reason(p_date, h.bs, h.ls) END AS before_reason,
           CASE WHEN h.le < h.be THEN public.practice_room_closure_reason(p_date, h.le, h.be) END AS after_reason
      FROM hit h
  ), flagged AS (
    SELECT k.*,
           (k.bs < k.ls AND k.before_reason IS NULL) AS keep_before,
           (k.le < k.be AND k.after_reason IS NULL) AS keep_after,
           CASE
             WHEN k.before_reason = 'auditorium' OR k.after_reason = 'auditorium' THEN
               ' The rest is closed for an Auditorium booking.'
             WHEN k.before_reason = 'blockout' OR k.after_reason = 'blockout' THEN
               ' The rest is closed.'
             ELSE ''
           END AS closed_note
      FROM keep k
  )
  SELECT k.id,
         p.user_id,
         btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')),
         k.st_label,
         k.bs, k.be, k.ls, k.le,
         CASE
           WHEN k.keep_before AND k.keep_after THEN
             public.practice_hhmm(k.bs) || '–' || public.practice_hhmm(k.ls) || ' and ' ||
             public.practice_hhmm(k.le) || '–' || public.practice_hhmm(k.be)
           WHEN k.keep_before THEN public.practice_hhmm(k.bs) || '–' || public.practice_hhmm(k.ls)
           WHEN k.keep_after THEN public.practice_hhmm(k.le) || '–' || public.practice_hhmm(k.be)
         END,
         format('Your %s %s practice on %s was moved for a full band rehearsal%s.%s — %s',
                CASE
                  WHEN k.bs < k.ls OR k.le < k.be THEN public.practice_hhmm(k.ls)
                  ELSE public.practice_hhmm(k.bs) || '–' || public.practice_hhmm(k.be)
                END,
                lower(k.st_label),
                to_char(p_date, 'FMDay'),
                CASE WHEN why <> '' THEN ': ' || why ELSE '' END,
                CASE
                  WHEN k.keep_before AND k.keep_after THEN
                    ' You still have ' || public.practice_hhmm(k.bs) || '–' || public.practice_hhmm(k.ls) ||
                    ' and ' || public.practice_hhmm(k.le) || '–' || public.practice_hhmm(k.be) || '.'
                  WHEN k.keep_before THEN
                    ' You still have ' || public.practice_hhmm(k.bs) || '–' || public.practice_hhmm(k.ls) || '.'
                  WHEN k.keep_after THEN
                    ' You still have ' || public.practice_hhmm(k.le) || '–' || public.practice_hhmm(k.be) || '.'
                  ELSE ''
                END || k.closed_note,
                coalesce(nullif(admin_name, ''), 'Prayer room admin'))
    FROM flagged k
    JOIN public.practice_booking_people p ON p.booking_id = k.id
    JOIN public.users u ON u.id = p.user_id
   ORDER BY k.bs, k.st_label, u.first_name;
END;
$$;

-- Same signature as migration 224. Remainder inserts that would land inside
-- a closure are skipped; the band itself is still refused by the trigger
-- when the band's own window is closed.
CREATE OR REPLACE FUNCTION public.practice_move_and_book_band(
  p_date date, p_start time, p_end time, p_band_name text, p_lineup jsonb, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me       uuid := auth.uid();
  plan     jsonb;
  b        public.practice_bookings%ROWTYPE;
  band_id  uuid;
  rem_id   uuid;
  rem_ids  jsonb := '{}'::jsonb;
BEGIN
  IF me IS NULL OR NOT public.is_prayer_room_staff() THEN
    RAISE EXCEPTION 'Only an admin can move people.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Give a reason. Everyone you move is told it.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO plan
    FROM public.practice_move_plan(p_date, p_start, p_end, p_reason) x;

  FOR b IN
    SELECT * FROM public.practice_bookings
     WHERE id IN (SELECT DISTINCT (e->>'booking_id')::uuid FROM jsonb_array_elements(plan) e)
     FOR UPDATE
  LOOP
    UPDATE public.practice_bookings SET status = 'moved' WHERE id = b.id;

    rem_id := NULL;
    IF b.start_time < p_start
       AND public.practice_room_closure_reason(b.practice_date, b.start_time, p_start) IS NULL THEN
      INSERT INTO public.practice_bookings
        (kind, practice_date, start_time, end_time, station_id, booked_by, replaces_booking_id)
      VALUES ('station', b.practice_date, b.start_time, p_start, b.station_id, b.booked_by, b.id)
      RETURNING id INTO rem_id;
      INSERT INTO public.practice_booking_people (booking_id, user_id, station_id)
        SELECT rem_id, p.user_id, p.station_id FROM public.practice_booking_people p WHERE p.booking_id = b.id;
    END IF;
    IF b.end_time > p_end
       AND public.practice_room_closure_reason(b.practice_date, p_end, b.end_time) IS NULL THEN
      INSERT INTO public.practice_bookings
        (kind, practice_date, start_time, end_time, station_id, booked_by, replaces_booking_id)
      VALUES ('station', b.practice_date, p_end, b.end_time, b.station_id, b.booked_by, b.id)
      RETURNING id INTO rem_id;
      INSERT INTO public.practice_booking_people (booking_id, user_id, station_id)
        SELECT rem_id, p.user_id, p.station_id FROM public.practice_booking_people p WHERE p.booking_id = b.id;
    END IF;
    IF rem_id IS NOT NULL THEN
      rem_ids := rem_ids || jsonb_build_object(b.id::text, rem_id);
    END IF;
  END LOOP;

  band_id := public.practice_book_band(p_date, p_start, p_end, p_band_name, p_lineup);

  -- A dropped remainder is part of what they lost, not a silent gap. The
  -- recorded window grows to cover that piece; the plan's lost_start/lost_end
  -- stay the band overlap, which is what the return type has always meant.
  INSERT INTO public.practice_moves
    (booking_id, band_booking_id, remainder_booking_id, affected_user_id, moved_by,
     reason, message, lost_start, lost_end)
  SELECT (e->>'booking_id')::uuid, band_id, (rem_ids->>(e->>'booking_id'))::uuid,
         (e->>'user_id')::uuid, me, btrim(p_reason), e->>'message',
         CASE
           WHEN bk.start_time < p_start
            AND public.practice_room_closure_reason(bk.practice_date, bk.start_time, p_start)
                IN ('auditorium', 'blockout')
           THEN bk.start_time
           ELSE (e->>'lost_start')::time
         END,
         CASE
           WHEN bk.end_time > p_end
            AND public.practice_room_closure_reason(bk.practice_date, p_end, bk.end_time)
                IN ('auditorium', 'blockout')
           THEN bk.end_time
           ELSE (e->>'lost_end')::time
         END
    FROM jsonb_array_elements(plan) e
    JOIN public.practice_bookings bk ON bk.id = (e->>'booking_id')::uuid;

  RETURN band_id;
END;
$$;
