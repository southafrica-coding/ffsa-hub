import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getPossibleDuplicates } from "@/services/possible-duplicates";
import { ContactsTabsNav } from "../contacts-tabs-nav";
import { DuplicatesList } from "./duplicates-list";
import { Masthead, SectionBar } from "@/components/ffsa";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "contacts");

  // Service-role client: the scan reads across all contacts + identifiers.
  const admin = createAdminClient();
  const clusters = await getPossibleDuplicates(admin);

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`People & relationships \u00b7 ${clusters.length} possible duplicate${clusters.length === 1 ? "" : "s"}`}
        title="Contacts"
      />

      <ContactsTabsNav followupPendingCount={null} />

      <SectionBar title="Possible duplicates" meta={`${clusters.length} groups`} />
      <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
        Separate contacts that look like the same person — grouped when they
        share a name or a phone number across different emails. Pick which
        record to keep and merge the rest into it; all emails, phones, labels,
        activity, form submissions and workflow history move to the contact you
        keep.
      </p>

      <div className="px-5 py-6 md:px-8 md:py-7">
        <DuplicatesList clusters={clusters} />
      </div>
    </div>
  );
}
