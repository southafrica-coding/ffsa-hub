"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { CountryPicker } from "@/app/(admin)/bookings/vehicles/country-picker";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import {
  LICENSE_ACCEPT,
  prepareLicenseFile,
} from "@/app/(admin)/bookings/vehicles/driver-license-field";

/**
 * The driver's licence held once, on the person.
 *
 * This is not part of the profile completion gate: most staff never drive a
 * base vehicle, and locking them out of the Hub over a licence they may not
 * hold would be absurd. Instead the booking form refuses to accept a driver
 * with nothing on file — the requirement lands on the people it applies to,
 * at the moment it matters.
 */

type Licence = {
  drivers_licence_number: string | null;
  licence_country: string | null;
  licence_code: string | null;
  licence_expiry_date: string | null;
  licence_file_name: string | null;
  has_file: boolean;
  signed_url: string | null;
  base_driving_test_status: "not_required" | "pending" | "passed" | "failed";
  base_driving_test_passed_at: string | null;
};

const TEST_LABEL: Record<Licence["base_driving_test_status"], string> = {
  not_required: "Not required",
  pending: "Booked — awaiting result",
  passed: "Passed",
  failed: "Not passed",
};

export function LicenceCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [licence, setLicence] = useState<Licence | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [number, setNumber] = useState("");
  const [country, setCountry] = useState("ZA");
  const [code, setCode] = useState("");
  const [expiry, setExpiry] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/profile/licence");
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.licence) {
        const l = json.licence as Licence;
        setLicence(l);
        setNumber(l.drivers_licence_number ?? "");
        setCountry(l.licence_country ?? "ZA");
        setCode(l.licence_code ?? "");
        setExpiry(l.licence_expiry_date ?? "");
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/licence", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drivers_licence_number: number,
          licence_country: country,
          licence_code: code,
          licence_expiry_date: expiry,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not save your licence details.");
        return;
      }
      setLicence((p) =>
        p
          ? {
              ...p,
              drivers_licence_number: number,
              licence_country: country,
              licence_code: code,
              licence_expiry_date: expiry,
            }
          : p
      );
      toast.success("Licence details saved.");
    } finally {
      setSaving(false);
    }
  }

  async function pick(raw: File | undefined) {
    if (!raw) return;
    setError(null);
    setUploading(true);
    try {
      const prepared = await prepareLicenseFile(raw);
      if ("error" in prepared) {
        setError(prepared.error);
        return;
      }
      const body = new FormData();
      body.append("file", prepared.file);
      const res = await fetch("/api/profile/licence", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not upload your licence.");
        return;
      }
      setLicence((p) =>
        p
          ? { ...p, has_file: true, licence_file_name: json.file_name, signed_url: json.signed_url }
          : p
      );
      toast.success("Licence uploaded.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeFile() {
    setUploading(true);
    try {
      const res = await fetch("/api/profile/licence", { method: "DELETE" });
      if (!res.ok) {
        setError("Could not remove the licence.");
        return;
      }
      setLicence((p) =>
        p ? { ...p, has_file: false, licence_file_name: null, signed_url: null } : p
      );
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border p-4 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Loading your licence…
      </div>
    );
  }

  const expired =
    !!licence?.licence_expiry_date &&
    licence.licence_expiry_date < new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4 rounded-xl border p-4">
      {expired && (
        <p className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">
          This licence expired on {licence?.licence_expiry_date}. You won&rsquo;t be
          able to be added as a driver until it&rsquo;s renewed.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="licence_number">Licence number</Label>
          <Input
            id="licence_number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="As printed on the card"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="licence_expiry">Expiry date</Label>
          <DateInput value={expiry} onChange={setExpiry} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="licence_country">Issuing country</Label>
          <CountryPicker id="licence_country" value={country} onChange={setCountry} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="licence_code">Licence code</Label>
          <Input
            id="licence_code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. B, EB, C1"
          />
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <Label>Photo of your licence</Label>
        <input
          ref={fileRef}
          type="file"
          accept={LICENSE_ACCEPT}
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {licence?.has_file ? (
          <div className="flex flex-wrap items-center gap-3">
            {licence.signed_url ? (
              <a
                href={licence.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2"
              >
                <FileText className="h-4 w-4" />
                {licence.licence_file_name ?? "Licence"}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm">
                <FileText className="h-4 w-4" />
                {licence.licence_file_name ?? "Licence"}
              </span>
            )}
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Replace
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={removeFile}
              className="text-muted-foreground hover:text-destructive disabled:opacity-50"
              aria-label="Remove licence"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="gap-1.5"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
            Upload licence
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Only you and the vehicles team can open this — it isn&rsquo;t visible to
          other staff. Upload it once and every future booking uses it.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          Base-vehicle driving test:{" "}
          <span className="font-medium text-foreground">
            {TEST_LABEL[licence?.base_driving_test_status ?? "not_required"]}
          </span>
          {licence?.base_driving_test_passed_at && (
            <> &middot; {licence.base_driving_test_passed_at.slice(0, 10)}</>
          )}
        </p>
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save licence details"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
