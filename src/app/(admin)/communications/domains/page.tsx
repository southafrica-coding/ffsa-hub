import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { canManageComms } from "@/lib/api-auth";
import { Masthead } from "@/components/ffsa";
import { DomainsAdmin } from "./domains-admin";

export const dynamic = "force-dynamic";

// Communications → Sending domains (migration 243): add a domain, paste the
// DNS records Resend asks for, check them — then it can be used as a "From"
// address on events and identities.
export default async function SendingDomainsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "communications");
  const canEdit = await canManageComms(supabase, user.id);

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Communications"
        title="Sending domains"
        actions={
          <Link
            href="/communications/identities"
            className="inline-block border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
          >
            Identities &rarr;
          </Link>
        }
      />
      <div className="px-5 py-6 md:px-8 md:py-7">
        <p className="mb-5 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
          The domains the Hub can send email from. Add one, paste the records below into that domain&rsquo;s DNS (where
          it&rsquo;s registered — e.g. Wix, GoDaddy, Cloudflare), then check it. Once it&rsquo;s verified it shows up
          as a &ldquo;From&rdquo; option on every event&rsquo;s Emails tab. Replies always come back through the
          Hub&rsquo;s own ffsahub.com inboxes, so a new domain only needs to send.
        </p>
        {canEdit ? (
          <DomainsAdmin />
        ) : (
          <p className="text-sm text-muted-foreground">You need Communications manage access to add or check domains.</p>
        )}
      </div>
    </div>
  );
}
