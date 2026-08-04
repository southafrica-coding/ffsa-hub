import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getAllConsentRecords,
  getConsentAgreementsList,
} from "@/services/consent";
import { ConsentsTable, type ConsentRow } from "./consents-table";

export const dynamic = "force-dynamic";

// Legal / Compliance console — who signed which policy, across staff and
// public applicants. Gated to super_admin / admin / legal_admin via the
// "legal" module permission. Reads cross-user data with the service-role
// client (legal_admin isn't is_admin(), and RLS embedded joins would null
// out identity — we hydrate names ourselves).
export default async function ConsentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "legal"); // redirects if not allowed

  const admin = createAdminClient();

  const { data: recordRows } = await getAllConsentRecords(admin);
  const records = (recordRows ?? []) as Array<Record<string, unknown>>;

  const { data: agreementRows } = await getConsentAgreementsList(admin);
  const titleByVersion = new Map<string, string>();
  for (const a of (agreementRows ?? []) as Array<Record<string, unknown>>) {
    titleByVersion.set(String(a.version), String(a.title));
  }

  // Hydrate signer names for account-holders in one query.
  const userIds = Array.from(
    new Set(records.map((r) => r.user_id).filter(Boolean))
  ) as string[];
  const nameById = new Map<string, { name: string; email: string }>();
  if (userIds.length > 0) {
    const { data: users } = await admin
      .from("users")
      .select("id, first_name, last_name, email")
      .in("id", userIds);
    for (const u of (users ?? []) as Array<Record<string, unknown>>) {
      const name =
        [u.first_name, u.last_name].filter(Boolean).join(" ") ||
        String(u.email ?? "") ||
        String(u.id);
      nameById.set(String(u.id), { name, email: String(u.email ?? "") });
    }
  }

  const rows: ConsentRow[] = records.map((r) => {
    const uid = r.user_id ? String(r.user_id) : "";
    const identity = uid ? nameById.get(uid) : undefined;
    return {
      recordId: String(r.id),
      person: identity?.name ?? String(r.applicant_email ?? "Unknown"),
      email: identity?.email ?? String(r.applicant_email ?? ""),
      policyTitle: titleByVersion.get(String(r.agreement_version)) ?? "Agreement",
      version: String(r.agreement_version),
      source: String(r.source ?? ""),
      acceptedAt: String(r.accepted_at),
      ip: String(r.ip_address ?? ""),
    };
  });

  // By-policy summary (signature counts).
  const countByVersion = new Map<string, number>();
  for (const r of rows) {
    countByVersion.set(r.version, (countByVersion.get(r.version) ?? 0) + 1);
  }
  const versions = Array.from(titleByVersion.entries()).map(([version, title]) => ({
    version,
    title,
    count: countByVersion.get(version) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="page-eyebrow">LEGAL</p>
        <h1 className="page-title">Consent &amp; agreement records</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every policy acceptance on record — staff, students and public
          applicants. Open any record to view or print the exact document that
          was signed, or export the list as CSV.
        </p>
      </div>

      {versions.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {versions.map((v) => (
            <div key={v.version} className="rounded-xl border p-4">
              <p className="text-sm font-medium">{v.title}</p>
              <p className="text-xs text-muted-foreground font-mono">{v.version}</p>
              <p className="mt-2 text-2xl font-semibold">{v.count}</p>
              <p className="text-xs text-muted-foreground">signatures</p>
            </div>
          ))}
        </div>
      )}

      <ConsentsTable
        rows={rows}
        versions={versions.map((v) => ({ version: v.version, title: v.title }))}
      />
    </div>
  );
}
