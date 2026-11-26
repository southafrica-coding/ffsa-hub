import { redirect } from "next/navigation";
import { Masthead, MastheadAction } from "@/components/ffsa";
import { getSettings } from "@/services/operations";
import { opsContext } from "../context";
import { SettingsForm } from "../ops-forms";

export const dynamic = "force-dynamic";

export default async function OpsSettingsPage() {
  const { supabase, isAdmin } = await opsContext({ teamOnly: true });
  if (!isAdmin) redirect("/operations");
  const { data } = await getSettings(supabase);

  return (
    <div className="ffsa-screen">
      <Masthead context="Operations" title="Slack settings" actions={<MastheadAction href="/operations">Back</MastheadAction>} />
      <div className="px-5 py-6 md:px-8">
        <p className="mb-6 max-w-2xl text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
          The Hub&apos;s Slack bot (FFSA Hub Activity) must be <strong className="text-ink">added to each channel</strong> below
          — in Slack, open the channel, then Integrations → Add apps. To read the private maintenance form channel it also
          needs the <code>groups:history</code> scope. A channel id is at the bottom of the channel&apos;s About tab.
        </p>
        <SettingsForm
          initial={{
            maintenance_intake_channel: data?.maintenance_intake_channel ?? null,
            ops_channel: data?.ops_channel ?? null,
            area_channels: (data?.area_channels ?? {}) as Record<string, string>,
          }}
        />
      </div>
    </div>
  );
}
