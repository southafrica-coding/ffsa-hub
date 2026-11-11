"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { Logo } from "@/components/ffsa/logo";
import { FFSA_TAGLINE } from "@/lib/brand/ffsa";
import { loginDestination } from "@/lib/login-destination";
import { loginErrorFromParam } from "./login-error";

// The tagline sets as a stacked poster headline on the black panel. Derived from
// the brand constant rather than retyped, so a wording change follows automatically.
const TAGLINE_LINES = FFSA_TAGLINE.split("·").map((part) => part.trim());

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const router = useRouter();
  const supabase = createClient();

  // If the middleware redirected here because the account was deactivated,
  // sign out the lingering session and show the error. Without the sign-out
  // the middleware would redirect back to /home on the next navigation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    const message = loginErrorFromParam(code);
    if (message) setError(message);
    // A deactivated account still has a session. Clear it here so the next
    // click is not bounced back to home. A failed sign-out has
    // already cleared what it could; signing out again is not useful.
    if (code === "deactivated") {
      supabase.auth.signOut().catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Supabase returns a generic "Invalid login credentials" for a wrong
      // password, an email with no account, AND an accepted applicant who has
      // never set a password. The old copy asserted the middle case ("you
      // don't have an account here yet"), which was flatly untrue for that
      // third group and steered them away from the one link that helps them.
      // We can't tell the cases apart client-side without leaking which
      // addresses have accounts, so name all three and point at the fix.
      const isInvalidCreds = /invalid login credentials/i.test(error.message);
      setError(
        isInvalidCreds
          ? "We couldn't sign you in. If you've been accepted but never set a password — or you've forgotten it — use \u201cForgot password / first-time setup\u201d below and we'll email you a link to get in."
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

    // Every signed-in person, staff or portal, lands on /home unless they
    // were trying to open a safe internal page. The shell's Home is /home
    // for both variants; there is no separate portal home.
    const requested = new URLSearchParams(window.location.search).get("redirect");
    router.push(loginDestination(requested) ?? "/home");
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
        <Logo surface="black" kind="wordmark" height={24} />

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
          <span className="mb-6 inline-block lg:hidden">
            <Logo surface="white" kind="wordmark" height={24} />
          </span>

          {/* The screen's only yellow: the masthead tick rule. */}
          <div className="text-eyebrow">Sign in to your account</div>
          <h1 className="page-title">Sign in</h1>

          <form onSubmit={handleLogin} className="mt-9 space-y-6">
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

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-5">
            <Link
              href="/forgot-password"
              className="inline-flex min-h-11 items-center font-mono text-[9.5px] font-bold uppercase leading-snug tracking-[0.16em] text-[color:var(--text-secondary)] hover:text-ink"
            >
              Forgot password / first-time setup
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
