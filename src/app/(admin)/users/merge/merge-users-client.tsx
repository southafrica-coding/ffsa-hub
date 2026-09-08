"use client";

// Two slots side by side, and an explicit winner choice.
//
// The contacts merge encodes "the page you're on loses" in the URL. That is
// the wrong default here: an admin lands on whichever duplicate they happened
// to find, and the account that should survive is often the LESS obvious one
// (the one with no application on it). So neither slot is the winner until
// someone says so.

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Candidate = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_active: boolean;
  merged_into_user_id: string | null;
};

type Preview = {
  loser_rows: Record<string, number>;
  shared_programs: Array<{
    program_id: string;
    program: string;
    winner_status: string;
    loser_status: string;
  }>;
};

type Report = {
  moved: Record<string, number>;
  collisions: Array<Record<string, unknown>>;
  leftovers: Array<{ ref: string; rows: number }>;
};

function personName(c: Candidate) {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Unknown";
}

/** Turns "student_billing_plans.user_id" into "Billing plans". */
function friendly(ref: string) {
  const table = ref.split(".")[0];
  const labels: Record<string, string> = {
    enrollments: "Enrolments",
    application_responses: "Applications",
    student_billing_plans: "Billing plans",
    consent_records: "Consent records",
    households: "Households created",
    household_members: "Household memberships",
    user_insurance_policies: "Insurance policies",
    user_roles: "Roles",
    onboarding_invites: "Setup links",
  };
  return labels[table] ?? table.replace(/_/g, " ");
}

