"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { validatePassword } from "@/lib/auth/password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, AuthError } from "../../auth-shell";

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
    <AuthShell>
      {/* The screen's only yellow: the masthead tick rule. */}
      <div className="masthead-context">{TYPE_COPY[type].eyebrow}</div>
      <h1 className="page-title">Welcome to the Hub</h1>
      <p className="mt-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
        {TYPE_COPY[type].blurb}
      </p>

      {/* The way out, above the fold. A sign-up link gets forwarded around, so
          people who already have an account land here by accident; the "Sign
          in" line at the foot of the form sits below eight fields on a phone,
          which is the same as not being there. */}
      <Link
        href="/login"
        className="mt-6 flex items-center justify-between gap-3 border border-ink bg-bone px-4 py-3.5 transition-colors hover:bg-bone-3"
      >
        <span className="text-[13px] leading-snug text-[#2A2822]">
          Already have an account?{" "}
          <span className="font-semibold text-ink underline underline-offset-4">Sign in instead</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-ink" />
      </Link>

      <form onSubmit={handleSubmit} className="mt-9 space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="first-name">First Name</Label>
            <Input
              id="first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              required
              className="h-12"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last-name">Last Name</Label>
            <Input
              id="last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              required
              className="h-12"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email Address</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
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
            autoComplete="new-password"
            required
            className="h-12"
          />
          <p className="mono-label">At least 8 characters</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm Password</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            className="h-12"
          />
        </div>

        {error && <AuthError>{error}</AuthError>}

        <Button type="submit" className="h-12 w-full" disabled={loading}>
          {loading ? "Creating account..." : "Continue"}
        </Button>
      </form>

      <div className="mt-8 border-t border-rule pt-5">
        <p className="text-[13px] text-[color:var(--text-secondary)]">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-ink underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
