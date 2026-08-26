"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import Link from "next/link";
import { FFSA_TAGLINE } from "@/lib/brand/ffsa";

// The tagline sets as a stacked poster headline on the black panel. Derived from
// the brand constant rather than retyped, so a wording change follows automatically.
const TAGLINE_LINES = FFSA_TAGLINE.split("·").map((part) => part.trim());

// Google's mark, inlined rather than fetched — Google's brand terms require the
// official four-colour "G" and this keeps it off the network.
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [googleLoading, setGoogleLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleGoogleSignIn() {
    setError(null);
    setGoogleLoading(true);

    // Google returns to the existing /auth/callback route, which exchanges the
    // code for a session. That session starts at aal1 like any other, so a
    // Google user with 2FA enabled still meets the challenge — signing in with
    // Google is not a way around the second factor.
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });

    if (oauthError) {
      setGoogleLoading(false);
      setError(
        "We couldn't start Google sign-in. Please try again, or use your email and password."
      );
    }
    // On success the browser leaves for Google — no state to reset.
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Soft client-side speed bump after repeated failures. It resets on reload,
    // so it can never lock anyone out — it just slows rapid retries. Supabase's
    // own server-side rate limits are the real backstop.
    if (cooldownUntil > Date.now()) {
      const secs = Math.ceil((cooldownUntil - Date.now()) / 1000);
      setError(`Too many attempts. Please wait ${secs}s and try again.`);
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Supabase returns a generic "Invalid login credentials" for both a wrong
      // password and an email that has no account yet. Applicants who haven't
      // been accepted fall into the latter case and get confused, so give them
      // a clearer, applicant-aware hint instead of the raw message.
      const isInvalidCreds = /invalid login credentials/i.test(error.message);
      setError(
        isInvalidCreds
          ? "We couldn't sign you in. If you've applied but haven't been accepted yet, you don't have an account here yet — you'll receive an email with setup instructions once your application is approved. Otherwise, check your email and password."
          : error.message
      );
      setLoading(false);
      const next = failCount + 1;
      setFailCount(next);
      // Best-effort: log the failed attempt for the admin security view.
      // Fire-and-forget and fail-open — never blocks or delays the user.
      fetch("/api/auth/login-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }).catch(() => {});
      if (next >= 5) setCooldownUntil(Date.now() + 30000);
      return;
    }

    setFailCount(0);

    // A correct password is only half of it. If this account carries a verified
    // authenticator, Supabase leaves the session at aal1 and reports that aal2
    // is owed — hand off to the challenge instead of the app. (Middleware
    // enforces the same thing server-side; this just keeps the hand-off smooth.)
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2") {
      router.push("/login/2fa");
      router.refresh();
      return;
    }

    const { data: userRoles } = await supabase
      .from("user_roles")
      .select("roles(name)")
      .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "");

    const adminRoles = ["super_admin", "admin", "events_admin", "program_leader", "team_leader", "staff", "finance_admin", "comms_admin", "mission_leader"];
    const roles = (userRoles ?? []).flatMap((ur: any) =>
      Array.isArray(ur.roles) ? ur.roles.map((r: any) => r.name) : ur.roles ? [ur.roles.name] : []
    );
    const isAdmin = roles.some((r: string) => adminRoles.includes(r));

    router.push(isAdmin ? "/dashboard" : "/profile");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-white">
      {/* Left panel — the photo-login slot. No hub photography ships in public/
          yet (public/brand holds logos only, and the FFX/event assets are
          off-limits here), so it stands as a solid black poster panel. When a
          photograph is supplied, drop it in as a fill <Image> behind this
          content with a 55% black scrim; the wordmark and headline sit on top
          unchanged. Hidden below lg so the form never falls below the fold. */}
      <div className="relative hidden flex-col justify-between bg-ink p-12 lg:flex lg:w-[46%] xl:w-1/2">
        <Image
          src="/brand/ff-wordmark-white.png"
          alt="Fire & Fragrance"
          width={220}
          height={26}
          style={{ objectFit: "contain" }}
          priority
        />

        <div>
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-[#9A9689]">
            South Africa · Hub
          </div>
          <p className="mt-5 font-display text-[clamp(2.75rem,4.2vw,4.25rem)] font-black uppercase leading-[0.9] tracking-[-0.01em] text-white">
            {TAGLINE_LINES.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
        </div>
      </div>

      {/* Right column — the form. Flat: no card, no border, no shadow. */}
      <div className="flex w-full flex-col justify-center px-6 py-14 sm:px-10 lg:w-[54%] lg:px-16 xl:w-1/2 xl:px-24">
        <div className="w-full max-w-[400px] animate-fade-up">
          {/* The black panel is hidden on phones, so the wordmark rides here instead. */}
          <Image
            src="/brand/ff-wordmark-black.png"
            alt="Fire & Fragrance"
            width={168}
            height={20}
            style={{ objectFit: "contain" }}
            className="mb-10 lg:hidden"
            priority
          />

          {/* The screen's only yellow: the masthead tick rule. */}
          <div className="masthead-context">Sign in to your account</div>
          <h1 className="page-title">Sign in</h1>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading || loading}
            className="mt-9 flex h-12 w-full items-center justify-center gap-3 border border-rule bg-white text-[13px] font-semibold text-ink transition-colors hover:bg-bone disabled:opacity-60"
          >
            <GoogleMark />
            {googleLoading ? "Redirecting..." : "Continue with Google"}
          </button>

          {/* Rule-with-label divider, in the masthead's mono voice. */}
          <div className="mt-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-rule" />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-[color:var(--text-tertiary)]">
              Or with email
            </span>
            <div className="h-px flex-1 bg-rule" />
          </div>

          <form onSubmit={handleLogin} className="mt-7 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="h-12"
              />
            </div>

            {/* The applicant-aware message runs long — it reads as body copy on a
                bone block, not as a one-line field error. */}
            {error && (
              <p
                role="alert"
                className="border-l-2 border-destructive bg-bone px-4 py-3 text-[13px] leading-relaxed text-[color:var(--text-secondary)]"
              >
                {error}
              </p>
            )}

            <Button type="submit" className="h-12 w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="mt-8 flex items-center justify-between gap-4 border-t border-rule pt-5">
            <Link
              href="/forgot-password"
              className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-secondary)] hover:text-ink"
            >
              Forgot your password?
            </Link>
            {/* On phones the black panel is gone, so the tagline anchors here. */}
            <span className="mono-label hidden text-right sm:block lg:hidden">
              {FFSA_TAGLINE}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
