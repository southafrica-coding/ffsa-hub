-- Undo migration 423: puts back 419's song_library_writers_before()
-- exactly (a writer may again withdraw their own confirmation after the
-- splits are agreed, which revokes the agreement). No data changes.
-- Safe to run twice.

BEGIN;

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

COMMENT ON FUNCTION public.song_library_writers_before() IS NULL;

COMMIT;
