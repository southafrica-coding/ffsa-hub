"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, ShieldAlert, Copy, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeInput } from "@/components/auth/code-input";

// Mirrors the tokens on /account/security so the two pages read as one surface.
const cardStyle = {
  background: "hsl(22 10% 8%)",
  border: "1px solid hsl(22 8% 15%)",
  borderRadius: "14px",
  padding: "2.25rem",
  boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
} as const;

const labelStyle = {
  fontSize: "9px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "hsl(30 8% 45%)",
} as const;

function primaryBtnStyle(busy: boolean) {
  return {
    background: busy ? "hsl(42 80% 42%)" : "hsl(42 95% 55%)",
    color: "#0D0B09",
    fontSize: "11px",
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    borderRadius: "8px",
    boxShadow: busy ? "none" : "0 4px 18px rgba(245,197,24,0.25)",
  };
}

const fieldStyle = {
  background: "hsl(20 12% 5%)",
  border: "1px solid hsl(22 8% 17%)",
  color: "#F0EBE3",
  borderRadius: "8px",
  fontSize: "14px",
} as const;

const eyebrowStyle = {
  fontSize: "10px",
  letterSpacing: "0.25em",
  fontWeight: 700,
  color: "hsl(42 95% 55%)",
  textTransform: "uppercase" as const,
  marginBottom: "0.4rem",
};

const bodyStyle = {
  fontSize: "12.5px",
  color: "hsl(30 8% 45%)",
  lineHeight: 1.7,
} as const;

type Screen =
  | "loading"
  | "enabled"
  | "intro"
  | "enrolling"
  | "codes"
  | "disable";

type EnrolData = { factorId: string; secret: string; qr: string };

