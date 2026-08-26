"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeInput } from "@/components/auth/code-input";
import { AuthShell } from "../../auth-shell";

/**
 * The 2FA challenge. A session reaches this screen with the password already
 * verified but the assurance level still at aal1 — middleware keeps it away
 * from everything else until a live authenticator code lifts it to aal2.
 */
function ChallengeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();
  const redirectTo = params.get("redirect") || "";

  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  // Guard the screen itself: no session, or nothing left to verify, means the
  // user doesn't belong here. Covers the expired-temporary-session case too —
  // a lapsed session lands back on sign-in rather than on a dead form.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      if (!data.user) {
        router.replace("/login");
        return;
      }
      const { data: aal } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!active) return;
      if (aal?.currentLevel === "aal2" || aal?.nextLevel !== "aal2") {
        router.replace(redirectTo || "/dashboard");
        return;
      }
      setChecking(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(submitted: string) {
    if (verifying || submitted.length !== 6) return;
    setError(null);
    setVerifying(true);

    // Verification is Supabase's, server-side against the vaulted secret. The
    // browser only ever carries the six digits the user typed, and they are
    // never logged.
    const { data: factors, error: listError } =
      await supabase.auth.mfa.listFactors();
    const factor = factors?.totp?.[0];
    if (listError || !factor) {
      setVerifying(false);
      setError("We couldn't find your authenticator. Please sign in again.");
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: submitted,
    });

    if (verifyError) {
      setVerifying(false);
      setCode("");
      setError(
        /rate|too many/i.test(verifyError.message)
          ? "Too many attempts. Please wait a minute and try again."
          : "That code isn't right, or it just expired. Check your app for the current code and try again."
      );
      return;
    }

    // The session is now aal2 — full access.
    router.replace(redirectTo || "/dashboard");
    router.refresh();
  }

  async function redeemRecoveryCode(e: React.FormEvent) {
    e.preventDefault();
    setRecoveryError(null);
    setRecovering(true);

    const res = await fetch("/api/auth/2fa/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: recoveryCode }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setRecovering(false);
      setRecoveryError(body?.error ?? "That recovery code isn't valid.");
      return;
    }

    // The factor is gone server-side, but this browser's session still lists
    // it — without a refresh the gate would bounce us straight back to a
    // challenge for an authenticator that no longer exists.
    await supabase.auth.refreshSession();

    // The enrolment gate now takes over and walks them through a new device.
    router.replace("/account/security/two-factor?recovered=1");
    router.refresh();
  }

  if (checking) {
    return (
      <AuthShell>
        <div className="masthead-context">One more step</div>
        <h1 className="page-title">Two-factor</h1>
        <p className="mt-5 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
          Checking your session…
        </p>
      </AuthShell>
    );
  }

  if (recoveryMode) {
    return (
      <AuthShell>
        <div className="masthead-context">Lost your phone</div>
        <h1 className="page-title">Recovery code</h1>
        <p className="mt-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
          Enter one of the recovery codes you saved. Using a code removes the
          authenticator you&apos;ve lost — you&apos;ll set up a new one straight
          after.
        </p>

        <form onSubmit={redeemRecoveryCode} className="mt-8 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="recovery">Recovery Code</Label>
            <Input
              id="recovery"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder="XXXXX-XXXXX"
              autoComplete="off"
              spellCheck={false}
              className="h-12 uppercase tracking-[0.14em]"
            />
          </div>

          {recoveryError && (
            <p
              role="alert"
              className="border-l-2 border-destructive bg-bone px-4 py-3 text-[13px] leading-relaxed text-[color:var(--text-secondary)]"
            >
              {recoveryError}
            </p>
          )}

          <Button
            type="submit"
            className="h-12 w-full"
            disabled={recovering || recoveryCode.trim().length < 10}
          >
            {recovering ? "Checking..." : "Use Recovery Code"}
          </Button>
        </form>

        <div className="mt-8 border-t border-rule pt-5">
          <button
            type="button"
            onClick={() => {
              setRecoveryMode(false);
              setRecoveryError(null);
            }}
            className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-secondary)] hover:text-ink"
          >
            Back to authenticator code
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="masthead-context">One more step</div>
      <h1 className="page-title">Two-factor</h1>
      <p className="mt-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
        Enter the 6-digit code from your authenticator app.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          verify(code);
        }}
        className="mt-8 space-y-6"
      >
        <div className="space-y-2">
          <Label htmlFor="code">Authentication Code</Label>
          <CodeInput
            value={code}
            onChange={setCode}
            onComplete={verify}
            disabled={verifying}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="border-l-2 border-destructive bg-bone px-4 py-3 text-[13px] leading-relaxed text-[color:var(--text-secondary)]"
          >
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="h-12 w-full"
          disabled={verifying || code.length !== 6}
        >
          {verifying ? "Verifying..." : "Verify"}
        </Button>
      </form>

      <div className="mt-8 flex items-center justify-between gap-4 border-t border-rule pt-5">
        <button
          type="button"
          onClick={() => {
            setRecoveryMode(true);
            setError(null);
          }}
          className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-secondary)] hover:text-ink"
        >
          Use a recovery code
        </button>
        <button
          type="button"
          onClick={async () => {
            await supabase.auth.signOut();
            router.replace("/login");
          }}
          className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-tertiary)] hover:text-ink"
        >
          Sign out
        </button>
      </div>
    </AuthShell>
  );
}

export default function TwoFactorChallengePage() {
  return (
    <Suspense fallback={null}>
      <ChallengeInner />
    </Suspense>
  );
}
