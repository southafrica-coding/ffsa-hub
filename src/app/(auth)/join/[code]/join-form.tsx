"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { validatePassword } from "@/lib/auth/password";

type SignupType = "staff" | "student" | "community";

type Props = { code: string; type: SignupType };

const TYPE_COPY: Record<SignupType, { eyebrow: string; blurb: string }> = {
  staff: {
    eyebrow: "Staff sign-up",
    blurb:
      "Set up your staff profile in a few minutes. You'll add your details, then access the platform straight away.",
  },
  student: {
    eyebrow: "Student sign-up",
    blurb:
      "Set up your student profile in a few minutes. You'll add your details, then access the platform straight away.",
  },
  community: {
    eyebrow: "Community sign-up",
    blurb:
      "Set up your profile in a few minutes. You'll add a few details, then access the platform straight away.",
  },
};

export function JoinForm({ code, type }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    const pwError = validatePassword(password);
    if (pwError) {
      setError(pwError);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/public/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          type,
          email: email.trim(),
          password,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't create your account.");
        setLoading(false);
        return;
      }

      // Sign in straight away — the API already created the auth user.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      router.push("/onboarding?welcome=1");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12 overflow-hidden"
      style={{ background: "#0D0B09" }}
    >
      {/* Atmospheric vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(245,197,24,0.04) 0%, transparent 70%)",
        }}
      />
      {/* Top rule */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: "2px",
          background:
            "linear-gradient(90deg, transparent, hsl(42 95% 55%), transparent)",
        }}
      />

      {/* Wordmark */}
      <div className="relative mb-10 text-center animate-fade-up">
        <Image
          src="/brand/ff-wordmark-white.png"
          alt="Fire & Fragrance"
          width={260}
          height={31}
          style={{ objectFit: "contain", margin: "0 auto", display: "block" }}
          priority
        />
        <div className="flex items-center justify-center gap-4 mt-5">
          <div style={{ height: "1px", flex: 1, maxWidth: "70px", background: "hsl(22 8% 20%)" }} />
          <span
            style={{
              fontSize: "10px",
              letterSpacing: "0.32em",
              fontWeight: 700,
              color: "hsl(42 95% 55%)",
              textTransform: "uppercase",
            }}
          >
            South Africa · Hub
          </span>
          <div style={{ height: "1px", flex: 1, maxWidth: "70px", background: "hsl(22 8% 20%)" }} />
        </div>
      </div>

      <div
        className="relative w-full max-w-md animate-fade-up"
        style={{
          animationDelay: "60ms",
          background: "hsl(22 10% 8%)",
          border: "1px solid hsl(22 8% 15%)",
          borderRadius: "14px",
          padding: "2.25rem",
          boxShadow:
            "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
        }}
      >
        <div className="text-center mb-7">
          <p
            style={{
              fontSize: "9px",
              letterSpacing: "0.32em",
              fontWeight: 700,
              color: "hsl(42 95% 55%)",
              textTransform: "uppercase",
              marginBottom: "8px",
            }}
          >
            {TYPE_COPY[type].eyebrow}
          </p>
          <h1
            style={{
              fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
              fontSize: "2.25rem",
              letterSpacing: "0.04em",
              color: "#F0EBE3",
              marginBottom: "0.5rem",
              lineHeight: 1.05,
            }}
          >
            Welcome to the Hub
          </h1>
          <p style={{ fontSize: "13px", color: "hsl(30 8% 55%)", lineHeight: 1.6 }}>
            {TYPE_COPY[type].blurb}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="First name"
              value={firstName}
              onChange={setFirstName}
              autoComplete="given-name"
              required
            />
            <Field
              label="Last name"
              value={lastName}
              onChange={setLastName}
              autoComplete="family-name"
              required
            />
          </div>

          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            required
          />

          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint="At least 8 characters"
            required
          />

          <Field
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            required
          />

          {error && (
            <p
              style={{
                fontSize: "12px",
                color: "hsl(0 70% 65%)",
                padding: "10px 12px",
                background: "hsl(0 70% 52% / 0.08)",
                borderRadius: "8px",
                border: "1px solid hsl(0 70% 52% / 0.2)",
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px",
              fontSize: "12px",
              letterSpacing: "0.18em",
              fontWeight: 700,
              textTransform: "uppercase",
              color: "#0D0B09",
              background: loading ? "hsl(42 60% 45%)" : "hsl(42 95% 55%)",
              borderRadius: "8px",
              border: "none",
              cursor: loading ? "wait" : "pointer",
              transition: "background 120ms ease",
              marginTop: "8px",
            }}
          >
            {loading ? "Creating account…" : "Continue"}
          </button>
        </form>

        <div className="mt-6 pt-5 text-center" style={{ borderTop: "1px solid hsl(22 8% 15%)" }}>
          <p style={{ fontSize: "12px", color: "hsl(30 8% 50%)" }}>
            Already have an account?{" "}
            <Link
              href="/login"
              style={{ color: "hsl(42 95% 55%)", textDecoration: "none", fontWeight: 600 }}
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <p
        style={{
          textAlign: "center",
          marginTop: "1.75rem",
          fontSize: "9px",
          letterSpacing: "0.25em",
          color: "hsl(30 8% 35%)",
          textTransform: "uppercase",
        }}
      >
        Catalyse a Generation · Evangelise the World
      </p>
    </div>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  hint?: string;
  required?: boolean;
};

function Field({ label, value, onChange, type = "text", autoComplete, hint, required }: FieldProps) {
  return (
    <label className="block">
      <span
        style={{
          fontSize: "10px",
          letterSpacing: "0.18em",
          fontWeight: 700,
          color: "hsl(30 8% 60%)",
          textTransform: "uppercase",
          display: "block",
          marginBottom: "6px",
        }}
      >
        {label}
        {required && <span style={{ color: "hsl(42 95% 55%)", marginLeft: 4 }}>*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        style={{
          width: "100%",
          padding: "10px 12px",
          fontSize: "14px",
          color: "#F0EBE3",
          background: "hsl(22 10% 6%)",
          border: "1px solid hsl(22 8% 18%)",
          borderRadius: "8px",
          outline: "none",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "hsl(42 95% 55% / 0.5)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "hsl(22 8% 18%)")}
      />
      {hint && (
        <span style={{ fontSize: "11px", color: "hsl(30 8% 45%)", marginTop: 4, display: "block" }}>
          {hint}
        </span>
      )}
    </label>
  );
}
