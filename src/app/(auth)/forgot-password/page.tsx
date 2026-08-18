"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "../auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Show the same neutral confirmation even on a network error — we never
      // reveal whether the address is registered.
    }
    setLoading(false);
    setSubmitted(true);
  }

  return (
    <AuthShell>
      {submitted ? (
        <>
          <div className="masthead-context">Check your inbox</div>
          <h1 className="page-title">Reset link sent</h1>
          <p className="mt-5 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
            If an account exists for that email, we&apos;ve sent a link to reset
            your password. It expires in 1 hour.
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
          <div className="masthead-context">Reset your password</div>
          <h1 className="page-title">Forgot password</h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
            Enter your email and we&apos;ll send you a link to set a new one.
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
              {loading ? "Sending..." : "Send Reset Link"}
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
