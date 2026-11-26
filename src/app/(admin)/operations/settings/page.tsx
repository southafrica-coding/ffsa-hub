import { redirect } from "next/navigation";
import { Masthead, MastheadAction, SectionBar } from "@/components/ffsa";
import { DEFAULT_NOTICE, hoursFrom } from "@/lib/operations/maintenance";
import { getSettings } from "@/services/operations";
import { opsContext } from "../context";
import { MaintenanceSlackButtons, SettingsForm } from "../ops-forms";

export const dynamic = "force-dynamic";

type UserRow = {
  id: string;
  display_name: string | null;
  person: { first_name?: string; last_name?: string } | { first_name?: string; last_name?: string }[] | null;
};

export default async function OpsSettingsPage() {
  const { supabase, isAdmin } = await opsContext({ teamOnly: true });
  if (!isAdmin) redirect("/operations");
  const [{ data }, { data: users }] = await Promise.all([
    getSettings(supabase),
    supabase
      .from("users")
      .select("id, display_name, person:people(first_name, last_name)")
      .not("slack_user_id", "is", null)
      .eq("is_active", true),
  ]);
  const slackPeople = ((users ?? []) as UserRow[])
    .map((u) => {
      const p = Array.isArray(u.person) ? u.person[0] : u.person;
      return { id: u.id, name: u.display_name || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unnamed" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="ffsa-screen">
      <Masthead context="Operations" title="Slack settings" actions={<MastheadAction href="/operations">Back</MastheadAction>} />
      <div className="px-5 py-6 md:px-8">
        <p className="mb-6 max-w-2xl text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
          The Hub&apos;s Slack bot (FFSA Hub Activity) must be <strong className="text-ink">added to each channel</strong> below
          — in Slack, open the channel, then Integrations → Add apps. To read the private maintenance channel it needs the{" "}
          <code>groups:history</code> scope, and for request photos <code>files:read</code> and <code>files:write</code>. A channel
          id is at the bottom of the channel&apos;s About tab.
        </p>
        <SettingsForm
          initial={{
            maintenance_intake_channel: data?.maintenance_intake_channel ?? null,
            ops_channel: data?.ops_channel ?? null,
            area_channels: (data?.area_channels ?? {}) as Record<string, string>,
          }}
          maintenance={{
            button_channel: data?.maintenance_button_channel ?? "",
            followup_channel: data?.maintenance_followup_channel ?? "",
            status_user_ids: (data?.maintenance_status_user_ids ?? []) as string[],
            rules: data?.maintenance_rules ?? "",
            hours_notice: data?.maintenance_hours_notice ?? DEFAULT_NOTICE,
            hours: hoursFrom(data?.maintenance_hours),
          }}
          slackPeople={slackPeople}
        />
      </div>
      <SectionBar title="Maintenance in Slack" />
      <div className="px-5 py-6 md:px-8">
        <p className="mb-4 max-w-2xl text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
          Save the channels first. Post the request button once, then pin it in Slack. When it works, unpublish the old
          Maintenance Request workflow in Slack so people only use the new one.
        </p>
        <MaintenanceSlackButtons />
      </div>
    </div>
  );
}
