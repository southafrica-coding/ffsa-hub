// Records Library authorization — the one carve-out from the blanket
// super_admin/admin bypass.
//
// The `admin` role ("general admin") matches super_admin everywhere else, but
// the Records Library holds the historical CSV imports of staff/student
// personal data, so it takes:
//
//   super_admin, OR the `records_library.manage` permission — granted directly
//   or through an assigned job title's bundle.
//
// Mirrors public.can_access_records_library() in migration 212 and
// SUPER_ADMIN_ONLY_MODULES in src/config/modules.ts.

import { callerIsSuperAdmin, getEffectivePermissionKeys } from "./check-role-grant";

const RECORDS_LIBRARY_KEY = "records_library.manage";

type Client = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export async function canAccessRecordsLibrary(
  supabase: Client,
  userId: string
): Promise<boolean> {
  if (await callerIsSuperAdmin(supabase, userId)) return true;
  const keys = await getEffectivePermissionKeys(supabase, userId);
  return keys.has(RECORDS_LIBRARY_KEY);
}
