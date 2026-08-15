import Image from "next/image";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

export function JoinInvalid() {
  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center px-4 overflow-hidden"
      style={{ background: "#0D0B09" }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(245,197,24,0.04) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: "2px",
          background:
            "linear-gradient(90deg, transparent, hsl(42 95% 55%), transparent)",
        }}
      />

      <div className="relative mb-10 text-center">
        <Image
          src="/brand/ff-wordmark-white.png"
          alt="Fire & Fragrance"
          width={220}
          height={26}
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
        className="relative w-full max-w-sm text-center"
        style={{
          background: "hsl(22 10% 8%)",
          border: "1px solid hsl(22 8% 15%)",
          borderRadius: "14px",
          padding: "2.5rem 2rem",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
        }}
      >
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "14px",
            background: "hsl(0 70% 55% / 0.1)",
            border: "1px solid hsl(0 70% 55% / 0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1.5rem",
          }}
        >
          <AlertCircle className="h-6 w-6" style={{ color: "hsl(0 70% 65%)" }} />
        </div>

        <p
          style={{
            fontSize: "9px",
            letterSpacing: "0.3em",
            fontWeight: 700,
            color: "hsl(0 70% 65%)",
            textTransform: "uppercase",
            marginBottom: "8px",
          }}
        >
          Link Expired
        </p>

        <h2
          style={{
            fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
            fontSize: "2rem",
            letterSpacing: "0.04em",
            color: "#F0EBE3",
            marginBottom: "0.75rem",
          }}
        >
          This invite link isn&apos;t active
        </h2>

        <p style={{ fontSize: "14px", color: "hsl(30 8% 55%)", lineHeight: 1.6, marginBottom: "1.5rem" }}>
          It may have been regenerated or paused by a super admin. Ask whoever shared
          this link for an updated one, or sign in if you already have an account.
        </p>

        <Link
          href="/login"
          style={{
            display: "inline-block",
            padding: "10px 24px",
            fontSize: "12px",
            letterSpacing: "0.15em",
            fontWeight: 700,
            textTransform: "uppercase",
            color: "#0D0B09",
            background: "hsl(42 95% 55%)",
            borderRadius: "8px",
            textDecoration: "none",
          }}
        >
          Go to Login
        </Link>
      </div>
    </div>
  );
}
