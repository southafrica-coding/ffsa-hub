import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { listCycles } from "@/services/okrs";
import { callerCanManageCycles } from "@/lib/auth/check-okr-access";
import { Masthead } from "@/components/ffsa";
import type { OkrCycle } from "@/types/okrs";
import { CyclesManager } from "./cycles-manager";

export default async function OkrCyclesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The OKRs module itself is open to everyone; running cycles is not.
  if (!(await callerCanManageCycles(supabase, user.id))) redirect("/okrs");

  const { data } = await listCycles(supabase);

  return (
    <div className="ffsa-screen">
      <Masthead context="Strategy · OKRs" title="Cycles" />
      <div className="px-5 py-6 md:px-8 md:py-7">
        <p className="mb-5 text-[13px] text-[color:var(--text-secondary)]">
          <Link href="/okrs" className="underline hover:no-underline">
            Back to OKRs
          </Link>{" "}
          · One cycle is current at a time. Closing a cycle leaves it readable but locks its
          objectives, so last year&rsquo;s record cannot be quietly rewritten.
        </p>
        <CyclesManager cycles={(data ?? []) as OkrCycle[]} />
      </div>
    </div>
  );
}
