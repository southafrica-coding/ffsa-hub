"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validatePassword } from "@/lib/auth/password";
import { ArrowLeft, ShieldCheck, ShieldAlert, ChevronRight } from "lucide-react";
import Link from "next/link";

const fieldStyle = {
  background: "hsl(20 12% 5%)",
  border: "1px solid hsl(22 8% 17%)",
  color: "#F0EBE3",
  borderRadius: "8px",
  fontSize: "14px",
} as const;

const labelStyle = {
  fontSize: "9px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "hsl(30 8% 45%)",
} as const;

const eyebrowStyle = {
  fontSize: "10px",
  letterSpacing: "0.25em",
  fontWeight: 700,
  color: "hsl(42 95% 55%)",
  textTransform: "uppercase",
  marginBottom: "0.4rem",
} as const;

const cardStyle = {
  background: "hsl(22 10% 8%)",
  border: "1px solid hsl(22 8% 15%)",
  borderRadius: "14px",
  padding: "2.25rem",
  boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
} as const;

function primaryBtnStyle(busy: boolean) {
  return {
    background: busy ? "hsl(42 80% 42%)" : "hsl(42 95% 55%)",
    color: "#0D0B09",
    fontSize: "11px",
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    borderRadius: "8px",
    marginTop: "0.5rem",
    boxShadow: busy ? "none" : "0 4px 18px rgba(245,197,24,0.25)",
  };
}

