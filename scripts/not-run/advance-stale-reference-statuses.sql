-- ============================================================
-- NOT RUN. Do not execute this file against any database until
-- a person has reviewed the preview SELECT and chosen to apply
-- the UPDATE. This is not a migration. It does not change schema,
-- and it does not send email.
-- ============================================================
--
-- Submitting a reference used to mark reference_requests.status
-- and stop there. application_responses.status stayed on
-- 'submitted' or 'waiting_for_references' after every required
-- slot already had a submitted request. The pipeline now derives
-- References received from those rows, and the submit path writes
-- the same transition going forward. This corrects the rows that
-- are already stale.
--
-- Guard:
--   * stored status is only submitted or waiting_for_references
--   * the program has at least one required reference slot
--   * every required slot has a reference_requests row with
--     status = 'submitted' (a pending row on another slot, or a
--     second pending row on a slot that is already submitted,
--     does not block; a missing required slot does)
--   * removed applications are left alone
--
-- interview_scheduled, accepted, rejected, waitlisted, and
-- cancelled are not updated. waiting_for_references is not
-- rewritten to submitted; the applicants tab shows that stored
-- value under Submitted until the references are actually in.
-- Interview complete is not a stored status. An application that
-- also has a decisive interview outcome (recommend, hold, or
-- decline) is stored here as references_received and shown on
-- the Interview complete tab by the pipeline.
--
-- Preview first. Expect the early-stage rows whose required
-- references are all in (on 9 Nov 2026 that was one
-- waiting_for_references row and four submitted rows).

-- SELECT ar.id, ar.status, ar.program_id
-- FROM public.application_responses ar
-- WHERE ar.removed_at IS NULL
--   AND ar.status IN ('submitted', 'waiting_for_references')
--   AND EXISTS (
--     SELECT 1
--     FROM public.reference_slots rs
--     WHERE rs.program_id = ar.program_id
--       AND rs.is_required
--   )
--   AND NOT EXISTS (
--     SELECT 1
--     FROM public.reference_slots rs
--     WHERE rs.program_id = ar.program_id
--       AND rs.is_required
--       AND NOT EXISTS (
--         SELECT 1
--         FROM public.reference_requests rr
--         WHERE rr.application_id = ar.id
--           AND rr.slot_id = rs.id
--           AND rr.status = 'submitted'
--       )
--   );

UPDATE public.application_responses ar
SET status = 'references_received'
WHERE ar.removed_at IS NULL
  AND ar.status IN ('submitted', 'waiting_for_references')
  AND EXISTS (
    SELECT 1
    FROM public.reference_slots rs
    WHERE rs.program_id = ar.program_id
      AND rs.is_required
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.reference_slots rs
    WHERE rs.program_id = ar.program_id
      AND rs.is_required
      AND NOT EXISTS (
        SELECT 1
        FROM public.reference_requests rr
        WHERE rr.application_id = ar.id
          AND rr.slot_id = rs.id
          AND rr.status = 'submitted'
      )
  );
