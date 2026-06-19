import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getPrograms } from "@/services/schools";
import { ProgramsTable } from "./programs-table";
import { CreateProgramForm } from "./create-program-form";

export default async function SchoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const supabase = await createClient();
  // Middleware already validated; read session from cookie.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  const params = await searchParams;
  const statusFilter = params.status || "active";

  // Permission check + programs fetch are independent — run together.
  const [, programsResult] = await Promise.all([
    requireModuleAccess(supabase, user.id, "schools"),
    getPrograms(supabase, { status: statusFilter }),
  ]);
  const { data: programs, error } = programsResult;

  if (error) {
    console.error("getPrograms error:", JSON.stringify(error, null, 2));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="page-eyebrow">TRAINING &amp; EDUCATION</p>
          <h1 className="page-title">Training</h1>
        </div>
        <CreateProgramForm />
      </div>

      <ProgramsTable programs={programs ?? []} statusFilter={statusFilter} />
    </div>
  );
}
