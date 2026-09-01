"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import {
  compressImageToMaxBytes,
  detectImageType,
} from "@/lib/image";

export const LICENSE_ACCEPT = "image/png,image/jpeg,image/webp,image/heic,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024; // matches the API + bucket limit
const COMPRESS_THRESHOLD = 2 * 1024 * 1024;

export type LicenseValue = {
  file_name: string | null;
  signed_url: string | null;
} | null;

/**
 * Validate a picked licence file and shrink phone photos before upload.
 * PDFs pass through untouched. Returns an error message instead of a file
 * when the pick isn't usable.
 */
export async function prepareLicenseFile(
  raw: File
): Promise<{ file: File } | { error: string }> {
  const isPdf = raw.type === "application/pdf";
  if (!isPdf && !detectImageType(raw)) {
    return { error: "Choose a photo (JPG, PNG, HEIC, WebP) or a PDF." };
  }
  let file = raw;
  if (!isPdf && raw.size > COMPRESS_THRESHOLD) {
    file = await compressImageToMaxBytes(raw, {
      maxDimension: 1600,
      maxBytes: COMPRESS_THRESHOLD,
    });
  }
  if (file.size > MAX_BYTES) {
    return { error: "That file is over 10 MB — please choose a smaller one." };
  }
  return { file };
}

/** Upload (or replace) a driver's licence once the driver row exists. */
export async function uploadDriverLicense(
  driverId: string,
  file: File
): Promise<{ ok: true; file_name: string; signed_url: string | null } | { error: string }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`/api/vehicles/drivers/${driverId}/license`, {
    method: "POST",
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { error: json.error ?? "Could not upload the licence." };
  return { ok: true, file_name: json.file_name, signed_url: json.signed_url ?? null };
}

/**
 * Optional driver's-licence attachment for one driver.
 *
 * With a `driverId` the file uploads immediately. Without one (the new-request
 * form, where drivers don't exist yet) the picked file is only staged — the
 * parent uploads it after the booking POST returns driver ids.
 */
export function DriverLicenseField({
  driverId,
  value,
  staged,
  disabled,
  onStage,
  onChange,
}: {
  driverId?: string | null;
  value?: LicenseValue;
  staged?: File | null;
  disabled?: boolean;
  onStage?: (file: File | null) => void;
  onChange?: (value: LicenseValue) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!driverId) {
        onStage?.(prepared.file);
        return;
      }
      const result = await uploadDriverLicense(driverId, prepared.file);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onChange?.({ file_name: result.file_name, signed_url: result.signed_url });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    if (!driverId) {
      onStage?.(null);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/vehicles/drivers/${driverId}/license`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not remove the licence.");
        return;
      }
      onChange?.(null);
    } finally {
      setBusy(false);
    }
  }

  const attachedName = staged?.name ?? value?.file_name ?? null;
  const hasFile = !!staged || !!value;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={LICENSE_ACCEPT}
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {hasFile ? (
        <>
          {value?.signed_url ? (
            <a
              href={value.signed_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs underline underline-offset-2"
            >
              <FileText className="h-3.5 w-3.5" />
              {attachedName ?? "Licence"}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
              <FileText className="h-3.5 w-3.5" />
              {attachedName ?? "Licence"}
              {staged && <span className="text-[color:var(--text-tertiary)]">(uploads on submit)</span>}
            </span>
          )}
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            Replace
          </button>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={remove}
            className="text-muted-foreground hover:text-destructive disabled:opacity-50"
            aria-label="Remove licence"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          Attach licence
        </button>
      )}
      {busy && hasFile && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
