// Server-side assembly for hub feedback: turns raw rows into the shapes in
// ./types, resolving names with the service-role client. Never import from
// a 'use client' file.

import {
  HUB_FEEDBACK_BUCKET,
  getHubFeedbackById,
  getHubFeedbackComments,
  getHubFeedbackDuplicates,
  getHubFeedbackEvents,
  getHubFeedbackFiles,
  getHubFeedbackPeople,
  type HubFeedbackRow,
} from "@/services/hub-feedback";
import type { FeedbackDetail, FeedbackListItem } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function toListItems(
  supabase: Client,
  admin: Client,
  rows: HubFeedbackRow[],
  opts: { countDuplicates: boolean }
): Promise<FeedbackListItem[]> {
  const dupCounts = new Map<string, number>();
  if (opts.countDuplicates) {
    const open = rows.filter((r) => r.status !== "duplicate").map((r) => r.id);
    // Chunked: .in() with hundreds of uuids makes a very long URL.
    for (let i = 0; i < open.length; i += 150) {
      const { data } = await getHubFeedbackDuplicates(supabase, open.slice(i, i + 150));
      for (const d of (data ?? []) as { duplicate_of: string }[]) {
        dupCounts.set(d.duplicate_of, (dupCounts.get(d.duplicate_of) ?? 0) + 1);
      }
    }
  }
  const names = await getHubFeedbackPeople(
    admin,
    rows.flatMap((r) => [r.submitted_by, r.assigned_to])
  );
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    kind: r.kind,
    title: r.title,
    severity: r.severity,
    status: r.status,
    status_note: r.status_note,
    status_changed_at: r.status_changed_at,
    module_id: r.module_id,
    module_label: r.module_label,
    source: r.source,
    submitted_by: r.submitted_by,
    submitter_name: names[r.submitted_by] ?? "Someone",
    assigned_to: r.assigned_to,
    assignee_name: r.assigned_to ? names[r.assigned_to] ?? "Someone" : null,
    duplicate_of: r.duplicate_of,
    duplicate_count: dupCounts.get(r.id) ?? 0,
    created_at: r.created_at,
  }));
}

/**
 * One item with its thread, history and screenshots, as the viewer may see
 * it. Returns null when the viewer can't read the item (RLS hides it).
 */
export async function loadFeedbackDetail(
  supabase: Client,
  admin: Client,
  id: string,
  viewer: { userId: string; canView: boolean; canTriage: boolean }
): Promise<FeedbackDetail | null> {
  const { data: row } = await getHubFeedbackById(supabase, id);
  if (!row) return null;
  const item = row as HubFeedbackRow;

  const [comments, events, files, dups] = await Promise.all([
    getHubFeedbackComments(supabase, id),
    getHubFeedbackEvents(supabase, id),
    getHubFeedbackFiles(supabase, id),
    viewer.canView ? getHubFeedbackDuplicates(supabase, [id]) : Promise.resolve({ data: [] }),
  ]);

  // The submitter can't read the item theirs was merged into, so fetch just
  // its ref / title / status with the service-role client.
  let mergedInto: FeedbackDetail["merged_into"] = null;
  if (item.duplicate_of) {
    const { data: target } = await admin
      .from("hub_feedback")
      .select("id, ref, title, status")
      .eq("id", item.duplicate_of)
      .maybeSingle();
    if (target) mergedInto = target;
  }

  const commentRows = (comments.data ?? []) as {
    id: string; author_id: string; visibility: "team" | "submitter"; body: string; created_at: string;
  }[];
  const eventRows = (events.data ?? []) as {
    id: string; actor_id: string | null; kind: string; from_status: string | null;
    to_status: string | null; note: string | null; created_at: string;
  }[];
  const dupRows = (dups.data ?? []) as { id: string; ref: number; title: string; submitted_by: string; created_at: string }[];

  const names = await getHubFeedbackPeople(admin, [
    item.submitted_by,
    item.assigned_to,
    ...commentRows.map((c) => c.author_id),
    ...eventRows.map((e) => e.actor_id),
    // 'assigned' events carry the new assignee's id in note.
    ...eventRows.filter((e) => e.kind === "assigned").map((e) => e.note),
    ...dupRows.map((d) => d.submitted_by),
  ]);

  const signed = await Promise.all(
    ((files.data ?? []) as { id: string; file_path: string; file_name: string | null; content_type: string | null }[]).map(
      async (f) => {
        const { data } = await admin.storage.from(HUB_FEEDBACK_BUCKET).createSignedUrl(f.file_path, 60 * 60);
        return { id: f.id, file_name: f.file_name, content_type: f.content_type, url: data?.signedUrl ?? null };
      }
    )
  );

  const [listItem] = await toListItems(supabase, admin, [item], { countDuplicates: false });

  return {
    item: {
      ...listItem,
      duplicate_count: dupRows.length,
      details: item.details,
      page_path: item.page_path,
      user_agent: item.user_agent,
      viewport: item.viewport,
    },
    merged_into: mergedInto,
    duplicates: dupRows.map((d) => ({
      id: d.id,
      ref: d.ref,
      title: d.title,
      submitter_name: names[d.submitted_by] ?? "Someone",
      created_at: d.created_at,
    })),
    comments: commentRows.map((c) => ({
      id: c.id,
      author_name: names[c.author_id] ?? "Someone",
      mine: c.author_id === viewer.userId,
      visibility: c.visibility,
      body: c.body,
      created_at: c.created_at,
    })),
    events: eventRows.map((e) => ({
      id: e.id,
      // Answering "needs info" is written by the service role (no actor);
      // it's always the sender.
      actor_name: e.actor_id
        ? names[e.actor_id] ?? null
        : e.kind === "status" && e.from_status === "needs_info" && e.to_status === "new"
          ? names[item.submitted_by] ?? null
          : null,
      kind: e.kind,
      from_status: e.from_status,
      to_status: e.to_status,
      note: e.kind === "assigned" ? (e.note ? names[e.note] ?? "someone" : null) : e.note,
      created_at: e.created_at,
    })),
    files: signed,
    can_triage: viewer.canTriage,
    is_team: viewer.canView,
  };
}
