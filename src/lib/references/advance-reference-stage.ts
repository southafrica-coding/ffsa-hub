import { statusAfterReferencesComplete } from "@/lib/schools/applicant-pipeline-stage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/**
 * When the reference that just arrived was the last required one, move an
 * application from submitted or waiting_for_references to
 * references_received. Later stages are not touched. The write is guarded
 * with the same early-status filter so a decision landing between the read
 * and the write is not overwritten. Does not send email.
 *
 * Swallows its own errors: a bookkeeping miss must not fail the referee's
 * submission.
 */
export async function advanceApplicationWhenReferencesComplete(
  admin: Client,
  applicationId: string
): Promise<{ advanced: boolean }> {
  try {
    const { data: app, error: appError } = await admin
      .from("application_responses")
      .select("id, program_id, status")
      .eq("id", applicationId)
      .maybeSingle();
    if (appError || !app?.program_id) return { advanced: false };
    if (app.status !== "submitted" && app.status !== "waiting_for_references") {
      return { advanced: false };
    }

    const { data: slots, error: slotError } = await admin
      .from("reference_slots")
      .select("id, is_required")
      .eq("program_id", app.program_id);
    if (slotError) return { advanced: false };
    const requiredSlotIds = ((slots ?? []) as Array<{ id: string; is_required: boolean }>)
      .filter((slot) => slot.is_required)
      .map((slot) => slot.id);

    const { data: refs, error: refError } = await admin
      .from("reference_requests")
      .select("slot_id, status")
      .eq("application_id", applicationId);
    if (refError) return { advanced: false };

    const next = statusAfterReferencesComplete({
      storedStatus: app.status,
      requiredSlotIds,
      requests: ((refs ?? []) as Array<{ slot_id: string; status: string }>).map((row) => ({
        slotId: row.slot_id,
        status: row.status,
      })),
    });
    if (!next) return { advanced: false };

    const { data: updated, error: updateError } = await admin
      .from("application_responses")
      .update({ status: next })
      .eq("id", applicationId)
      .select("id")
      .in("status", ["submitted", "waiting_for_references"]);
    const updatedRows = Array.isArray(updated) ? updated : [];
    if (updateError || updatedRows.length === 0) return { advanced: false };
    return { advanced: true };
  } catch {
    return { advanced: false };
  }
}
