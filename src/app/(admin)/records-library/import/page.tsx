import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { listTemplates } from "@/services/records-library";
import { ImportForm } from "./import-form";
import { Masthead } from "@/components/ffsa";

export default async function RecordsLibraryImportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "records-library");

  const templatesRes = await listTemplates(supabase);
  const templates = templatesRes.data ?? [];

  return (
    <div className="ffsa-screen">
      <Masthead context="Records library" title="Upload to Records Library" />
      <div className="space-y-6 px-5 py-6 md:px-8">
      <div>
        <p className="text-sm text-gray-600 max-w-3xl">
          Upload a CSV, tell us what kind of record it represents, and map its
          columns to the core fields we track. Anything you don&apos;t map is
          preserved in each row&apos;s raw payload so nothing is lost.
        </p>
      </div>
      <ImportForm templates={templates} />
      </div>
    </div>
  );
}