export default function SecurityPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const [twoFactorOn, setTwoFactorOn] = useState<boolean | null>(null);

  // — Change password —
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  // — Change email —
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      if (!data.user) {
        router.replace("/login?redirect=/account/security");
        return;
      }
      setEmail(data.user.email ?? null);

      const { data: factors } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      setTwoFactorOn(
        (factors?.totp ?? []).some((f) => f.status === "verified")
      );
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (!email) return;

    const validationError = validatePassword(next);
    if (validationError) {
      setPwError(validationError);
      return;
    }
    if (next !== confirm) {
      setPwError("New passwords do not match.");
      return;
    }
    if (next === current) {
      setPwError("Your new password must be different from your current one.");
      return;
    }

    setPwSaving(true);
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (reauthErr) {
      setPwSaving(false);
      setPwError("Your current password is incorrect.");
      return;
    }

    const { error: upErr } = await supabase.auth.updateUser({ password: next });
    if (upErr) {
      setPwSaving(false);
      setPwError(upErr.message);
      return;
    }

    // Record it for the admin security view, then drop other devices.
    await fetch("/api/account/security-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "password_changed" }),
    }).catch(() => {});
    await supabase.auth.signOut({ scope: "others" });

    setPwSaving(false);
    setPwDone(true);
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  async function handleEmailChange(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);

    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setEmailError("Enter a valid email address.");
      return;
    }
    if (trimmed === (email ?? "").toLowerCase()) {
      setEmailError("That's already your email address.");
      return;
    }

    setEmailSaving(true);
    const res = await fetch("/api/account/change-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newEmail: trimmed, currentPassword: emailPassword }),
    }).catch(() => null);
    setEmailSaving(false);

    if (!res) {
      setEmailError("Something went wrong. Please try again.");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setEmailError(data.error ?? "Couldn't start the email change.");
      return;
    }
    setEmailSent(true);
    setEmailPassword("");
  }

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center px-4 overflow-hidden py-12"
      style={{ background: "#0D0B09" }}
    >
      <div className="w-full max-w-md space-y-5">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-2"
          style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(30 8% 45%)", fontSize: "12px", letterSpacing: "0.06em" }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {/* — Two-factor authentication — */}
        <Link href="/account/security/two-factor" style={{ display: "block", textDecoration: "none" }}>
          <div style={{ ...cardStyle, padding: "1.6rem 1.75rem" }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p style={eyebrowStyle}>Two-Factor Authentication</p>
                <div className="flex items-center gap-2" style={{ marginTop: "0.35rem" }}>
                  {twoFactorOn === null ? (
                    <span style={{ fontSize: "13px", color: "hsl(30 8% 45%)" }}>Checking…</span>
                  ) : twoFactorOn ? (
                    <>
                      <ShieldCheck className="h-4 w-4" style={{ color: "hsl(140 50% 55%)" }} />
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "hsl(140 50% 62%)" }}>
                        Status: Enabled
                      </span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="h-4 w-4" style={{ color: "hsl(42 95% 55%)" }} />
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "hsl(42 95% 60%)" }}>
                        Status: Disabled
                      </span>
                    </>
                  )}
                </div>
                <p style={{ fontSize: "12.5px", color: "hsl(30 8% 45%)", lineHeight: 1.7, marginTop: "0.5rem" }}>
                  {twoFactorOn
                    ? "Manage your authenticator and recovery codes."
                    : "Add a code from your authenticator app to every sign-in."}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "hsl(30 8% 40%)" }} />
            </div>
          </div>
        </Link>

        {/* — Change password — */}
        <div style={cardStyle}>
          <p style={eyebrowStyle}>Security</p>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#F0EBE3", marginBottom: "0.4rem" }}>
            Change password
          </h1>
          <p style={{ fontSize: "12.5px", color: "hsl(30 8% 45%)", lineHeight: 1.7, marginBottom: "1.75rem" }}>
            Pick a strong password you don&apos;t use anywhere else. Changing it
            signs you out of every other device.
          </p>

          {pwDone ? (
            <div style={{ background: "hsl(42 95% 55% / 0.08)", border: "1px solid hsl(42 95% 55% / 0.25)", borderRadius: "10px", padding: "1.25rem" }}>
              <p style={{ fontSize: "13px", color: "#E8DFD2", lineHeight: 1.7 }}>
                Your password has been updated and all other sessions have been
                signed out. You&apos;re still signed in here.
              </p>
              <button
                type="button"
                onClick={() => setPwDone(false)}
                style={{ marginTop: "0.75rem", color: "hsl(42 95% 60%)", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "12px" }}
              >
                Change it again
              </button>
            </div>
          ) : (
            <form onSubmit={handlePasswordChange} className="space-y-5">
              <input type="text" name="username" autoComplete="username" value={email ?? ""} readOnly hidden />
              <div className="space-y-1.5">
                <Label htmlFor="current" style={labelStyle}>Current Password</Label>
                <Input id="current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" className="h-11" style={fieldStyle} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="next" style={labelStyle}>New Password</Label>
                <Input id="next" type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" className="h-11" style={fieldStyle} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm" style={labelStyle}>Confirm New Password</Label>
                <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" className="h-11" style={fieldStyle} />
              </div>
              {pwError && <p style={{ color: "hsl(0 72% 65%)", fontSize: "12px" }}>{pwError}</p>}
              <Button type="submit" className="w-full h-11 font-bold transition-all duration-200" disabled={pwSaving || !email} style={primaryBtnStyle(pwSaving)}>
                {pwSaving ? "Updating..." : "Update Password"}
              </Button>
            </form>
          )}
        </div>

        {/* — Change email — */}
        <div style={cardStyle}>
          <p style={eyebrowStyle}>Sign-in email</p>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#F0EBE3", marginBottom: "0.4rem" }}>
            Change email
          </h2>
          <p style={{ fontSize: "12.5px", color: "hsl(30 8% 45%)", lineHeight: 1.7, marginBottom: "1.5rem" }}>
            {email ? (
              <>You currently sign in as <span style={{ color: "#C9C0B5" }}>{email}</span>. We&apos;ll email a confirmation link to the new address — it only takes effect once you click it.</>
            ) : (
              <>We&apos;ll email a confirmation link to the new address — it only takes effect once you click it.</>
            )}
          </p>

          {emailSent ? (
            <div style={{ background: "hsl(42 95% 55% / 0.08)", border: "1px solid hsl(42 95% 55% / 0.25)", borderRadius: "10px", padding: "1.25rem" }}>
              <p style={{ fontSize: "13px", color: "#E8DFD2", lineHeight: 1.7 }}>
                Check <span style={{ color: "#F0EBE3" }}>{newEmail.trim().toLowerCase()}</span> for a confirmation link. Click it
                within 1 hour to finish the change. Your current email stays
                active until then.
              </p>
              <button
                type="button"
                onClick={() => { setEmailSent(false); setNewEmail(""); }}
                style={{ marginTop: "0.75rem", color: "hsl(42 95% 60%)", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "12px" }}
              >
                Use a different address
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmailChange} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="newEmail" style={labelStyle}>New Email Address</Label>
                <Input id="newEmail" type="email" placeholder="you@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required autoComplete="email" className="h-11" style={fieldStyle} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emailPassword" style={labelStyle}>Current Password</Label>
                <Input id="emailPassword" type="password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} required autoComplete="current-password" className="h-11" style={fieldStyle} />
              </div>
              {emailError && <p style={{ color: "hsl(0 72% 65%)", fontSize: "12px" }}>{emailError}</p>}
              <Button type="submit" className="w-full h-11 font-bold transition-all duration-200" disabled={emailSaving || !email} style={primaryBtnStyle(emailSaving)}>
                {emailSaving ? "Sending..." : "Send Confirmation Link"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
