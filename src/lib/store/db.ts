// The service-role client, untyped for the Store's tables. Migration 412
// isn't in the generated src/types/database.ts yet (it isn't applied), so
// typed .from("store_…") calls don't compile. Drop this once types are
// regenerated after 412 is applied. Server-only, like createAdminClient.
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StoreClient = any;

export function storeAdminClient(): StoreClient {
  return createAdminClient() as StoreClient;
}
