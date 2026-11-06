import { createAdminClient } from "@/lib/supabase/admin";
import {
  EVANGELISM_MEDIA_BUCKET,
  canDeleteTestimony,
  canEditTestimony,
  publishNeedsConfirmation,
  validateTestimonyWrite,
  type TestimonyWrite,
} from "@/lib/evangelism/contract";
import { asError, guardEvangelism, isGuard, json, notEnabled, readBody } from "@/lib/evangelism/http";
import { presentTestimony, type TestimonyRow } from "@/lib/evangelism/present";
import { isEvangelismNotReady } from "@/lib/evangelism/schema-error";
import { loadAuthorNames, signTestimonyMedia } from "@/lib/evangelism/signed-media";
import { deleteTestimony, getTestimony, updateTestimony } from "@/services/evangelism";

// GET    /api/evangelism/testimonies/:id
// PATCH  /api/evangelism/testimonies/:id
// DELETE /api/evangelism/testimonies/:id
//
// An author edits a draft or a submitted story. Publishing and withholding
// take evangelism.publish. Deleting a submitted or published story does too;
// an author can delete their own draft.

type Ctx = { params: Promise<{ id: string }> };

// Same shape as migration 293: publishers see every row, including withheld.
// Everyone else sees published rows. An author also sees their own draft
// and submitted rows. A withheld story is not visible to its author.
function visible(
  row: TestimonyRow,
  userId: string,
  access: { view: boolean; submit: boolean; publish: boolean }
): boolean {
  if (access.publish) return true;
  if (row.status === "published" && access.view) return true;
  return (
    access.submit &&
    row.author_user_id === userId &&
    (row.status === "draft" || row.status === "submitted")
  );
}

async function presentOne(row: TestimonyRow, publish: boolean) {
  const [urls, names] = await Promise.all([
    signTestimonyMedia([row]),
    loadAuthorNames([row.author_user_id]),
  ]);
  return presentTestimony(row, {
    urls,
    publish,
    authorName: names.get(row.author_user_id) ?? null,
  });
}

export async function GET(_request: Request, context: Ctx) {
  const guard = await guardEvangelism();
  if (isGuard(guard)) return guard.response;
  const { supabase, user, access } = guard;
  const { id } = await context.params;
  const { data, error } = await getTestimony(supabase, id);
  if (error) return asError(error, "Couldn't load the testimony.");
  const row = data as TestimonyRow | null;
  if (!row || !visible(row, user.id, access)) {
    return json({ error: "not_found", message: "Testimony not found." }, 404);
  }
  return json({ testimony: await presentOne(row, access.publish) });
}

export async function PATCH(request: Request, context: Ctx) {
  const guard = await guardEvangelism();
  if (isGuard(guard)) return guard.response;
  const { supabase, user, access } = guard;
  if (!access.submit) {
    return json({ error: "forbidden", message: "You cannot edit a testimony." }, 403);
  }
  const { id } = await context.params;
  const { data, error } = await getTestimony(supabase, id);
  if (error) return asError(error, "Couldn't load the testimony.");
  const row = data as TestimonyRow | null;
  if (!row || !visible(row, user.id, access)) {
    return json({ error: "not_found", message: "Testimony not found." }, 404);
  }
  if (!canEditTestimony(access, row, user.id)) {
    return json({ error: "forbidden", message: "This story is locked." }, 403);
  }

  const body = (await readBody(request)) as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") {
    return json({ error: "bad_request", message: "Nothing to update." }, 400);
  }
  if ("media" in body) {
    return json(
      { error: "bad_request", message: "Files are attached when the story is created." },
      400
    );
  }

  const merged = {
    title: row.title,
    body: row.body,
    occurred_on: row.occurred_on,
    location_label: row.location_label,
    people_reached: row.people_reached,
    decisions: row.decisions,
    outcome: row.outcome as TestimonyRow["outcome"],
    consent_to_share: row.consent_to_share,
    withheld_reason: row.withheld_reason,
    status: row.status,
    ...body,
  };
  const parsed = validateTestimonyWrite(merged as Partial<TestimonyWrite>, {
    mode: "create",
    canPublish: access.publish,
  });
  if (!parsed.ok) {
    return json({ error: "bad_request", message: "Check the story fields.", fields: parsed.errors }, 400);
  }

  const next = parsed.value;
  const patch: Record<string, unknown> = {};
  for (const key of [
    "title",
    "body",
    "occurred_on",
    "location_label",
    "people_reached",
    "decisions",
    "outcome",
    "consent_to_share",
    "withheld_reason",
  ] as const) {
    if (key in body) patch[key] = next[key];
  }

  if ("status" in body && next.status) {
    if (next.status === "published" && row.status !== "published") {
      const consent = publishNeedsConfirmation({
        consentToShare: next.consent_to_share,
        confirmConsent: body.confirm_consent,
      });
      if (consent) return json({ error: "bad_request", message: consent }, 400);
      patch.published_at = new Date().toISOString();
      patch.published_by = user.id;
    }
    patch.status = next.status;
    if (next.status !== "published" && next.status !== "withheld") {
      patch.withheld_reason = null;
    }
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: "bad_request", message: "Nothing to update." }, 400);
  }

  const updated = await updateTestimony(supabase, id, patch);
  if (updated.error) return asError(updated.error, "Couldn't update the testimony.");
  return json({ testimony: await presentOne(updated.data as TestimonyRow, access.publish) });
}

export async function DELETE(_request: Request, context: Ctx) {
  const guard = await guardEvangelism();
  if (isGuard(guard)) return guard.response;
  const { supabase, user, access } = guard;
  const { id } = await context.params;
  const { data, error } = await getTestimony(supabase, id);
  if (error) return asError(error, "Couldn't load the testimony.");
  const row = data as TestimonyRow | null;
  if (!row || !visible(row, user.id, access)) {
    return json({ error: "not_found", message: "Testimony not found." }, 404);
  }
  if (!canDeleteTestimony(access, row, user.id)) {
    return json({ error: "forbidden", message: "You cannot delete this story." }, 403);
  }

  const paths = (row.evangelism_media ?? []).map((item) => item.storage_path).filter(Boolean);
  if (paths.length > 0) {
    let admin;
    try {
      admin = createAdminClient();
    } catch {
      return notEnabled();
    }
    const { error: storageError } = await admin.storage.from(EVANGELISM_MEDIA_BUCKET).remove(paths);
    if (storageError && !isEvangelismNotReady(storageError)) {
      return asError(storageError, "Couldn't delete the testimony files.");
    }
  }

  const removed = await deleteTestimony(supabase, id);
  if (removed.error) return asError(removed.error, "Couldn't delete the testimony.");
  return json({ ok: true });
}
