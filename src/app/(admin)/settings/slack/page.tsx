import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";
import { Masthead } from "@/components/ffsa";
import { SlackLinksTable, type SlackLinkRow } from "./slack-links-table";

// Coverage page for personal Slack notifications: who can be DM'd and
// who can't. Broadcasts silently skip unlinked people, so without this
// page a half-linked team looks identical to a fully linked one.

export default async function SlackLinksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await callerIsAdmin(supabase, user.id))) redirect("/dashboard");

  const admin = createAdminClient();
  // slack_linked_at / slack_link_source are new in migration 187 and
  // aren't in the generated types yet — cast per repo convention.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("users")
    .select(
      "id, first_name, last_name, email, slack_user_id, slack_linked_at, slack_link_source"
    )
    .neq("is_active", false)
    .order("first_name", { ascending: true });

  const rows: SlackLinkRow[] = (
    (data ?? []) as Array<Record<string, unknown>>
  ).map((u) => ({
    id: u.id as string,
    name:
      `${(u.first_name as string) ?? ""} ${(u.last_name as string) ?? ""}`.trim() ||
      ((u.email as string) ?? "Unknown"),
    email: (u.email as string) ?? null,
    slackUserId: (u.slack_user_id as string) ?? null,
    linkedAt: (u.slack_linked_at as string) ?? null,
    source: (u.slack_link_source as SlackLinkRow["source"]) ?? null,
  }));

  const linked = rows.filter((r) => r.slackUserId).length;

  return (
    <div className="ffsa-screen">
      <Masthead context="System" title="Slack notifications" />

      <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
        The Hub sends people direct messages in Slack rather than posting to a
        group channel. That only works for someone once their Hub account is
        linked to their Slack account &mdash; anyone unlinked below is silently
        skipped by every notification. Run the email match to link everyone
        whose Slack email is the same as their Hub email; the rest need to
        paste their member ID on their own profile, or have it set here.
      </p>

      <div className="px-5 py-6 md:px-8 md:py-7">
        <SlackLinksTable rows={rows} linkedCount={linked} />
      </div>
    </div>
  );
}
