"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ErrorRow = {
  id: string;
  row_index: number;
  raw_row: Record<string, unknown>;
  error_message: string;
  error_code: string;
  status: "pending" | "resolved" | "dismissed";
  resolved_contact_id: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

const ERROR_CODE_LABELS: Record<string, string> = {
  missing_contact_method: "No email or phone",
  no_valid_identifier: "Neither identifier valid",
  invalid_phone_format: "Bad phone format",
  invalid_email_format: "Bad email format",
  duplicate_key: "Duplicate",
  dedup_query_failed: "Dedup query failed",
  db_insert_failed: "DB insert failed",
  transient: "Transient error",
  reconstructed_unknown: "Unknown (reconstructed)",
  unknown: "Unknown",
};

export function ErrorsList({
  importId,
  errors,
  status,
}: {
  importId: string;
  errors: ErrorRow[];
  status: "pending" | "resolved" | "dismissed" | "all";
}) {
  const router = useRouter();
  const [openRetryFor, setOpenRetryFor] = useState<ErrorRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function handleDismiss(errorId: string) {
    if (
      !confirm("Dismiss this row? You won't see it on the pending list anymore.")
    ) {
      return;
    }
    setBusy(errorId);
    const res = await fetch(
      `/api/contacts/imports/${importId}/errors/${errorId}/dismiss`,
      { method: "POST" }
    );
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Dismiss failed");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 text-right">Row</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Error</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {errors.map((e) => {
              const r = e.raw_row;
              const first = (r.first_name as string) ?? "";
              const last = (r.last_name as string) ?? "";
              const email = (r.email as string) ?? "";
              const phone = (r.phone as string) ?? "";
              const name = `${first} ${last}`.trim() || "—";
              return (
                <TableRow key={e.id}>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {e.row_index + 1}
                  </TableCell>
                  <TableCell>{name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {email || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {phone || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    <div className="flex flex-col gap-1">
                      <ErrorCodeBadge code={e.error_code} />
                      <span
                        className="text-xs text-muted-foreground truncate"
                        title={e.error_message}
                      >
                        {e.error_message}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {e.status === "pending" ? (
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          onClick={() => setOpenRetryFor(e)}
                          disabled={busy === e.id}
                          className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                        >
                          Fix &amp; retry
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDismiss(e.id)}
                          disabled={busy === e.id}
                          className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : e.status === "resolved" ? (
                      <Link
                        href={`/contacts/${e.resolved_contact_id}`}
                        className="text-xs text-grass-text hover:underline"
                      >
                        View contact →
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        dismissed{" "}
                        {e.resolved_at &&
                          new Date(e.resolved_at).toLocaleDateString()}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {openRetryFor && (
        <RetryModal
          importId={importId}
          error={openRetryFor}
          onClose={() => setOpenRetryFor(null)}
          onSuccess={() => {
            setOpenRetryFor(null);
            router.refresh();
          }}
        />
      )}

      {status === "pending" && errors.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          Showing {errors.length} pending row{errors.length === 1 ? "" : "s"}.
        </p>
      )}
    </>
  );
}

function ErrorCodeBadge({ code }: { code: string }) {
  const label = ERROR_CODE_LABELS[code] ?? code;
  const cls =
    code === "missing_contact_method" || code === "no_valid_identifier"
      ? "bg-yellow-dim text-amber border-amber-border"
      : code === "duplicate_key"
      ? "bg-ink/15 text-electric border-blue-500/20"
      : code === "transient"
      ? "bg-purple-500/15 text-purple-400 border-purple-500/20"
      : code === "reconstructed_unknown"
      ? "bg-muted text-muted-foreground border-border"
      : "bg-white text-destructive border-destructive";
  return (
    <span
      className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function RetryModal({
  importId,
  error,
  onClose,
  onSuccess,
}: {
  importId: string;
  error: ErrorRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const r = error.raw_row;
  const [firstName, setFirstName] = useState(((r.first_name as string) ?? ""));
  const [lastName, setLastName] = useState(((r.last_name as string) ?? ""));
  const [email, setEmail] = useState(((r.email as string) ?? ""));
  const [phone, setPhone] = useState(((r.phone as string) ?? ""));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSubmit() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(
      `/api/contacts/imports/${importId}/errors/${error.id}/retry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          email: email.trim() || null,
          phone: phone.trim() || null,
        }),
      }
    );
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(body.error ?? "Retry failed");
      return;
    }
    if (body.action === "queued_for_review") {
      setMsg(
        "Saved — but the contact matched two different existing contacts (one by email, one by phone). It's now in the dedup review queue."
      );
      setTimeout(onSuccess, 1500);
      return;
    }
    onSuccess();
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="bg-card text-card-foreground border rounded-lg max-w-md w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-1">Fix &amp; retry row {error.row_index + 1}</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Original error: <span className="font-mono">{error.error_message}</span>
        </p>

        <div className="space-y-3">
          <Field label="First name">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={busy}
              className="w-full border border-input bg-background text-foreground rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Last name">
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={busy}
              className="w-full border border-input bg-background text-foreground rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Email" hint="Required if no phone">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              className="w-full border border-input bg-background text-foreground rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="Phone" hint="International format with +">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
              placeholder="+27821234567"
              className="w-full border border-input bg-background text-foreground rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            />
          </Field>
        </div>

        {msg && (
          <p className="mt-4 text-sm text-amber">{msg}</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-input bg-background text-foreground text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || (!email.trim() && !phone.trim())}
            className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Save & retry"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground block mb-1">
        {label}
        {hint && (
          <span className="text-muted-foreground/70 ml-2">— {hint}</span>
        )}
      </span>
      {children}
    </label>
  );
}
