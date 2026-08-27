"use client";

import { useState } from "react";
import { PUBLIC_SHELL_TOKENS } from "@/components/public-form-shell";

const T = PUBLIC_SHELL_TOKENS;

export function SubscribeForm({
  slug,
  labelName,
}: {
  slug: string;
  labelName: string;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/public/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, firstName, lastName, email }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(d.error ?? "Something went wrong. Please try again.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="py-4 text-center">
        <p
          style={{
            fontSize: 11,
            letterSpacing: "0.25em",
            fontWeight: 700,
            color: T.yellow,
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          You’re in
        </p>
        <p style={{ fontSize: 14, color: T.textDim, lineHeight: 1.55 }}>
          Thanks{firstName ? `, ${firstName}` : ""} — you’ll hear from us soon.
          Every email we send has an unsubscribe link at the bottom.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>First name</Label>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            required
          />
        </div>
        <div>
          <Label>Last name</Label>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
          />
        </div>
      </div>
      <div>
        <Label>Email</Label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>

      {err && (
        <p style={{ fontSize: 13, color: T.red, lineHeight: 1.5 }}>{err}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        style={{
          width: "100%",
          padding: "13px 16px",
          background: T.yellow,
          color: "#000",
          border: "none",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Signing you up…" : "Sign me up"}
      </button>

      <p style={{ fontSize: 12, color: T.textDim, lineHeight: 1.5, margin: 0 }}>
        You’re joining <strong style={{ color: T.text }}>{labelName}</strong>.
        We’ll only use your details to send you these updates, and you can
        unsubscribe from any email.
      </p>
    </form>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "block",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        fontWeight: 700,
        color: T.textDim,
        marginBottom: 6,
      }}
    >
      {children}
    </label>
  );
}
