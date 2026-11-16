// Data access for the event helper and the pick list. Both land as an
// equipment order in status `quote`: from the helper with no lines (the
// rental manager works out the gear), from the pick list with the chosen
// lines at store prices. A quote holds no units
// (spec rule 2), so it never blocks anyone else's booking. Takes an ADMIN
// client — the customer has no account, and anon can't write orders.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ── Quote requests ─────────────────────────────────────────

export async function insertQuoteRequest(
  admin: Client,
  data: {
    customer_name: string;
    customer_email: string;
    customer_phone: string | null;
    customer_org: string | null;
    starts_on: string;
    ends_on: string;
    notes: string;
    fulfilment?: "collect" | "delivery";
    delivery_address?: string | null;
  }
) {
  return admin
    .from("equipment_orders")
    .insert({ ...data, kind: "external", status: "quote" })
    .select("id, number")
    .single();
}

/** The picked gear, at store prices, for the manager to confirm. */
export async function insertQuoteLines(
  admin: Client,
  orderId: string,
  lines: { product_id: string; quantity: number; unit_price_cents: number; deposit_cents: number; line_total_cents: number }[]
) {
  return admin.from("equipment_order_lines").insert(lines.map((l) => ({ ...l, order_id: orderId })));
}

// ── Who hears about it ─────────────────────────────────────

/** Emails of everyone holding equipment.manage, directly or through a role. */
export async function getEquipmentManagerEmails(admin: Client): Promise<string[]> {
  const { data: perm } = await admin
    .from("permissions")
    .select("id")
    .eq("key", "equipment.manage")
    .maybeSingle();
  if (!perm) return [];

  const userIds = new Set<string>();
  const { data: direct } = await admin.from("user_permissions").select("user_id").eq("permission_id", perm.id);
  for (const row of direct ?? []) userIds.add(row.user_id as string);

  const { data: rolePerms } = await admin.from("role_permissions").select("role_id").eq("permission_id", perm.id);
  const roleIds = Array.from(new Set((rolePerms ?? []).map((r: { role_id: string }) => r.role_id)));
  if (roleIds.length > 0) {
    const { data: holders } = await admin.from("user_roles").select("user_id").in("role_id", roleIds);
    for (const row of holders ?? []) userIds.add(row.user_id as string);
  }
  if (userIds.size === 0) return [];

  const { data: users } = await admin.from("users").select("email").in("id", Array.from(userIds));
  const emails = new Set<string>();
  for (const u of users ?? []) {
    const e = (u.email as string | null)?.trim();
    if (e) emails.add(e);
  }
  return Array.from(emails);
}
