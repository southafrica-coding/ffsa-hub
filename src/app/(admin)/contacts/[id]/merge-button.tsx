"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { GitMerge } from "lucide-react";

type Candidate = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
};

type Preview = {
  emails: number;
  phones: number;
  labels: number;
  activityEvents: number;
  formSubmissions: number;
  campaignRecipients: number;
  unsubscribes: number;
  eventRoles: number;
  eventOutcomes: number;
  orders: number;
  importErrors: number;
  workflowEnrollments: number;
  workflowEmailSends: number;
  schedulingRequests: number;
  eventRegistrations: number;
  attendanceRecords: number;
  personTypeAssignments: number;
};

export function MergeButton({
  sourceContactId,
  sourceName,
}: {
  sourceContactId: string;
  sourceName: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  // Type-ahead search
  useEffect(() => {
    if (!open || picked || search.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const q = search.trim();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from("contacts") as any)
        .select("id, first_name, last_name, email, phone")
        .neq("id", sourceContactId)
        .or(
          `first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`
        )
        .limit(8);
      if (!cancelled) setResults((data ?? []) as Candidate[]);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, open, picked, sourceContactId, supabase]);

  async function loadPreview(target: Candidate) {
    setPicked(target);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/contacts/${sourceContactId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: target.id, preview: true }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Failed to load preview");
      return;
    }
    setPreview(body.preview as Preview);
  }

  async function confirmMerge() {
    if (!picked) return;
    if (confirmText !== "MERGE") {
      setError("Type MERGE to confirm.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/contacts/${sourceContactId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: picked.id }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Merge failed");
      return;
    }
    // Source is deleted — redirect to the surviving contact.
    router.push(`/contacts/${body.targetId}`);
    router.refresh();
  }

  function reset() {
    setOpen(false);
    setSearch("");
    setResults([]);
    setPicked(null);
    setPreview(null);
    setError(null);
    setConfirmText("");
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <GitMerge className="h-3.5 w-3.5 mr-1.5" />
        Merge into another contact
      </Button>

      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !busy && reset()}
        >
          <div
            className="bg-card text-card-foreground border max-w-lg w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-1">
              Merge {sourceName} into another contact
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              All of {sourceName}&apos;s identifiers, labels, activity, and
              history will move to the contact you pick.{" "}
              <span className="text-foreground font-medium">{sourceName}</span>{" "}
              will be deleted. The target&apos;s name/demographic fields stay
              as-is.
            </p>

            {!picked ? (
              <>
                <Input
                  autoFocus
                  placeholder="Search by name, email, or phone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="mb-3"
                />
                {results.length > 0 && (
                  <div className="space-y-1 max-h-72 overflow-y-auto">
                    {results.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => loadPreview(c)}
                        className="w-full text-left border bg-muted/30 hover:bg-muted px-3 py-2"
                      >
                        <p className="text-sm font-medium">
                          {c.first_name} {c.last_name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[c.email, c.phone].filter(Boolean).join(" · ") ||
                            "no contact info"}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
                {search.trim().length >= 2 && results.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No matches.
                  </p>
                )}
              </>
            ) : (
              <>
                <div className=" border bg-muted/30 px-3 py-2 mb-4">
                  <p className="text-sm font-medium">
                    Target: {picked.first_name} {picked.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[picked.email, picked.phone].filter(Boolean).join(" · ")}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(null);
                      setPreview(null);
                      setConfirmText("");
                    }}
                    disabled={busy}
                    className="text-xs text-muted-foreground hover:text-foreground mt-2"
                  >
                    ← Pick a different target
                  </button>
                </div>

                {preview && (
                  <div className="text-sm space-y-1 mb-4">
                    <p className="text-xs text-muted-foreground mb-1">
                      Moving from {sourceName} → target:
                    </p>
                    <PreviewLine label="Emails" value={preview.emails} />
                    <PreviewLine label="Phones" value={preview.phones} />
                    <PreviewLine label="Labels" value={preview.labels} />
                    <PreviewLine
                      label="Activity events"
                      value={preview.activityEvents}
                    />
                    <PreviewLine
                      label="Form submissions"
                      value={preview.formSubmissions}
                    />
                    <PreviewLine
                      label="Campaign recipients"
                      value={preview.campaignRecipients}
                    />
                    <PreviewLine
                      label="Unsubscribes"
                      value={preview.unsubscribes}
                    />
                    <PreviewLine label="Event roles" value={preview.eventRoles} />
                    <PreviewLine
                      label="Event registrations"
                      value={preview.eventRegistrations}
                    />
                    <PreviewLine
                      label="Workflow enrollments"
                      value={preview.workflowEnrollments}
                    />
                    <PreviewLine
                      label="Workflow emails sent"
                      value={preview.workflowEmailSends}
                    />
                    <PreviewLine
                      label="Scheduling requests"
                      value={preview.schedulingRequests}
                    />
                    <PreviewLine label="Orders" value={preview.orders} />
                  </div>
                )}

                <label className="block text-xs text-muted-foreground mb-1">
                  Type{" "}
                  <span className="font-mono font-semibold text-foreground">
                    MERGE
                  </span>{" "}
                  to confirm:
                </label>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  disabled={busy}
                />
              </>
            )}

            {error && <p className="text-sm text-destructive mt-3">{error}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={reset}
                disabled={busy}
              >
                Cancel
              </Button>
              {picked && (
                <Button
                  type="button"
                  size="sm"
                  onClick={confirmMerge}
                  disabled={busy || confirmText !== "MERGE"}
                  className="bg-white border border-destructive text-destructive hover:bg-white"
                >
                  {busy ? "Merging…" : "Merge contacts"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PreviewLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}
