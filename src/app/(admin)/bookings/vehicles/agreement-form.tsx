"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { PenLine } from "lucide-react";

export function AgreementForm({
  bookingId,
  defaultSignerName,
  defaultSignerEmail,
}: {
  bookingId: string;
  defaultSignerName: string;
  defaultSignerEmail: string;
}) {
  const router = useRouter();
  const [signerName, setSignerName] = useState(defaultSignerName);
  const [signerEmail, setSignerEmail] = useState(defaultSignerEmail);
  const [signature, setSignature] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!signerName.trim()) return setError("Please enter your name.");
    if (!signature.trim()) return setError("Please type your full name as your signature.");
    if (!agreed) return setError("Please tick the box to confirm you agree.");
    setSaving(true);
    setError(null);
    const res = await fetch("/api/vehicles/agreements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicle_booking_id: bookingId,
        signer_name: signerName.trim(),
        signer_email: signerEmail.trim() || null,
        typed_signature: signature.trim(),
        agreed,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Could not record your signature.");
      setSaving(false);
      return;
    }
    toast.success("Policy signed — thank you.");
    router.push(`/bookings/vehicles/${bookingId}`);
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <PenLine className="h-4 w-4 text-muted-foreground" />
          Sign the agreement
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="signer_name">Your name *</Label>
            <Input
              id="signer_name"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signer_email">Email</Label>
            <Input
              id="signer_email"
              type="email"
              value={signerEmail}
              onChange={(e) => setSignerEmail(e.target.value)}
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 rounded border-input"
          />
          I have read, understood, and agree to abide by the FFSA Vehicle Usage
          Policy &amp; Agreement above.
        </label>

        <div className="space-y-2 max-w-sm">
          <Label htmlFor="signature">Signature — type your full name *</Label>
          <Input
            id="signature"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="Full name"
            style={{ fontFamily: "cursive", fontSize: "1.05rem" }}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-3 pt-1">
          <Button onClick={submit} disabled={saving}>
            {saving ? "Signing…" : "Sign agreement"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
