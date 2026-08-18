"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";

type Label = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
};

const CONTACT_FIELDS = [
  "first_name",
  "last_name",
  "preferred_name",
  "email",
  "phone",
  "date_of_birth",
  "marital_status",
  "gender",
  "nationality",
  "preferred_language",
  "address_line_1",
  "address_line_2",
  "city",
  "province",
  "country",
  "postal_code",
  "notes",
] as const;

type ContactField = (typeof CONTACT_FIELDS)[number];

const BATCH_SIZE = 200;

// Best-effort guesser to pre-populate the column mapping.
function guessField(header: string): ContactField | "" {
  const h = header.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const map: Record<string, ContactField> = {
    first_name: "first_name",
    firstname: "first_name",
    given_name: "first_name",
    last_name: "last_name",
    lastname: "last_name",
    surname: "last_name",
    family_name: "last_name",
    preferred_name: "preferred_name",
    nickname: "preferred_name",
    email: "email",
    email_address: "email",
    e_mail: "email",
    phone: "phone",
    phone_number: "phone",
    mobile: "phone",
    cell: "phone",
    date_of_birth: "date_of_birth",
    date_of_birth_2: "date_of_birth",
    dob: "date_of_birth",
    birthdate: "date_of_birth",
    marital_status: "marital_status",
    gender: "gender",
    sex: "gender",
    nationality: "nationality",
    nationality_citizenship: "nationality",
    citizenship: "nationality",
    country: "country",
    city: "city",
    province: "province",
    state: "province",
    region: "province",
    postal_code: "postal_code",
    postcode: "postal_code",
    zip: "postal_code",
    zip_code: "postal_code",
    address: "address_line_1",
    address_1: "address_line_1",
    address_line_1: "address_line_1",
    street: "address_line_1",
    address_2: "address_line_2",
    address_line_2: "address_line_2",
    language: "preferred_language",
    preferred_language: "preferred_language",
    notes: "notes",
    note: "notes",
  };
  return map[h] ?? "";
}

type Stage = "idle" | "parsed" | "uploading" | "complete" | "failed";

type Summary = {
  imported: number;
  matched: number;
  review: number;
  errored: number;
  processed: number;
};

