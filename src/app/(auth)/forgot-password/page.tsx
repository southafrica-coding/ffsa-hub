"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "../auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setRetryAfter(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // A throttled request sends no email. Saying "Link sent" here is what
      // made this page untrustworthy: someone retrying while helping an
      // applicant was told it worked and waited for nothing.
      const data = (await res.json().catch(() => null)) as
        | { throttled?: boolean; retryAfterSeconds?: number }
        | null;
      if (data?.throttled) {
        setRetryAfter(data.retryAfterSeconds ?? 60);
      }
    } catch {
      // Show the same neutral confirmation even on a network error — we never
      // reveal whether the address is registered.
    }
    setLoading(false);
    setSubmitted(true);
  }

  // Count the wait down, so "try again in 43 seconds" stays true while it sits
  // on screen rather than going stale the moment it renders.
  useEffect(() => {
    if (retryAfter === null || retryAfter <= 0) return;
    const timer = setTimeout(() => setRetryAfter((n) => (n ?? 1) - 1), 1000);
    return () => clearTimeout(timer);
  }, [retryAfter]);

  return (
    <AuthShell>
      {submitted && retryAfter !== null && retryAfter > 0 ? (
        <>
          <div className="masthead-context">Already on its way</div>
          <h1 className="page-title">Hold on a moment</h1>
          <p className="mt-5 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
            A link was requested for that email moments ago, so we haven&apos;t
            sent another. Check your inbox and your spam folder — it may still
            be arriving.
          </p>
          <p className="mt-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
            You can request a new one in{" "}
            <span className="font-semibold text-ink">
              {retryAfter} second{retryAfter === 1 ? "" : "s"}
            </span>
            .
          </p>
          <p className="mt-4 text-[13px] leading-relaxed text-[color:var(--text-tertiary)]">
            Still nothing after that? Get in touch with the FFSA office and
            we&apos;ll send you a link directly.
          </p>
        </>
      ) : submitted ? (
        <>
          <div className="masthead-context">Check your inbox</div>
          <h1 className="page-title">Link sent</h1>
          <p className="mt-5 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
            If an account exists for that email, we&apos;ve sent a link to set
            your password. A reset link expires in 1 hour; a first-time setup
            link lasts 30 days.
          </p>
          <p className="mt-4 text-[13px] leading-relaxed text-[color:var(--text-tertiary)]">
            Didn&apos;t get it? Check spam, or{" "}
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="font-semibold text-ink underline underline-offset-4"
            >
              try again
            </button>
            .
          </p>
        </>
      ) : (
        <>
          <div className="masthead-context">Get into your account</div>
          <h1 className="page-title">Forgot password</h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
            Enter your email and we&apos;ll send you a link to set a password.
            This works whether you&apos;ve forgotten yours or have never set
            one up — including if your acceptance email went missing.
          </p>

          <form onSubmit={handleSubmit} className="mt-9 space-y-6">
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

            <Button type="submit" className="h-12 w-full" disabled={loading}>
              {loading ? "Sending..." : "Email Me A Link"}
            </Button>
          </form>
        </>
      )}

      <div className="mt-8 border-t border-rule pt-5">
        <Link
          href="/login"
          className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-secondary)] hover:text-ink"
        >
          ← Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}
