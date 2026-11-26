"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, inputClass, Notice, PrimaryButton } from "../_components/ui";

export function RedeemForm({ initialCode, signedIn }: { initialCode: string; signedIn: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/store/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, email: signedIn ? undefined : email }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return setError(body?.error ?? "That didn't work. Try again.");
    if (body.next) return router.push(body.next);
    setDone(`${body.title} is yours. We've emailed ${email} a link to sign in and read it.`);
  }

  if (done) return <Notice tone="good">{done}</Notice>;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Code">
        <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={`${inputClass} font-mono uppercase tracking-[0.12em]`} placeholder="ABCD-EFGH-JK23" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
      </Field>
      {!signedIn && (
        <Field label="Your email" hint="Where your library lives. Use the same one every time.">
          <input required type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      <PrimaryButton type="submit" disabled={busy}>{busy ? "Checking…" : "Redeem"}</PrimaryButton>
    </form>
  );
}