export function CsvImportForm({ labels }: { labels: Label[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [filename, setFilename] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, ContactField | "">>({});

  const [labelMode, setLabelMode] = useState<"existing" | "new">(
    labels.length > 0 ? "existing" : "new"
  );
  const [labelId, setLabelId] = useState<string>(labels[0]?.id ?? "");
  const [customLabelName, setCustomLabelName] = useState<string>("");

  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mappedFieldsInUse = useMemo(() => {
    return new Set(Object.values(mapping).filter(Boolean) as ContactField[]);
  }, [mapping]);

  const hasEmailOrPhone =
    mappedFieldsInUse.has("email") || mappedFieldsInUse.has("phone");

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFilename(f.name);
    setErrorMessage(null);
    setSummary(null);

    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (result) => {
        const parsedHeaders = (result.meta.fields ?? []).filter(Boolean);
        const parsedRows = result.data;
        setHeaders(parsedHeaders);
        setRows(parsedRows);

        const guessed: Record<string, ContactField | ""> = {};
        for (const h of parsedHeaders) guessed[h] = guessField(h);
        setMapping(guessed);

        setStage("parsed");
      },
      error: (err) => {
        setErrorMessage(`Failed to parse CSV: ${err.message}`);
        setStage("idle");
      },
    });
  }

  function updateMapping(header: string, field: ContactField | "") {
    setMapping((prev) => ({ ...prev, [header]: field }));
  }

  function buildRowsForUpload(): Record<string, unknown>[] {
    const reverse: Record<string, string> = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (field) reverse[field] = header;
    }
    return rows.map((raw) => {
      const out: Record<string, unknown> = {};
      for (const [field, header] of Object.entries(reverse)) {
        out[field] = raw[header] ?? null;
      }
      return out;
    });
  }

  async function startImport() {
    if (!hasEmailOrPhone) {
      setErrorMessage("You must map at least one column to either 'email' or 'phone'.");
      return;
    }
    if (labelMode === "existing" && !labelId) {
      setErrorMessage("Pick a label.");
      return;
    }
    if (labelMode === "new" && !customLabelName.trim()) {
      setErrorMessage("Type a label name.");
      return;
    }

    setStage("uploading");
    setErrorMessage(null);
    setSummary({ imported: 0, matched: 0, review: 0, errored: 0, processed: 0 });

    const payload = buildRowsForUpload();
    setProgress({ done: 0, total: payload.length });

    // 1. Create the import record.
    const createRes = await fetch("/api/contacts/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        rowCount: payload.length,
        labelId: labelMode === "existing" ? labelId : null,
        customLabelName: labelMode === "new" ? customLabelName.trim() : null,
      }),
    });

    if (!createRes.ok) {
      const err = await safeJson(createRes);
      setErrorMessage(err.error ?? "Failed to create import");
      setStage("failed");
      return;
    }

    const { import: importRow } = (await createRes.json()) as {
      import: { id: string };
    };
    const importId = importRow.id;

    // 2. Upload batches.
    const totals: Summary = {
      imported: 0,
      matched: 0,
      review: 0,
      errored: 0,
      processed: 0,
    };

    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
      const batch = payload.slice(i, i + BATCH_SIZE);
      const res = await fetch(`/api/contacts/imports/${importId}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: batch, batchOffset: i }),
      });

      if (!res.ok) {
        const err = await safeJson(res);
        setErrorMessage(err.error ?? "Batch failed");
        await fetch(`/api/contacts/imports/${importId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ failed: true, errorLog: { message: err.error } }),
        });
        setStage("failed");
        return;
      }

      const result = (await res.json()) as Summary;
      totals.imported += result.imported;
      totals.matched += result.matched;
      totals.review += result.review;
      totals.errored += result.errored;
      totals.processed += result.processed;
      setSummary({ ...totals });
      setProgress({ done: i + batch.length, total: payload.length });
    }

    // 3. Mark complete.
    await fetch(`/api/contacts/imports/${importId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    setStage("complete");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-card p-4">
        <h2 className="font-semibold mb-2">1. Choose CSV file</h2>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="text-sm file:mr-3 file:rounded file:border file:border-border file:bg-muted file:px-3 file:py-1 file:text-sm file:text-foreground hover:file:bg-muted/80"
          disabled={stage === "uploading"}
        />
        {filename && (
          <p className="text-xs text-muted-foreground mt-2">
            {filename} — {rows.length.toLocaleString()} rows parsed
          </p>
        )}
      </div>

      {stage !== "idle" && headers.length > 0 && (
        <div className="rounded-md border bg-card p-4">
          <h2 className="font-semibold mb-3">2. Map columns to contact fields</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Required: map at least one column to either{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">email</code> or{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">phone</code>. Unmapped columns
            are ignored.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {headers.map((h) => (
              <label key={h} className="text-sm flex items-center gap-2">
                <span className="font-mono text-xs px-2 py-1 bg-muted text-foreground rounded min-w-[140px] truncate">
                  {h}
                </span>
                <span className="text-muted-foreground">→</span>
                <select
                  className="border border-input bg-background text-foreground rounded px-2 py-1 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-ring"
                  value={mapping[h] ?? ""}
                  onChange={(e) =>
                    updateMapping(h, e.target.value as ContactField | "")
                  }
                  disabled={stage === "uploading"}
                >
                  <option value="">(ignore)</option>
                  {CONTACT_FIELDS.map((f) => (
                    <option key={f} value={f} disabled={mappedFieldsInUse.has(f) && mapping[h] !== f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {!hasEmailOrPhone && (
            <p className="text-xs text-destructive mt-3">
              You must map at least one column to email or phone.
            </p>
          )}
        </div>
      )}

      {stage !== "idle" && headers.length > 0 && (
        <div className="rounded-md border bg-card p-4">
          <h2 className="font-semibold mb-3">3. Apply a label to every row</h2>
          <div className="flex gap-4 mb-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="label-mode"
                value="existing"
                checked={labelMode === "existing"}
                onChange={() => setLabelMode("existing")}
                disabled={stage === "uploading" || labels.length === 0}
                className="accent-primary"
              />
              Use existing
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="label-mode"
                value="new"
                checked={labelMode === "new"}
                onChange={() => setLabelMode("new")}
                disabled={stage === "uploading"}
                className="accent-primary"
              />
              Create new
            </label>
          </div>

          {labelMode === "existing" ? (
            <select
              className="border border-input bg-background text-foreground rounded px-2 py-1.5 text-sm w-full max-w-md focus:outline-none focus:ring-2 focus:ring-ring"
              value={labelId}
              onChange={(e) => setLabelId(e.target.value)}
              disabled={stage === "uploading"}
            >
              <option value="">— pick a label —</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.category ? ` (${l.category})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="e.g. Send 2026 Cape Town"
              value={customLabelName}
              onChange={(e) => setCustomLabelName(e.target.value)}
              className="border border-input bg-background text-foreground placeholder:text-muted-foreground rounded px-2 py-1.5 text-sm w-full max-w-md focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={stage === "uploading"}
            />
          )}
        </div>
      )}

      {stage !== "idle" && headers.length > 0 && (
        <div className="rounded-md border bg-card p-4">
          <h2 className="font-semibold mb-3">4. Import</h2>
          {errorMessage && (
            <p className="text-sm text-destructive mb-3">{errorMessage}</p>
          )}

          {summary && (
            <div className="mb-3 text-sm space-y-1">
              <p>
                Processed {progress.done.toLocaleString()} of{" "}
                {progress.total.toLocaleString()}
              </p>
              <div className="w-full h-2 bg-muted rounded overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${
                      progress.total ? (progress.done / progress.total) * 100 : 0
                    }%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                New: {summary.imported} · Matched: {summary.matched} · Review:{" "}
                {summary.review} · Errored: {summary.errored}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={startImport}
            disabled={stage === "uploading" || rows.length === 0}
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
          >
            {stage === "uploading"
              ? "Importing…"
              : stage === "complete"
              ? "Import complete"
              : "Start import"}
          </button>

          {stage === "complete" && summary && (
            <p className="text-sm text-grass-text mt-3">
              ✓ Imported {summary.imported} new, matched {summary.matched} existing,
              {summary.review > 0 ? ` queued ${summary.review} for review,` : ""}{" "}
              errored on {summary.errored}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

async function safeJson(res: Response): Promise<{ error?: string }> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return {};
  }
}