function TwoFactorInner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();

  const [screen, setScreen] = useState<Screen>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [enabledAt, setEnabledAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Enrolment
  const [enrol, setEnrol] = useState<EnrolData | null>(null);
  const [code, setCode] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [previousFactorIds, setPreviousFactorIds] = useState<string[]>([]);
  const [secretShown, setSecretShown] = useState(false);

  // Recovery codes
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  // Disable
  const [disablePassword, setDisablePassword] = useState("");

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace("/login?redirect=/account/security/two-factor");
      return;
    }
    setEmail(userData.user.email ?? null);

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = (factors?.totp ?? []).filter((f) => f.status === "verified");

    if (verified.length > 0) {
      setEnabledAt(verified[0].updated_at ?? verified[0].created_at ?? null);
      setScreen("enabled");
    } else {
      setScreen("intro");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (params.get("recovered") === "1") {
      setNotice(
        "Recovery code accepted. Your old authenticator has been removed — set up a new one now to finish getting back in."
      );
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Starts a fresh enrolment. Safe to call repeatedly. */
  async function startEnrolment(isReplacement: boolean) {
    setError(null);
    setBusy(true);
    setReplacing(isReplacement);
    setCode("");
    setSecretShown(false);

    const { data: existing } = await supabase.auth.mfa.listFactors();
    const all = existing?.totp ?? [];

    // Clear out anything left behind by an abandoned setup. Unverified factors
    // never granted anything, but they'd otherwise pile up.
    for (const factor of all.filter((f) => f.status !== "verified")) {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }

    // On a replacement the OLD verified factor stays alive until the new one is
    // confirmed, so an interrupted swap can never lock the user out.
    setPreviousFactorIds(
      isReplacement
        ? all.filter((f) => f.status === "verified").map((f) => f.id)
        : []
    );

    const { data, error: enrolError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `FFSA Hub · ${new Date().toISOString().slice(0, 10)}`,
      issuer: "FFSA Hub",
    });

    setBusy(false);
    if (enrolError || !data) {
      setError(
        enrolError?.message ??
          "We couldn't start setup. Please refresh and try again."
      );
      return;
    }

    setEnrol({
      factorId: data.id,
      secret: data.totp.secret,
      qr: data.totp.qr_code,
    });
    setScreen("enrolling");
  }

  /** Confirms the first code — the only thing that actually turns 2FA on. */
  async function confirmEnrolment(submitted: string) {
    if (!enrol || busy || submitted.length !== 6) return;
    setError(null);
    setBusy(true);

    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrol.factorId,
      code: submitted,
    });

    if (verifyError) {
      setBusy(false);
      setCode("");
      setError(
        /rate|too many/i.test(verifyError.message)
          ? "Too many attempts. Please wait a minute and try again."
          : "That code isn't right, or it just expired. Check your app for the current code."
      );
      return;
    }

    // Verified. Only now does the old authenticator lose its power.
    for (const id of previousFactorIds) {
      await supabase.auth.mfa.unenroll({ factorId: id });
    }
    setPreviousFactorIds([]);

    await issueRecoveryCodes();
  }

  /** Issues a fresh set of codes and shows them once. */
  async function issueRecoveryCodes() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/2fa/recovery-codes", {
      method: "POST",
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok || !Array.isArray(body?.codes)) {
      // 2FA itself is on and working; only the codes failed. Say so plainly
      // rather than implying the whole thing broke.
      setError(
        (body?.error ??
          "Your authenticator is set up, but we couldn't generate recovery codes.") +
          " You can generate them from this page."
      );
      setNotice(null);
      await load();
      return;
    }

    setCodes(body.codes);
    setCopied(false);
    setNotice(null);
    setScreen("codes");
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const res = await fetch("/api/account/2fa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: disablePassword }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setDisablePassword("");

    if (!res.ok) {
      setError(body?.error ?? "We couldn't turn two-factor off.");
      return;
    }

    // Drop the removed factor out of this browser's session before anything
    // re-reads it, then let the gate do its thing. The Hub requires 2FA, so the
    // next navigation lands back on setup — immediate rather than surprising.
    await supabase.auth.refreshSession();
    router.refresh();
    setScreen("intro");
    setNotice(
      "Two-factor authentication is off and your old authenticator has been removed. The Hub requires it, so you'll be asked to set up a new one."
    );
  }

  function copyCodes() {
    if (!codes) return;
    navigator.clipboard?.writeText(codes.join("\n")).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      },
      () => setError("Couldn't copy automatically — please select and copy the codes by hand.")
    );
  }

  return (
    <div style={{ background: "#0D0B09", minHeight: "100vh", padding: "3rem 1rem" }}>
      <div className="mx-auto w-full max-w-lg space-y-6">
        <Link
          href="/account/security"
          className="flex items-center gap-2"
          style={{ color: "hsl(30 8% 45%)", fontSize: "12px", letterSpacing: "0.06em" }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to security
        </Link>

        {notice && (
          <div style={{ background: "hsl(42 95% 55% / 0.08)", border: "1px solid hsl(42 95% 55% / 0.25)", borderRadius: "10px", padding: "1rem 1.25rem" }}>
            <p style={{ fontSize: "13px", color: "#E8DFD2", lineHeight: 1.7 }}>{notice}</p>
          </div>
        )}

        <div style={cardStyle}>
          <p style={eyebrowStyle}>Account Security</p>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#F0EBE3", marginBottom: "0.75rem" }}>
            Two-Factor Authentication
          </h1>

          {screen === "loading" && <p style={bodyStyle}>Loading…</p>}

          {/* — Enabled — */}
          {screen === "enabled" && (
            <>
              <div className="flex items-center gap-2" style={{ marginBottom: "1.25rem" }}>
                <ShieldCheck className="h-4 w-4" style={{ color: "hsl(140 50% 55%)" }} />
                <span style={{ fontSize: "13px", fontWeight: 600, color: "hsl(140 50% 62%)" }}>
                  Status: Enabled
                </span>
              </div>
              <p style={{ ...bodyStyle, marginBottom: "1.75rem" }}>
                Your account asks for a code from your authenticator app every
                time you sign in.
                {enabledAt && (
                  <> Set up on {new Date(enabledAt).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}.</>
                )}
              </p>

              {error && <p role="alert" style={{ color: "hsl(0 72% 65%)", fontSize: "12px", marginBottom: "1rem", lineHeight: 1.6 }}>{error}</p>}

              <div className="space-y-3">
                <Button onClick={issueRecoveryCodes} disabled={busy} className="w-full h-11 font-bold" style={primaryBtnStyle(busy)}>
                  {busy ? "Working…" : "Generate New Recovery Codes"}
                </Button>
                <button
                  type="button"
                  onClick={() => startEnrolment(true)}
                  disabled={busy}
                  style={{ width: "100%", height: "44px", background: "transparent", border: "1px solid hsl(22 8% 20%)", borderRadius: "8px", color: "#C9C0B5", fontSize: "11px", letterSpacing: "0.22em", textTransform: "uppercase", fontWeight: 700, cursor: "pointer" }}
                >
                  Replace Authenticator
                </button>
                <button
                  type="button"
                  onClick={() => { setScreen("disable"); setError(null); }}
                  style={{ display: "block", margin: "0.5rem auto 0", background: "none", border: "none", padding: 0, cursor: "pointer", color: "hsl(0 60% 58%)", fontSize: "12px" }}
                >
                  Disable Two-Factor Authentication
                </button>
              </div>
            </>
          )}

          {/* — Disabled / start setup — */}
          {screen === "intro" && (
            <>
              <div className="flex items-center gap-2" style={{ marginBottom: "1.25rem" }}>
                <ShieldAlert className="h-4 w-4" style={{ color: "hsl(42 95% 55%)" }} />
                <span style={{ fontSize: "13px", fontWeight: 600, color: "hsl(42 95% 60%)" }}>
                  Status: Disabled
                </span>
              </div>
              <p style={{ ...bodyStyle, marginBottom: "1.5rem" }}>
                The Hub requires two-factor authentication. You&apos;ll need an
                authenticator app — Google Authenticator, 1Password or Authy all
                work. Setup takes about a minute.
              </p>
              {error && <p role="alert" style={{ color: "hsl(0 72% 65%)", fontSize: "12px", marginBottom: "1rem", lineHeight: 1.6 }}>{error}</p>}
              <Button onClick={() => startEnrolment(false)} disabled={busy} className="w-full h-11 font-bold" style={primaryBtnStyle(busy)}>
                {busy ? "Starting…" : "Enable Two-Factor Authentication"}
              </Button>
            </>
          )}

          {/* — QR + first code — */}
          {screen === "enrolling" && enrol && (
            <>
              <p style={{ ...bodyStyle, marginBottom: "1.25rem" }}>
                {replacing
                  ? "Scan this with your new authenticator app. Your current authenticator keeps working until the new one is confirmed."
                  : "Scan this with your authenticator app, then enter the 6-digit code it shows."}
              </p>

              <div style={{ background: "#FFFFFF", borderRadius: "12px", padding: "1rem", width: "fit-content", margin: "0 auto 1.25rem" }}>
                {/* Supabase returns the otpauth:// QR as an SVG data URL. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enrol.qr} alt="Authenticator QR code" width={196} height={196} style={{ display: "block" }} />
              </div>

              <button
                type="button"
                onClick={() => setSecretShown((v) => !v)}
                style={{ display: "block", margin: "0 auto 0.75rem", background: "none", border: "none", padding: 0, cursor: "pointer", color: "hsl(42 95% 60%)", fontSize: "12px" }}
              >
                {secretShown ? "Hide setup key" : "Can't scan? Enter a key instead"}
              </button>

              {secretShown && (
                <div style={{ background: "hsl(20 12% 5%)", border: "1px solid hsl(22 8% 17%)", borderRadius: "8px", padding: "0.85rem", marginBottom: "1.25rem" }}>
                  <p style={{ ...labelStyle, marginBottom: "0.4rem" }}>Setup Key</p>
                  <p style={{ fontFamily: "ui-monospace, monospace", fontSize: "13px", color: "#F0EBE3", wordBreak: "break-all", letterSpacing: "0.06em" }}>
                    {enrol.secret}
                  </p>
                  <p style={{ fontSize: "11px", color: "hsl(30 8% 40%)", marginTop: "0.5rem" }}>
                    Time-based · 6 digits · 30 seconds
                  </p>
                </div>
              )}

              <form onSubmit={(e) => { e.preventDefault(); confirmEnrolment(code); }} className="space-y-4">
                <Label htmlFor="code" style={{ ...labelStyle, display: "block", textAlign: "center" }}>
                  Code From Your App
                </Label>
                <CodeInput value={code} onChange={setCode} onComplete={confirmEnrolment} disabled={busy} variant="dark" />
                {error && <p role="alert" style={{ color: "hsl(0 72% 65%)", fontSize: "12px", textAlign: "center", lineHeight: 1.6 }}>{error}</p>}
                <Button type="submit" className="w-full h-11 font-bold" disabled={busy || code.length !== 6} style={primaryBtnStyle(busy)}>
                  {busy ? "Verifying…" : replacing ? "Confirm New Authenticator" : "Verify & Enable"}
                </Button>
              </form>

              <button
                type="button"
                onClick={() => { setEnrol(null); setError(null); load(); }}
                style={{ display: "block", margin: "1.25rem auto 0", background: "none", border: "none", padding: 0, cursor: "pointer", color: "hsl(30 8% 45%)", fontSize: "12px" }}
              >
                Cancel
              </button>
            </>
          )}

          {/* — Recovery codes, shown once — */}
          {screen === "codes" && codes && (
            <>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#F0EBE3", marginBottom: "0.5rem" }}>
                Save your recovery codes
              </h2>
              <p style={{ ...bodyStyle, marginBottom: "1.25rem" }}>
                Store these somewhere safe. Each code can only be used once, and
                this is the only time we can show them to you. If you lose your
                phone, a code gets you back in.
              </p>

              <div style={{ background: "hsl(20 12% 5%)", border: "1px solid hsl(22 8% 17%)", borderRadius: "10px", padding: "1.1rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.55rem" }}>
                {codes.map((c) => (
                  <span key={c} style={{ fontFamily: "ui-monospace, monospace", fontSize: "13.5px", color: "#F0EBE3", letterSpacing: "0.06em", textAlign: "center" }}>
                    {c}
                  </span>
                ))}
              </div>

              {error && <p role="alert" style={{ color: "hsl(0 72% 65%)", fontSize: "12px", marginTop: "1rem", lineHeight: 1.6 }}>{error}</p>}

              <button
                type="button"
                onClick={copyCodes}
                className="flex items-center justify-center gap-2"
                style={{ width: "100%", height: "42px", marginTop: "1rem", background: "transparent", border: "1px solid hsl(22 8% 20%)", borderRadius: "8px", color: "#C9C0B5", fontSize: "12px", cursor: "pointer" }}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy all codes"}
              </button>

              <Button
                onClick={() => { setCodes(null); load(); }}
                className="w-full h-11 font-bold"
                style={{ ...primaryBtnStyle(false), marginTop: "0.75rem" }}
              >
                I&apos;ve Saved Them
              </Button>
            </>
          )}

          {/* — Disable — */}
          {screen === "disable" && (
            <>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#F0EBE3", marginBottom: "0.5rem" }}>
                Disable two-factor authentication
              </h2>
              <p style={{ ...bodyStyle, marginBottom: "1.5rem" }}>
                This removes your authenticator and deletes your recovery codes
                permanently. The Hub requires two-factor authentication, so
                you&apos;ll be asked to set it up again on your next visit.
              </p>
              <form onSubmit={handleDisable} className="space-y-4">
                <input type="text" name="username" autoComplete="username" value={email ?? ""} readOnly hidden />
                <div className="space-y-1.5">
                  <Label htmlFor="disablePassword" style={labelStyle}>Current Password</Label>
                  <Input id="disablePassword" type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} required autoComplete="current-password" className="h-11" style={fieldStyle} />
                </div>
                {error && <p role="alert" style={{ color: "hsl(0 72% 65%)", fontSize: "12px", lineHeight: 1.6 }}>{error}</p>}
                <Button type="submit" disabled={busy || !disablePassword} className="w-full h-11 font-bold" style={{ ...primaryBtnStyle(busy), background: busy ? "hsl(0 45% 38%)" : "hsl(0 60% 48%)", color: "#FFF4F0", boxShadow: "none" }}>
                  {busy ? "Working…" : "Disable Two-Factor"}
                </Button>
              </form>
              <button
                type="button"
                onClick={() => { setScreen("enabled"); setError(null); setDisablePassword(""); }}
                style={{ display: "block", margin: "1.25rem auto 0", background: "none", border: "none", padding: 0, cursor: "pointer", color: "hsl(30 8% 45%)", fontSize: "12px" }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TwoFactorPage() {
  return (
    <Suspense fallback={null}>
      <TwoFactorInner />
    </Suspense>
  );
}
