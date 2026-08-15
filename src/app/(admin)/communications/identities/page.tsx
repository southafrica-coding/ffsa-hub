import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  listAllSendingIdentities,
  type SendingIdentity,
} from "@/services/sending-identities";
import { Masthead } from "@/components/ffsa";
import { IdentitiesAdmin } from "./identities-admin";

export const dynamic = "force-dynamic";

export default async function IdentitiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "communications");

  const { data } = await listAllSendingIdentities(supabase);
  const identities = (data ?? []) as SendingIdentity[];

  return (
    <div className="ffsa-screen">
      <Masthead context="Communications" title="Sending identities" />

      <div className="px-5 py-6 md:px-8 md:py-7">
        <p className="mb-5 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
          The &ldquo;From&rdquo; addresses your campaigns can send through.
          Add one per work stream (events, giving, training, etc.) so each
          email feels like it&rsquo;s coming from the right voice.
        </p>

        <IdentitiesAdmin initialIdentities={identities} />
      </div>
    </div>
  );
}
