import { unassignableContactError } from "@/lib/auth/assignable-contacts";

// "Assigned" on the Applicants tab (application_responses.assigned_staff_id)
// and "Walking with" on the Students tab (enrollments.assigned_staff_id) are
// the same job for the same person in the same school, so they stay in step:
//
//   - Setting one side sets the other, when the other row exists.
//   - Clearing one side clears the other only if it held the same person.
//   - Accepting copies Assigned onto the enrolment (copyApplicationAssigneeToEnrollment).
//
// The person is matched on (user_id, program_id), which is unique on both
// tables, so there is never more than one counterpart and never one in a
// different school. A soft-removed enrolment is left alone: Accept restores it
// and copies the assignee at that point.
//
// Only the route being edited sends an assignment email. A synced write never
// sends one, so the staff member and student hear about it once.

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type StaffAssignment = {
  assigned_staff_id: string | null;
  staff_assigned_at?: string | null;
  staff_assigned_by?: string | null;
};

export type CounterpartSync = {
  /**
   * none: no counterpart row. same: it already held the new assignee.
   * synced: it was written. kept: it held someone else and was left alone
   * (a clear never removes a different person). denied: the caller lacks the
   * permission the counterpart's own route requires. failed: the write errored.
   */
  outcome: "none" | "same" | "synced" | "kept" | "denied" | "failed";
  /** The counterpart's assignee before this call, when the row exists. */
  previousStaffId: string | null;
};

/**
 * What to write on the counterpart, or null to leave it. Clearing only follows
 * when the counterpart held the person who was just removed.
 */
function counterpartTarget(
  counterpartStaffId: string | null,
  previousStaffId: string | null,
  newStaffId: string | null
): "write" | "same" | "kept" {
  if (counterpartStaffId === newStaffId) return "same";
  if (newStaffId === null) {
    return previousStaffId !== null && counterpartStaffId === previousStaffId ? "write" : "kept";
  }
  return "write";
}

function assignmentPatch(newStaffId: string | null, actorId: string) {
  return {
    assigned_staff_id: newStaffId,
    staff_assigned_at: newStaffId ? new Date().toISOString() : null,
    staff_assigned_by: newStaffId ? actorId : null,
    // Same as the assign routes: a new assignee sees it as unread.
    staff_viewed_at: null,
  };
}

/**
 * After Assigned changed on an application, bring Walking with on the same
 * person's live enrolment in the same school into line.
 *
 * The enrolment route's only check is userCanManageProgram on the
 * enrolment's program. That is the application's program, and the
 * application route has already passed it, so the caller passes true here.
 * Eligibility is per program too, so the primary route's check covers it.
 */
export async function syncEnrollmentFromApplication(
  admin: Client,
  opts: {
    userId: string | null;
    programId: string;
    previousStaffId: string | null;
    newStaffId: string | null;
    actorId: string;
    canWriteEnrollment: boolean;
  }
): Promise<CounterpartSync> {
  if (!opts.userId) return { outcome: "none", previousStaffId: null };

  const { data: enrollment, error } = await admin
    .from("enrollments")
    .select("id, assigned_staff_id, removed_at")
    .eq("user_id", opts.userId)
    .eq("program_id", opts.programId)
    .maybeSingle();
  if (error) {
    console.error("[schools] could not read enrolment to sync Walking with:", error.message);
    return { outcome: "failed", previousStaffId: null };
  }
  if (!enrollment || enrollment.removed_at) return { outcome: "none", previousStaffId: null };

  const counterpart = (enrollment.assigned_staff_id as string | null) ?? null;
  const target = counterpartTarget(counterpart, opts.previousStaffId, opts.newStaffId);
  if (target !== "write") return { outcome: target, previousStaffId: counterpart };
  if (!opts.canWriteEnrollment) return { outcome: "denied", previousStaffId: counterpart };

  const { error: updateError } = await admin
    .from("enrollments")
    .update(assignmentPatch(opts.newStaffId, opts.actorId))
    .eq("id", enrollment.id);
  if (updateError) {
    console.error("[schools] could not sync Walking with:", updateError.message);
    return { outcome: "failed", previousStaffId: counterpart };
  }

  await admin.from("audit_logs").insert({
    user_id: opts.actorId,
    action: "assign_enrollment_staff",
    resource_type: "enrollments",
    resource_id: enrollment.id,
    changes: {
      previous_staff_id: counterpart,
      new_staff_id: opts.newStaffId,
      synced_from: "application",
    },
  });
  return { outcome: "synced", previousStaffId: counterpart };
}

