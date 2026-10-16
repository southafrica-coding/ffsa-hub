"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import {
  LICENSE_ACCEPT,
  prepareLicenseFile,
} from "@/app/(admin)/bookings/vehicles/driver-license-field";

type Passport = {
  has_file: boolean;
  file_name: string | null;
  signed_url: string | null;
};

/**
 * The passport page photo, held once on the person (migration 242).
 *
 * Like the licence, not part of the profile completion gate — the booking
 * form refuses a driver without one, so the requirement lands on the people
 * who drive, when they book.
 */
export function PassportPhotoCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [passport, setPassport] = useState<Passport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/profile/passport-photo");
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.passport) setPassport(json.passport as Passport);
      setLoading(false);
    })();
  }, []);

  async function pick(raw: File | undefined) {
    if (!raw) return;
    setError(null);
    setBusy(true);
    try {
      const prepared = await prepareLicenseFile(raw);
      if ("error" in prepared) {
        setError(prepared.error);
        return;
      }
      const body = new FormData();
      body.append("file", prepared.file);
      const res = await fetch("/api/profile/passport-photo", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not upload your passport photo.");
        return;
      }
      setPassport({ has_file: true, file_name: json.file_name, signed_url: json.signed_url });
      toast.success("Passport photo uploaded.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch("/api/profile/passport-photo", { method: "DELETE" });
      if (!res.ok) {
        setError("Could not remove the passport photo.");
        return;
      }
      setPassport({ has_file: false, file_name: null, signed_url: null });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border p-4 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Loading your passport photo…
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border p-4">
      <Label>Photo of your passport photo page</Label>
      <input
        ref={fileRef}
        type="file"
        accept={LICENSE_ACCEPT}
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {passport?.has_file ? (
        <div className="flex flex-wrap items-center gap-3">
          {passport.signed_url ? (
            <a
              href={passport.signed_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2"
            >
              <FileText className="h-4 w-4" />
              {passport.file_name ?? "Passport"}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <FileText className="h-4 w-4" />
              {passport.file_name ?? "Passport"}
            </span>
          )}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            Replace
          </Button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          Upload passport photo
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        The page with your photo and details. Needed before you can be added as a driver on a vehicle booking.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
