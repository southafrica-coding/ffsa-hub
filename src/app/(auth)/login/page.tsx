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

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const router = useRouter();
  const supabase = createClient();

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
      setError(error.message);
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
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 overflow-hidden" style={{ background: "#0D0B09" }}>

      {/* Atmospheric vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(245,197,24,0.04) 0%, transparent 70%)",
        }}
      />

      {/* Top rule */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{ height: "2px", background: "linear-gradient(90deg, transparent, hsl(42 95% 55%), transparent)" }}
      />

      {/* Logo block */}
      <div className="relative mb-12 text-center animate-fade-up">
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

      {/* Form card */}
      <div
        className="relative w-full max-w-sm animate-fade-up"
        style={{
          animationDelay: "60ms",
          background: "hsl(22 10% 8%)",
          border: "1px solid hsl(22 8% 15%)",
          borderRadius: "14px",
          padding: "2.25rem",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
        }}
      >
        <p
          style={{
            fontSize: "10px",
            letterSpacing: "0.25em",
            fontWeight: 600,
            color: "hsl(30 8% 40%)",
            textTransform: "uppercase",
            marginBottom: "1.75rem",
            textAlign: "center",
          }}
        >
          Sign in to your account
        </p>

        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-1.5">
            <Label
              htmlFor="email"
              style={{
                fontSize: "9px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fontWeight: 700,
                color: "hsl(30 8% 45%)",
              }}
            >
              Email Address
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="h-11"
              style={{
                background: "hsl(20 12% 5%)",
                border: "1px solid hsl(22 8% 17%)",
                color: "#F0EBE3",
                borderRadius: "8px",
                fontSize: "14px",
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="password"
              style={{
                fontSize: "9px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fontWeight: 700,
                color: "hsl(30 8% 45%)",
              }}
            >
              Password
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="h-11"
              style={{
                background: "hsl(20 12% 5%)",
                border: "1px solid hsl(22 8% 17%)",
                color: "#F0EBE3",
                borderRadius: "8px",
                fontSize: "14px",
              }}
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: "hsl(0 72% 65%)", fontSize: "12px" }}>
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full h-11 font-bold transition-all duration-200"
            disabled={loading}
            style={{
              background: loading ? "hsl(42 80% 42%)" : "hsl(42 95% 55%)",
              color: "#0D0B09",
              fontSize: "11px",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              borderRadius: "8px",
              marginTop: "0.5rem",
              boxShadow: loading ? "none" : "0 4px 18px rgba(245,197,24,0.25)",
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </Button>

          <div style={{ textAlign: "center", marginTop: "0.25rem" }}>
            <Link
              href="/forgot-password"
              style={{ fontSize: "11px", letterSpacing: "0.06em", color: "hsl(30 8% 45%)", textDecoration: "none" }}
            >
              Forgot your password?
            </Link>
          </div>
        </form>
      </div>

      {/* Tagline */}
      <p
        className="mt-10 animate-fade-up"
        style={{
          animationDelay: "120ms",
          fontSize: "9px",
          letterSpacing: "0.3em",
          color: "hsl(30 8% 25%)",
          textTransform: "uppercase",
        }}
      >
        {FFSA_TAGLINE}
      </p>

      {/* Bottom rule */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: "1px", background: "linear-gradient(90deg, transparent, hsl(22 8% 15%), transparent)" }}
      />
    </div>
  );
}
