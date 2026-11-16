-- 328_reference_requests_assigned_staff_read.sql
--
-- Bug: an assigned application reviewer can read the application and
-- cannot read its references.
--
-- "Assigned staff can read their application_responses" lets a
-- program_staff user through when they are
-- application_responses.assigned_staff_id and
-- can_access_assigned_school_record(program_id) is true, via
-- application_gate. They do not need schools.manage, admin, or
-- program-leader.
--
-- reference_requests has no matching SELECT policy. The only staff
-- SELECT policy is "Schools managers can read all reference requests",
-- USING reference_request_access(application_id), and that helper only
-- allows has_schools_access. GET /api/schools/applications/references
-- reads with the signed-in user's client, so the reviewer gets an empty
-- list. Reviewers on School of Bible Immersion currently see no
-- references for their assigned applicants.
--
-- This adds one SELECT policy for authenticated, gated the same way as
-- the application read. It does not change reference_request_access(),
-- and it does not change the INSERT or UPDATE policies. A reviewer
-- still cannot write a reference. Idempotent.

DROP POLICY IF EXISTS "Assigned staff can read their applications' references"
  ON public.reference_requests;

CREATE POLICY "Assigned staff can read their applications' references"
  ON public.reference_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.application_responses ar
      WHERE ar.id = reference_requests.application_id
        AND public.application_gate(
          ar.program_id,
          ar.assigned_staff_id = (SELECT auth.uid())
          AND public.can_access_assigned_school_record(ar.program_id)
        )
    )
  );
