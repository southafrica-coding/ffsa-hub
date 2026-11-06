import { createAdminClient } from "@/lib/supabase/admin";
import {
  EVANGELISM_MEDIA_BUCKET,
  EVANGELISM_MEDIA_READ_TTL_SECONDS,
} from "./contract";
import type { TestimonyRow } from "./present";
import { displayName } from "./present";
import { authorNames } from "@/services/evangelism";
import { isEvangelismNotReady } from "./schema-error";

export async function signTestimonyMedia(rows: TestimonyRow[]): Promise<Map<string, string | null>> {
  const paths = rows.flatMap((row) => (row.evangelism_media ?? []).map((item) => item.storage_path));
  const urls = new Map<string, string | null>();
  if (paths.length === 0) return urls;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    for (const path of paths) urls.set(path, null);
    return urls;
  }
  const { data, error } = await admin.storage
    .from(EVANGELISM_MEDIA_BUCKET)
    .createSignedUrls(paths, EVANGELISM_MEDIA_READ_TTL_SECONDS);
  if (error || !data) {
    if (!isEvangelismNotReady(error)) {
      console.error("[evangelism] could not sign media", error?.message ?? "");
    }
    for (const path of paths) urls.set(path, null);
    return urls;
  }
  for (const item of data) {
    if (item.path) urls.set(item.path, item.error ? null : item.signedUrl);
  }
  return urls;
}

export async function loadAuthorNames(
  ids: string[]
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return names;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return names;
  }
  const { data, error } = await authorNames(admin, unique);
  if (error || !data) return names;
  for (const user of data as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
  }>) {
    names.set(user.id, displayName(user));
  }
  return names;
}
