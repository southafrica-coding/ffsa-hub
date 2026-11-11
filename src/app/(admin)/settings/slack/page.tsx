import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";
import { Masthead } from "@/components/ffsa";
import { getAwaitingArrivalByUser } from "@/lib/schools/awaiting-arrival";
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
  if (!(await callerIsAdmin(supabase, user.id))) redirect("/home");

  const admin = createAdminClient();
  // slack_linked_at / slack_link_source are new in migration 187 and
  // aren't in the generated types yet — cast per repo convention.
  const [{ data }, awaitingArrival] = await Promise.all([
    (admin as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .from("users")
      .select(
        "id, first_name, last_name, email, slack_user_id, slack_linked_at, slack_link_source, setup_invite_due_on, user_roles!user_roles_user_id_fkey(roles(name))"
      )
      .neq("is_active", false)
      .order("first_name", { ascending: true }),
    getAwaitingArrivalByUser(admin),
  ]);

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
    isStaff: hasStaffRole(u.user_roles),
    awaitingArrival: awaitingArrival[u.id as string] ?? null,
    setupInviteDueOn: (u.setup_invite_due_on as string) ?? null,
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
        Students who haven&rsquo;t arrived yet are marked &ldquo;skip for
        now&rdquo; &mdash; link them once they&rsquo;re on base.
      </p>

      <div className="px-5 py-6 md:px-8 md:py-7">
        <SlackLinksTable rows={rows} linkedCount={linked} />
      </div>
    </div>
  );
}

// Anything beyond the membership roles (student / community / self-service)
// counts as staff here — the same "not student" test used elsewhere, since
// signup_type can't be trusted for it.
const MEMBERSHIP_ROLES = new Set(["student", "community_member", "self_service"]);

function hasStaffRole(userRoles: unknown): boolean {
  return ((userRoles ?? []) as Array<{ roles: { name?: string } | { name?: string }[] | null }>)
    .some((ur) => {
      const role = Array.isArray(ur.roles) ? ur.roles[0] : ur.roles;
      return !!role?.name && !MEMBERSHIP_ROLES.has(role.name);
    });
}
