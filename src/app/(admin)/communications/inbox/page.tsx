import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { listAllSendingIdentities } from "@/services/sending-identities";
import { listInboundEmails, type InboundEmail } from "@/services/inbound-emails";
import { Masthead } from "@/components/ffsa";
import { InboxView } from "./inbox-view";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "communications");

  const { open } = await searchParams;
  const [{ data: emails }, { data: identities }] = await Promise.all([
    listInboundEmails(supabase, { limit: 300 }),
    listAllSendingIdentities(supabase),
  ]);

  return (
    <div className="ffsa-screen">
      <Masthead context="Communications" title="Inbox" />
      <div className="px-5 py-6 md:px-8 md:py-7">
        <p className="mb-5 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
          Replies to every email the Hub sends land here, sorted to the team
          they were sent to. Each one is also forwarded to that team&rsquo;s
          inboxes (set on{" "}
          <Link href="/communications/identities" className="underline">
            Identities
          </Link>
          ), where pressing Reply answers the person directly.
        </p>
        <InboxView
          emails={(emails ?? []) as InboundEmail[]}
          identities={((identities ?? []) as { id: string; display_name: string }[]).map(
            (i) => ({ id: i.id, display_name: i.display_name })
          )}
          initialOpenId={open ?? null}
        />
      </div>
    </div>
  );
}
