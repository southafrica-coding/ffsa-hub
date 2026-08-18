"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validatePassword } from "@/lib/auth/password";
import { AuthShell, AuthError } from "../auth-shell";

type Status = "checking" | "ready" | "invalid" | "done";

export default function ResetPasswordPage() {
  const supabase = createClient();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      // The recovery link establishes a session on /auth/confirm before
      // redirecting here. No session means the link was bad or expired.
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setStatus(data.user ? "ready" : "invalid");
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const pwErr = validatePassword(password);
    if (pwErr) {
      setError(pwErr);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    const { error: upErr } = await supabase.auth.updateUser({ password });
    if (upErr) {
      setSaving(false);
      setError(upErr.message);
      return;
    }
    // Record it for the admin security view BEFORE we drop the session.
    await fetch("/api/account/security-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "password_changed" }),
    }).catch(() => {});
    // Security: revoke every session everywhere, then have them sign in fresh.
    await supabase.auth.signOut({ scope: "global" });
    setSaving(false);
    setStatus("done");
  }

  return (
    <AuthShell>
      {status === "checking" && (
        <p className="mono-label">Verifying your link…</p>
      )}

      {status === "invalid" && (
        <>
          <div className="masthead-context">Link expired</div>
          <h1 className="page-title">This link isn&apos;t valid</h1>
          <p className="mt-5 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
            This password reset link is invalid or has expired. Request a fresh
            one and we&apos;ll email it right over.
          </p>
          <div className="mt-9 border-t border-rule pt-6">
            <Button asChild className="h-12 w-full sm:w-auto sm:px-10">
              <Link href="/forgot-password">Request New Link</Link>
            </Button>
          </div>
        </>
      )}

      {status === "done" && (
        <>
          <div className="masthead-context">Password updated</div>
          <h1 className="page-title">You&apos;re all set</h1>
          <p className="mt-5 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
            Your password has been changed and you&apos;ve been signed out of all
            other devices. Sign in with your new password to continue.
          </p>
          <div className="mt-9 border-t border-rule pt-6">
            <Button asChild className="h-12 w-full sm:w-auto sm:px-10">
              <Link href="/login">Continue to Sign In</Link>
            </Button>
          </div>
        </>
      )}

      {status === "ready" && (
        <>
          <div className="masthead-context">Choose a new password</div>
          <h1 className="page-title">New password</h1>

          <form onSubmit={handleSubmit} className="mt-9 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm Password</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                className="h-12"
              />
            </div>

            {error && <AuthError>{error}</AuthError>}

            <Button type="submit" className="h-12 w-full" disabled={saving}>
              {saving ? "Updating..." : "Update Password"}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