/**
 * After Walking with changed on an enrolment, bring Assigned on the same
 * person's application in the same school into line.
 *
 * The application route also requires userCanReadApplication (the 6-month
 * expiry lock, migration 223), which the enrolment route does not, so the
 * caller checks it for the counterpart's id via canWriteApplication. Without
 * it the application is left exactly as it is.
 */
export async function syncApplicationFromEnrollment(
  admin: Client,
  opts: {
    userId: string | null;
    programId: string;
    previousStaffId: string | null;
    newStaffId: string | null;
    actorId: string;
    canWriteApplication: (applicationId: string) => Promise<boolean>;
  }
): Promise<CounterpartSync> {
  if (!opts.userId) return { outcome: "none", previousStaffId: null };

  const { data: application, error } = await admin
    .from("application_responses")
    .select("id, assigned_staff_id")
    .eq("user_id", opts.userId)
    .eq("program_id", opts.programId)
    .maybeSingle();
  if (error) {
    console.error("[schools] could not read application to sync Assigned:", error.message);
    return { outcome: "failed", previousStaffId: null };
  }
  if (!application) return { outcome: "none", previousStaffId: null };

  const counterpart = (application.assigned_staff_id as string | null) ?? null;
  const target = counterpartTarget(counterpart, opts.previousStaffId, opts.newStaffId);
  if (target !== "write") return { outcome: target, previousStaffId: counterpart };
  if (!(await opts.canWriteApplication(application.id as string))) {
    return { outcome: "denied", previousStaffId: counterpart };
  }

  const { error: updateError } = await admin
    .from("application_responses")
    .update(assignmentPatch(opts.newStaffId, opts.actorId))
    .eq("id", application.id);
  if (updateError) {
    console.error("[schools] could not sync Assigned:", updateError.message);
    return { outcome: "failed", previousStaffId: counterpart };
  }

  await admin.from("audit_logs").insert({
    user_id: opts.actorId,
    action: "assign_application_staff",
    resource_type: "application_responses",
    resource_id: application.id,
    changes: {
      previous_staff_id: counterpart,
      new_staff_id: opts.newStaffId,
      synced_from: "enrollment",
    },
  });
  return { outcome: "synced", previousStaffId: counterpart };
}

/**
 * Accepting copies the application's Assigned onto the enrolment it created,
 * restored or found. Nothing is copied when the application has nobody (an
 * existing Walking with is never cleared by Accept), when the enrolment
 * already holds that person, or when the person is no longer assignable to
 * this school. Both Accept paths have already checked userCanManageProgram on
 * this program, which is all the enrolment route requires, so a different
 * Walking with is replaced.
 *
 * No assignment email: the staff member and student were told when Assigned
 * was set, and the acceptance email is unchanged.
 */
export async function copyApplicationAssigneeToEnrollment(
  admin: Client,
  opts: {
    enrollmentId: string;
    programId: string;
    application: StaffAssignment;
    actorId: string;
  }
): Promise<"none" | "same" | "copied" | "ineligible" | "failed"> {
  const staffId = opts.application.assigned_staff_id ?? null;
  if (!staffId) return "none";

  const { data: enrollment, error } = await admin
    .from("enrollments")
    .select("id, assigned_staff_id")
    .eq("id", opts.enrollmentId)
    .maybeSingle();
  if (error || !enrollment) {
    if (error) console.error("[schools] could not read enrolment to copy Assigned:", error.message);
    return "failed";
  }
  const previous = (enrollment.assigned_staff_id as string | null) ?? null;
  if (previous === staffId) return "same";

  if (await unassignableContactError(admin, opts.programId, staffId)) return "ineligible";

  const { error: updateError } = await admin
    .from("enrollments")
    .update({
      assigned_staff_id: staffId,
      // Keep when and by whom the applicant was assigned.
      staff_assigned_at: opts.application.staff_assigned_at ?? new Date().toISOString(),
      staff_assigned_by: opts.application.staff_assigned_by ?? opts.actorId,
      staff_viewed_at: null,
    })
    .eq("id", opts.enrollmentId);
  if (updateError) {
    console.error("[schools] could not copy Assigned onto the enrolment:", updateError.message);
    return "failed";
  }

  await admin.from("audit_logs").insert({
    user_id: opts.actorId,
    action: "assign_enrollment_staff",
    resource_type: "enrollments",
    resource_id: opts.enrollmentId,
    changes: {
      previous_staff_id: previous,
      new_staff_id: staffId,
      synced_from: "acceptance",
    },
  });
  return "copied";
}
