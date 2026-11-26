"use client";

import { useState } from "react";
import { Field, inputClass, Notice, PrimaryButton } from "./ui";

// One small form, two jobs: "Resend my purchases" and "Email me a sign-in
// link". Both answer with the same neutral line whatever happened.
function EmailForm({ endpoint, button, label, hint }: { endpoint: string; button: string; label: string; hint?: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const body = await res.json().catch(() => ({}));
      if (body?.message) setMessage(body.message);
      else setError("Something went wrong. Try again in a minute.");
    } catch {
      setError("You look offline. Try again when you're connected.");
    } finally {
      setBusy(false);
    }
  }

  if (message) return <Notice tone="good">{message}</Notice>;
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label={label} hint={hint}>
        <input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@example.com" />
      </Field>
      {error && <Notice tone="bad">{error}</Notice>}
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? "Sending…" : button}
      </PrimaryButton>
    </form>
  );
}

export function ResendPurchasesForm() {
  return <EmailForm endpoint="/api/store/resend-purchases" button="Resend my purchases" label="Email you bought with" hint="We'll email a list of everything you've bought, with a link into My Library." />;
}

export function SignInForm() {
  return <EmailForm endpoint="/api/store/sign-in" button="Email me a sign-in link" label="Email you bought with" hint="No password. The link signs you in on this device." />;
}
