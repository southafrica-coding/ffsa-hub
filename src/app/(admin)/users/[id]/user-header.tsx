import { AvatarUploader } from "@/components/avatar-uploader";
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
  const stageColors: Record<UserLifecycleStage, { bg: string; fg: string }> = {
    active: { bg: "hsl(142 60% 20%)", fg: "hsl(142 60% 55%)" },
    profile_incomplete: { bg: "hsl(28 70% 16%)", fg: "hsl(32 90% 60%)" },
    pending_approval: { bg: "hsl(42 80% 18%)", fg: "#0A0A0A" },
    invited: { bg: "hsl(22 8% 15%)", fg: "#7C786C" },
    inactive: { bg: "hsl(0 45% 16%)", fg: "hsl(0 70% 62%)" },
  };
  const s = stageColors[lifecycle.stage];

  const title = derivedTitle ?? user.job_title ?? null;

  const avatarName =
    user.first_name ?? user.email ?? "?";

  return (
    <div className="flex items-start gap-5">
      <AvatarUploader
        userId={user.id}
        initialSrc={user.avatar_url}
        name={avatarName}
        size={72}
      />
      <div className="flex-1 min-w-0">
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="page-title truncate">{name}</h1>
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-sm text-muted-foreground">
          <span className="truncate">{user.email ?? "—"}</span>
          {title && (
            <>
              <span className="opacity-50">·</span>
              <span>{title}</span>
            </>
          )}
          <span className="opacity-50">·</span>
          <span
            style={{
              fontSize: "10px",
              letterSpacing: "0.1em",
              fontWeight: 700,
              textTransform: "uppercase",
              padding: "2px 7px",
              borderRadius: 0,
              background: s.bg,
              color: s.fg,
            }}
          >
            {lifecycle.label}
          </span>
        </div>
      </div>
    </div>
  );
}
