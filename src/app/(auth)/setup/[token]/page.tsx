import Link from "next/link";
import Image from "next/image";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateOnboardingInvite } from "@/lib/auth/onboarding-invite";
import { SetupForm } from "./setup-form";

// Public account-setup page reached from the 30-day onboarding link
// (/setup/<token>, migration 158). Server component: validates the token
// with the service-role client, then renders the set-password form or a
// friendly reason it can't be used. No session required.
export default async function SetupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();

  const result = await validateOnboardingInvite(admin, token);

  if (!result.ok) {
    const copy =
      result.reason === "expired"
        ? {
            heading: "Link expired",
            body: "This account-setup link has expired. Ask a Fire & Fragrance admin to resend your invite and you'll get a fresh one.",
          }
        : result.reason === "used"
        ? {
            heading: "Already set up",
            body: "This link has already been used to set up an account. Head to the login page and sign in.",
          }
        : {
            heading: "Invalid link",
            body: "We couldn't find this account-setup link. Ask a Fire & Fragrance admin to resend your invite.",
          };
    return <SetupShell heading={copy.heading} body={copy.body} showLogin />;
  }

  // Already onboarded (password set + profile finished) — send them to log in.
  const { data: appUser } = await admin
    .from("users")
    .select("first_name, accepted_at")
    .eq("id", result.invite.user_id)
    .maybeSingle();

  const typedUser = appUser as
    | { first_name: string | null; accepted_at: string | null }
    | null;

  if (typedUser?.accepted_at) {
    return (
      <SetupShell
        heading="Already set up"
        body="Your account is already active. Head to the login page and sign in."
        showLogin
      />
    );
  }

  return (
    <SetupForm
      token={token}
      email={result.invite.email}
      firstName={typedUser?.first_name ?? null}
    />
  );
}

// Minimal branded shell for the terminal states (expired / used / invalid).
// The interactive success path lives in <SetupForm/>.
function SetupShell({
  heading,
  body,
  showLogin,
}: {
  heading: string;
  body: string;
  showLogin?: boolean;
}) {
  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12 overflow-hidden"
      style={{ background: "#0D0B09" }}
    >
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: "2px",
          background:
            "linear-gradient(90deg, transparent, hsl(42 95% 55%), transparent)",
        }}
      />
      <div className="relative mb-10 text-center">
        <Image
          src="/brand/ff-wordmark-white.png"
          alt="Fire & Fragrance"
          width={260}
          height={31}
          style={{ objectFit: "contain", margin: "0 auto", display: "block" }}
          priority
        />
      </div>
      <div
        className="relative w-full max-w-md text-center"
        style={{
          background: "hsl(22 10% 8%)",
          border: "1px solid hsl(22 8% 15%)",
          borderRadius: "14px",
          padding: "2.25rem",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
            fontSize: "2rem",
            letterSpacing: "0.04em",
            color: "#F0EBE3",
            marginBottom: "0.75rem",
          }}
        >
          {heading}
        </h1>
        <p style={{ fontSize: "13px", color: "hsl(30 8% 55%)", lineHeight: 1.6 }}>
          {body}
        </p>
        {showLogin && (
          <div className="mt-6">
            <Link
              href="/login"
              style={{
                color: "hsl(42 95% 55%)",
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "13px",
              }}
            >
              Go to login →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