function PersonSlot({
  label,
  picked,
  onPick,
  onClear,
  excludeId,
}: {
  label: string;
  picked: Candidate | null;
  onPick: (c: Candidate) => void;
  onClear: () => void;
  excludeId: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);

  useEffect(() => {
    if (picked || search.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const q = search.trim();
      let query = supabase
        .from("users")
        .select("id, first_name, last_name, email, is_active, merged_into_user_id")
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(8);
      if (excludeId) query = query.neq("id", excludeId);
      const { data } = await query;
      if (!cancelled) setResults((data ?? []) as unknown as Candidate[]);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, picked, excludeId, supabase]);

  return (
    <div className="border border-ink bg-white p-4">
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[color:var(--text-tertiary)]">
        {label}
      </div>

      {picked ? (
        <div>
          <div className="text-[15px] font-semibold text-ink">{personName(picked)}</div>
          <div className="text-[13px] text-[color:var(--text-secondary)]">
            {picked.email ?? "no email"}
          </div>
          {!picked.is_active && (
            <div className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">Inactive</div>
          )}
          {picked.merged_into_user_id && (
            <div className="mt-1 text-[12px] font-semibold text-red-700">
              Already merged into another account
            </div>
          )}
          <button
            type="button"
            onClick={onClear}
            className="mt-3 text-[13px] font-semibold underline"
          >
            Choose someone else
          </button>
        </div>
      ) : (
        <div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            className="w-full border border-rule px-3 py-2 text-[14px]"
            aria-label={label}
          />
          {results.length > 0 && (
            <ul className="mt-2 border border-rule">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onPick(c)}
                    className="block w-full px-3 py-2 text-left text-[13px] hover:bg-[#F7F5EE]"
                  >
                    <span className="font-semibold">{personName(c)}</span>
                    <span className="block text-[color:var(--text-secondary)]">
                      {c.email ?? "no email"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function MergeUsersClient({
  initialLoserId,
  viewerId,
}: {
  initialLoserId: string | null;
  viewerId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [left, setLeft] = useState<Candidate | null>(null);
  const [right, setRight] = useState<Candidate | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [validated, setValidated] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  // Deep-linked from a user's page. Fills the right slot only — never
  // presumes which of the two should win.
  useEffect(() => {
    if (!initialLoserId) return;
    (async () => {
      const { data } = await supabase
        .from("users")
        .select("id, first_name, last_name, email, is_active, merged_into_user_id")
        .eq("id", initialLoserId)
        .single();
      if (data) setRight(data as unknown as Candidate);
    })();
  }, [initialLoserId, supabase]);

  const loser = winnerId && left && right ? (winnerId === left.id ? right : left) : null;
  const winner = winnerId && left && right ? (winnerId === left.id ? left : right) : null;

  // Any change to the pair or the winner invalidates what was validated.
  useEffect(() => {
    setPreview(null);
    setValidated(null);
    setConfirmText("");
    setError(null);
  }, [left?.id, right?.id, winnerId]);

  async function call(mode: "preview" | "dryRun" | "merge") {
    if (!winner || !loser) return null;
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch("/api/admin/merge-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winnerId: winner.id, loserId: loser.id, mode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Something went wrong");
        return null;
      }
      return body;
    } catch {
      setError("Could not reach the server");
      return null;
    } finally {
      setBusy(null);
    }
  }

  const blocked =
    loser?.id === viewerId
      ? "You cannot merge away your own account."
      : loser?.merged_into_user_id
        ? "That account has already been merged."
        : null;

  return (
    <div className="max-w-4xl space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <PersonSlot
          label="Account A"
          picked={left}
          onPick={(c) => setLeft(c)}
          onClear={() => {
            setLeft(null);
            setWinnerId(null);
          }}
          excludeId={right?.id ?? null}
        />
        <PersonSlot
          label="Account B"
          picked={right}
          onPick={(c) => setRight(c)}
          onClear={() => {
            setRight(null);
            setWinnerId(null);
          }}
          excludeId={left?.id ?? null}
        />
      </div>

      {left && right && (
        <div className="border border-ink bg-white p-4">
          <div className="mb-1 text-[14px] font-semibold text-ink">
            Which account survives?
          </div>
          <p className="mb-3 text-[13px] text-[color:var(--text-secondary)]">
            This account is kept and everything moves onto it. The other is
            deactivated and locked out of signing in.
          </p>
          <div className="flex flex-wrap gap-4">
            {[left, right].map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-[14px]">
                <input
                  type="radio"
                  name="winner"
                  checked={winnerId === c.id}
                  onChange={() => setWinnerId(c.id)}
                />
                <span>
                  Keep <span className="font-semibold">{personName(c)}</span>{" "}
                  <span className="text-[color:var(--text-secondary)]">({c.email})</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {blocked && (
        <div className="border border-red-700 bg-red-50 p-3 text-[13px] font-semibold text-red-800">
          {blocked}
        </div>
      )}

      {winner && loser && !blocked && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={async () => {
              const body = await call("preview");
              if (body?.preview) setPreview(body.preview as Preview);
            }}
            disabled={busy !== null}
            className="border border-ink bg-white px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
          >
            {busy === "preview" ? "Checking…" : "Show what will move"}
          </button>

          {preview && (
            <div className="border border-ink bg-white p-4">
              <div className="mb-2 text-[14px] font-semibold">
                Moving from {personName(loser)} onto {personName(winner)}
              </div>
              {Object.keys(preview.loser_rows).length === 0 ? (
                <p className="text-[13px] text-[color:var(--text-secondary)]">
                  Nothing to move — that account holds no records.
                </p>
              ) : (
                <ul className="text-[13px]">
                  {Object.entries(preview.loser_rows).map(([ref, n]) => (
                    <li key={ref} className="flex justify-between border-b border-rule py-1">
                      <span>{friendly(ref)}</span>
                      <span className="font-semibold">{n}</span>
                    </li>
                  ))}
                </ul>
              )}

              {preview.shared_programs.length > 0 && (
                <div className="mt-4 border border-amber-600 bg-amber-50 p-3 text-[13px]">
                  <div className="font-semibold">Both accounts are on the same course</div>
                  <ul className="mt-1">
                    {preview.shared_programs.map((p) => (
                      <li key={p.program_id}>
                        {p.program}: keeping {personName(winner)}&rsquo;s enrolment (
                        {p.winner_status}); {personName(loser)}&rsquo;s ({p.loser_status})
                        moves to Removed. Any billing plan on it is re-anchored to the
                        enrolment being kept.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                onClick={async () => {
                  const body = await call("dryRun");
                  if (body?.report) setValidated(body.report as Report);
                }}
                disabled={busy !== null}
                className="mt-4 border border-ink bg-white px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
              >
                {busy === "dryRun" ? "Validating…" : "Validate (changes nothing)"}
              </button>
            </div>
          )}

          {validated && (
            <div className="border border-ink bg-white p-4">
              <div className="text-[14px] font-semibold text-green-800">
                Validated — this merge would succeed.
              </div>
              <p className="mt-1 text-[13px] text-[color:var(--text-secondary)]">
                The whole merge was run against the live data and rolled back.
                Nothing has changed yet.
              </p>

              <p className="mt-3 text-[13px]">
                This cannot be undone automatically. Type <strong>MERGE</strong> to
                confirm.
              </p>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="mt-2 w-40 border border-rule px-3 py-2 text-[14px]"
                aria-label="Type MERGE to confirm"
              />
              <button
                type="button"
                onClick={async () => {
                  if (confirmText !== "MERGE") {
                    setError("Type MERGE to confirm.");
                    return;
                  }
                  const body = await call("merge");
                  if (body?.report) {
                    if (body.warning) alert(body.warning);
                    router.push(`/users/${winner.id}`);
                  }
                }}
                disabled={busy !== null || confirmText !== "MERGE"}
                className="ml-3 border border-ink bg-ink px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {busy === "merge" ? "Merging…" : "Merge accounts"}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="border border-red-700 bg-red-50 p-3 text-[13px] text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
