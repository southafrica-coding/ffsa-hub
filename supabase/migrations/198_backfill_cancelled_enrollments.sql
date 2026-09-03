-- ============================================================
-- FFSA Hub — Backfill: take cancelled/rejected applicants off the roster
-- ============================================================
-- Accepting an application creates an enrollment (api/admin/accept-application).
-- Cancelling or rejecting that application afterwards only deactivated the
-- person's membership profile — the enrollment row was left live, so the
-- student stayed on the school roster and inside every dashboard headcount
-- ("enrolled", "arrived", and the accepted-or-enrolled demographics widgets).
--
-- The API now soft-removes the enrollment at the moment the application is
-- cancelled/rejected. This clears the people it already happened to.
--
-- Deliberately conservative:
--   * soft-remove only (removed_at), so Restore undoes it losslessly — and
--     re-accepting the applicant clears it automatically;
--   * pre-arrival enrolments only. Someone who actually arrived, graduated,
--     was dismissed or decided to leave has a real history on the roster
--     regardless of what their application row says.
-- removed_by is left null: no person took this action.
-- ============================================================

UPDATE public.enrollments e
SET removed_at = now()
FROM public.application_responses ar
WHERE ar.user_id = e.user_id
  AND ar.program_id = e.program_id
  AND ar.status IN ('cancelled', 'rejected')
  AND e.removed_at IS NULL
  AND e.status = 'waiting_for_arrival';
