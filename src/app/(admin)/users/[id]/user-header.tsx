import { AvatarUploader } from "@/components/avatar-uploader";
import { StatusPill, type Tone } from "@/components/ffsa";
import { SuperAdminBadge } from "@/components/super-admin-badge";
import {
  deriveUserLifecycle,
  type UserLifecycleInput,
  type UserLifecycleStage,
} from "@/lib/users/lifecycle";

/**
 * Identity header shared between the Profile and Permissions tabs.
 * The avatar is rendered via AvatarUploader so admins can change the
 * user's photo inline. The API enforces the actual permission check
 * (self or super_admin/admin), so it's safe to mount the uploader on
 * every admin viewer — non-admins viewing this page is already
 * blocked upstream in /users/[id]/page.tsx.
 */
export function UserHeader({
  user,
  eyebrow,
  authLastSignInAt,
  derivedTitle,
  isSuperAdmin = false,
}: {
  user: UserLifecycleInput & {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    preferred_name?: string | null;
    display_name?: string | null;
    email?: string | null;
    job_title?: string | null;
    avatar_url?: string | null;
  };
  eyebrow: string;
  /** Real sign-in time from Supabase Auth — the app's mirror column is unmaintained. */
  authLastSignInAt?: string | null;
  /** Title derived from role + department/ministry (falls back to job_title). */
  derivedTitle?: string | null;
  /** This account holds super_admin — flagged so nobody edits it unawares. */
  isSuperAdmin?: boolean;
}) {
  const name =
    user.display_name ??
    (user.first_name
      ? `${user.first_name} ${user.last_name ?? ""}`.trim()
      : user.email ?? "Unknown User");

  // Status is DERIVED (same logic as the Users list), not read from the raw
  // `status` column — which is inconsistent across users. A real Supabase Auth
  // sign-in counts as acceptance, so the page passes authLastSignInAt in (the
  // app's own last_sign_in_at column is unmaintained / null).
  const lifecycle = deriveUserLifecycle({
    ...user,
    last_sign_in_at: authLastSignInAt ?? user.last_sign_in_at ?? null,
  });
  // The stage tints here were dark-theme HSL values written inline — green
  // on a near-black ground. On the light system a stage is an outlined pill
  // in one of the four tones, same as every other status in the app.
  const STAGE_TONE: Record<UserLifecycleStage, Tone> = {
    active: "good",
    profile_incomplete: "warn",
    pending_approval: "warn",
    invited: "quiet",
    invite_scheduled: "quiet",
    inactive: "bad",
  };

  const title = derivedTitle ?? user.job_title ?? null;

  const avatarName =
    user.first_name ?? user.email ?? "?";

  return (
    <div className="flex items-start gap-4 border-b border-ink bg-white px-5 pb-4 pt-5 md:gap-5 md:px-8 md:pb-5 md:pt-6">
      <AvatarUploader
        userId={user.id}
        initialSrc={user.avatar_url}
        name={avatarName}
        size={72}
      />
      <div className="min-w-0 flex-1">
        <div className="masthead-context">{eyebrow}</div>
        <h1 className="masthead-title truncate">{name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[color:var(--text-secondary)]">
          <span className="truncate">{user.email ?? "—"}</span>
          {title && (
            <>
              <span className="opacity-40">·</span>
              <span>{title}</span>
            </>
          )}
          <StatusPill tone={STAGE_TONE[lifecycle.stage]}>
            {lifecycle.label}
          </StatusPill>
          {isSuperAdmin && <SuperAdminBadge />}
        </div>
      </div>
    </div>
  );
}
