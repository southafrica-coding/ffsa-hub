-- Undo migration 421 (People Manager leave) in one transaction.
-- Run on prod only with Jack's explicit OK, and only after the export
-- below. It drops every leave_* table (with their rows), the
-- leave_balances view and the leave_* helpers. It does not touch 365's
-- sa_public_holiday / easter_sunday, or anything from 318.
--
-- It refuses to run while any leave request or block-out exists, unless
-- the session sets people_manager.rollback_drops_leave = 'yes' after the
-- export:
--
--   \copy (SELECT * FROM public.leave_requests) TO 'leave_requests.csv' CSV HEADER
--   \copy (SELECT * FROM public.leave_blockouts) TO 'leave_blockouts.csv' CSV HEADER
--   \copy (SELECT * FROM public.leave_types) TO 'leave_types.csv' CSV HEADER
--   \copy (SELECT * FROM public.leave_declared_holidays) TO 'leave_declared_holidays.csv' CSV HEADER
--   SET people_manager.rollback_drops_leave = 'yes';

BEGIN;

DO $guard$
DECLARE
  n bigint := 0;
  m bigint;
BEGIN
  IF to_regclass('public.leave_requests') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.leave_requests' INTO m;
    n := n + m;
  END IF;
  IF to_regclass('public.leave_blockouts') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.leave_blockouts' INTO m;
    n := n + m;
  END IF;
  IF n > 0 AND COALESCE(current_setting('people_manager.rollback_drops_leave', true), '') <> 'yes' THEN
    RAISE EXCEPTION '421 rollback refused: % leave request/block-out row(s) exist. Export them, then SET people_manager.rollback_drops_leave = ''yes''.', n
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

DROP VIEW IF EXISTS public.leave_balances;

DROP TABLE IF EXISTS public.leave_requests;
DROP TABLE IF EXISTS public.leave_blockouts;
DROP TABLE IF EXISTS public.leave_types;
DROP TABLE IF EXISTS public.leave_declared_holidays;

DROP FUNCTION IF EXISTS public.leave_requests_guard();
DROP FUNCTION IF EXISTS public.leave_blockouts_guard();
DROP FUNCTION IF EXISTS public.leave_request_approvers(uuid);
DROP FUNCTION IF EXISTS public.leave_department_away(uuid, date, date);
DROP FUNCTION IF EXISTS public.leave_working_days(date, date, text, text);
DROP FUNCTION IF EXISTS public.leave_days_by_year(date, date, text, text);
DROP FUNCTION IF EXISTS public.leave_is_public_holiday(date);
DROP FUNCTION IF EXISTS public.leave_type_is_available(uuid, uuid);
DROP FUNCTION IF EXISTS public.leave_effective_types(uuid);
DROP FUNCTION IF EXISTS public.leave_caller_is_admin();
DROP FUNCTION IF EXISTS public.leave_can_manage_types(uuid);
DROP FUNCTION IF EXISTS public.leave_can_view_person(uuid);
DROP FUNCTION IF EXISTS public.leave_can_read_request(uuid, uuid);
DROP FUNCTION IF EXISTS public.leave_can_decide(uuid, uuid);
DROP FUNCTION IF EXISTS public.leave_user_can_decide(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.leave_user_in_department(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.leave_user_is_admin(uuid);
DROP FUNCTION IF EXISTS public.leave_user_is_active(uuid);

COMMIT;
