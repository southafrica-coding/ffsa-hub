"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { CountryPicker } from "@/app/(admin)/bookings/vehicles/country-picker";
import {
  LICENSE_ACCEPT,
  prepareLicenseFile,
} from "@/app/(admin)/bookings/vehicles/driver-license-field";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import type { LicenceKind } from "@/lib/users/licence-gate";

/**
 * Blocking licence gate. Everyone answers it once, on their next login.
 *
 * Two steps rather than one long form: the first question decides which
 * fields even apply, and an SA card and a foreign one ask for different
 * things. Someone who doesn't drive answers in a single click.
 *
 * "I don't hold one" is a real answer, not an escape hatch — plenty of staff
 * don't drive, and the gate exists to KNOW, not to make everyone produce a
 * card. They simply can't be added as a driver afterwards.
 */

const SA_CODES = ["A", "A1", "B", "EB", "C", "C1", "EC", "EC1"];

export function LicenceGateForm({
  initialKind,
  missing,
}: {
  initialKind: LicenceKind | null;
  /** What was outstanding — set when they answered before but left gaps. */
  missing: string[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<LicenceKind | null>(initialKind);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [number, setNumber] = useState("");
  const [country, setCountry] = useState("");
  const [code, setCode] = useState("");
  const [expiry, setExpiry] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [hasPermit, setHasPermit] = useState(false);
  const [permitExpiry, setPermitExpiry] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function pick(raw: File | undefined) {
    if (!raw) return;
    const prepared = await prepareLicenseFile(raw);
    if ("error" in prepared) {
      setError(prepared.error);
      return;
    }
    setFile(prepared.file);
    setError(null);
  }

  /** "I don't hold a licence" — a complete answer on its own. */
  async function declareNone() {
    setSaving(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("payload", JSON.stringify({ licence_kind: "none" }));
      const res = await fetch("/api/profile/licence/declare", {
        method: "POST",
        body,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not save your answer.");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (!kind || kind === "none") return;
    if (!number.trim()) {
      setError("Please enter your licence number.");
      return;
    }
    if (kind === "international" && !country) {
      setError("Please choose the country that issued your licence.");
      return;
    }
    if (!noExpiry && !expiry) {
      setError("Please enter the expiry date, or tick that it has none.");
      return;
    }
    if (!file) {
      setError("Please attach a photo of your licence.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body = new FormData();
      body.append(
        "payload",
        JSON.stringify({
          licence_kind: kind,
          drivers_licence_number: number.trim(),
          licence_country: kind === "sa" ? "ZA" : country,
          licence_code: code.trim() || null,
          licence_expiry_date: noExpiry ? null : expiry,
          licence_no_expiry: noExpiry,
          has_international_permit: kind === "international" ? hasPermit : false,
          international_permit_expiry:
            kind === "international" && hasPermit && permitExpiry ? permitExpiry : null,
        })
      );
      body.append("file", file);

      const res = await fetch("/api/profile/licence/declare", {
        method: "POST",
        body,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not save your licence.");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  // Step 1 — which kind?
  if (!kind) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Your driver&rsquo;s licence</CardTitle>
          <CardDescription>
            We keep every staff member&rsquo;s licence on file so vehicle
            bookings fill themselves in — no re-typing your details or
            photographing your card for every trip.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {missing.length > 0 && (
            <p className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm">
              Still needed: {missing.join(", ")}.
            </p>
          )}
          <p className="text-sm font-medium">Do you hold a driver&rsquo;s licence?</p>
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() => setKind("sa")}
            >
              Yes — a South African licence
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() => setKind("international")}
            >
              Yes — a licence from another country
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start text-muted-foreground"
              disabled={saving}
              onClick={declareNone}
            >
              {saving ? "Saving…" : "No, I don't hold a driver's licence"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  // Step 2 — the details for that kind.
  const isIntl = kind === "international";
  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>
          {isIntl ? "Your international licence" : "Your South African licence"}
        </CardTitle>
        <CardDescription>
          Only you and the vehicles team can see this. It&rsquo;s used to
          confirm you may drive an FFSA vehicle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="gate_number">Licence number *</Label>
          <Input
            id="gate_number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="As printed on the card"
          />
        </div>

        {isIntl && (
          <div className="space-y-2">
            <Label htmlFor="gate_country">Country that issued it *</Label>
            <CountryPicker
              id="gate_country"
              value={country}
              onChange={setCountry}
              className="h-10 w-full border px-3 text-sm"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="gate_code">
            Licence code / class {isIntl && <span className="font-normal text-muted-foreground">(if shown)</span>}
          </Label>
          {isIntl ? (
            <Input
              id="gate_code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="However it's written on your licence"
            />
          ) : (
            <select
              id="gate_code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-10 w-full border px-3 text-sm"
            >
              <option value="">Select…</option>
              {SA_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-2">
          <Label>Expiry date {!noExpiry && "*"}</Label>
          <DateInput value={expiry} onChange={setExpiry} disabled={noExpiry} />
          {/* Some countries issue licences with no printed expiry — without
              this those holders would have to invent a date. */}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={noExpiry}
              onChange={(e) => {
                setNoExpiry(e.target.checked);
                if (e.target.checked) setExpiry("");
              }}
            />
            My licence has no expiry date printed on it
          </label>
        </div>

        {isIntl && (
          <div className="space-y-2 border-t pt-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hasPermit}
                onChange={(e) => setHasPermit(e.target.checked)}
              />
              I also hold an International Driving Permit
            </label>
            {hasPermit && (
              <div className="space-y-2 pl-6">
                <Label>Permit expiry</Label>
                <DateInput value={permitExpiry} onChange={setPermitExpiry} />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              A permit isn&rsquo;t required to answer this — the vehicles team
              will tell you if you need one for the trip you&rsquo;re on.
            </p>
          </div>
        )}

        <div className="space-y-2 border-t pt-4">
          <Label>Photo of your licence *</Label>
          <input
            ref={fileRef}
            type="file"
            accept={LICENSE_ACCEPT}
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          {file ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm">
                <FileText className="h-4 w-4" />
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Remove"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
              Attach photo
            </Button>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button type="button" onClick={submit} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Saving…" : "Save and continue"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setKind(null);
              setError(null);
            }}
          >
            Back
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
