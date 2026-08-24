import { createAdminClient } from "@/lib/supabase/admin";

// Read-only view of a user's family record for admins.
//
// Family data was previously invisible in the admin UI even though the RLS
// from migration 153 always allowed admins to read it. It is worth surfacing
// now because households are shared (migration 181): this panel is how an
// admin sees who a person's records belong to, and it is the tool for
// resolving a `household_link_ambiguous` audit entry — where two households
// claimed the same spouse email and the Hub refused to guess.
//
// Read with the admin client and project the fields we need. Do NOT embed
// users(...) into the household_members query: the users-table RLS nulls
// embedded joins.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const RELATIONSHIP_LABEL: Record<string, string> = {
  spouse: "Spouse",
  child: "Child",
  dependent: "Dependent",
};

export async function AdminHouseholdPanel({ userId }: { userId: string }) {
  const admin = createAdminClient() as Client;

  const { data: userRow } = await admin
    .from("users")
    .select("household_id, household_linked_at")
    .eq("id", userId)
    .maybeSingle();

  const householdId = userRow?.household_id ?? null;
  if (!householdId) return null;

  const [{ data: members }, { data: householdRow }, { data: others }] =
    await Promise.all([
      admin
        .from("household_members")
        .select(
          "id, relationship, full_name, email, date_of_birth, linked_user_id"
        )
        .eq("household_id", householdId)
        .order("relationship", { ascending: true })
        .order("full_name", { ascending: true }),
      admin
        .from("households")
        .select("has_children")
        .eq("id", householdId)
        .maybeSingle(),
      // Other Hub accounts in this household (i.e. the linked spouse).
      admin
        .from("users")
        .select("id, first_name, last_name, email")
        .eq("household_id", householdId)
        .neq("id", userId),
    ]);

  const memberRows = (members ?? []) as Array<Record<string, unknown>>;
  const otherAccounts = (others ?? []) as Array<Record<string, unknown>>;
  const hasChildren = (householdRow?.has_children ?? null) as boolean | null;

  if (memberRows.length === 0 && otherAccounts.length === 0) return null;

  return (
    <section className="rounded-xl border p-4 space-y-3">
      <div>
        <p className="page-eyebrow">HOUSEHOLD</p>
        <h2 className="text-xl font-semibold">Family record</h2>
        <p className="text-sm text-muted-foreground">
          {otherAccounts.length > 0
            ? "Shared with another Hub account — both people see and edit these records."
            : "Only this account has access to these records."}
          {hasChildren === false && " Declared no children."}
        </p>
      </div>

      {otherAccounts.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Shared with</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {otherAccounts.map((u) => (
              <li key={String(u.id)}>
                {[u.first_name, u.last_name].filter(Boolean).join(" ") ||
                  String(u.email ?? "Unknown")}{" "}
                <span className="text-xs">({String(u.email ?? "")})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {memberRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-4 font-medium">Member</th>
                <th className="py-1 pr-4 font-medium">Relationship</th>
                <th className="py-1 pr-4 font-medium">Date of birth</th>
                <th className="py-1 font-medium">Email</th>
              </tr>
            </thead>
            <tbody>
              {memberRows.map((m) => (
                <tr key={String(m.id)} className="border-t">
                  <td className="py-1.5 pr-4">
                    {String(m.full_name ?? "—")}
                    {m.linked_user_id ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        has a Hub account
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-4">
                    {RELATIONSHIP_LABEL[String(m.relationship)] ??
                      String(m.relationship)}
                  </td>
                  <td className="py-1.5 pr-4">
                    {m.date_of_birth ? String(m.date_of_birth).slice(0, 10) : "—"}
                  </td>
                  <td className="py-1.5">{String(m.email ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
