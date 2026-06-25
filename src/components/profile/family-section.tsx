"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Heart,
  Baby,
  UserPlus,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import type {
  FamilySnapshot,
  FamilyChild,
  FamilyPartnership,
  IncomingLinkRequest,
  LinkableUser,
  PartnerStatus,
} from "@/services/family";

const STATUS_OPTIONS: { value: PartnerStatus; label: string }[] = [
  { value: "engaged", label: "Engaged" },
  { value: "married", label: "Married" },
  { value: "separated", label: "Separated" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
];

const inputCls =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y) return "—";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function call(
  url: string,
  method: string,
  body?: unknown
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || "Something went wrong." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error. Please try again." };
  }
}

export function FamilySection({ initial }: { initial: FamilySnapshot }) {
  const router = useRouter();
  const { partnership, outgoingPending, incomingRequests, children } = initial;

  return (
    <div className="rounded-xl border p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 text-[hsl(340_70%_62%)]" />
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Family
        </h3>
      </div>

      {incomingRequests.map((req) => (
        <IncomingRequest key={req.id} req={req} onDone={() => router.refresh()} />
      ))}

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Spouse / Partner
        </p>
        {partnership ? (
          <PartnershipView partnership={partnership} onDone={() => router.refresh()} />
        ) : outgoingPending ? (
          <OutgoingPending p={outgoingPending} onDone={() => router.refresh()} />
        ) : incomingRequests.length === 0 ? (
          <LinkSpouse onDone={() => router.refresh()} />
        ) : null}
      </div>

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Children
          </p>
          {partnership && (
            <span className="text-[11px] text-muted-foreground">
              Shared with {partnership.partnerName}
            </span>
          )}
        </div>
        <ChildrenList children={children} onDone={() => router.refresh()} />
      </div>
    </div>
  );
}

// ── Incoming spouse-link request ───────────────────────────

function IncomingRequest({
  req,
  onDone,
}: {
  req: IncomingLinkRequest;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function respond(accept: boolean) {
    setLoading(true);
    setError(null);
    const r = await call("/api/family/partnership/confirm", "POST", {
      id: req.id,
      accept,
    });
    setLoading(false);
    if (!r.ok) return setError(r.error ?? null);
    onDone();
  }

  return (
    <div className="rounded-lg border border-[hsl(340_60%_40%/0.4)] bg-[hsl(340_60%_50%/0.06)] p-3 space-y-2">
      <p className="text-sm">
        <span className="font-semibold">{req.fromName}</span> listed you as their
        spouse{req.anniversary_date ? ` (anniversary ${fmtDate(req.anniversary_date)})` : ""}.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={loading} onClick={() => respond(true)}>
          <Check className="mr-1 h-3.5 w-3.5" /> Confirm
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => respond(false)}
        >
          <X className="mr-1 h-3.5 w-3.5" /> Decline
        </Button>
      </div>
    </div>
  );
}

// ── Confirmed partnership ──────────────────────────────────

function PartnershipView({
  partnership,
  onDone,
}: {
  partnership: FamilyPartnership;
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [anniversary, setAnniversary] = useState(
    partnership.anniversary_date ?? ""
  );
  const [status, setStatus] = useState<PartnerStatus>(partnership.status);
  const [name, setName] = useState(partnership.partnerName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setLoading(true);
    setError(null);
    const r = await call("/api/family/partnership", "PATCH", {
      id: partnership.id,
      anniversaryDate: anniversary || null,
      status,
      partnerName: partnership.partnerIsUser ? undefined : name,
    });
    setLoading(false);
    if (!r.ok) return setError(r.error ?? null);
    setEditing(false);
    onDone();
  }

  async function unlink() {
    if (
      !confirm(
        `Remove the link with ${partnership.partnerName}? Any shared children stay on your profile.`
      )
    )
      return;
    setLoading(true);
    const r = await call("/api/family/partnership", "DELETE", {
      id: partnership.id,
    });
    setLoading(false);
    if (!r.ok) return setError(r.error ?? null);
    onDone();
  }

  if (editing) {
    return (
      <div className="rounded-lg border p-3 space-y-3">
        {!partnership.partnerIsUser && (
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Spouse name
            </span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Anniversary
          </span>
          <input
            type="date"
            className={inputCls}
            value={anniversary.slice(0, 10)}
            onChange={(e) => setAnniversary(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Status
          </span>
          <select
            className={inputCls}
            value={status}
            onChange={(e) => setStatus(e.target.value as PartnerStatus)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" disabled={loading} onClick={save}>
            {loading ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">
              {partnership.partnerName}
            </span>
            <Badge variant="secondary" className="capitalize">
              {partnership.status}
            </Badge>
            {!partnership.partnerIsUser && (
              <span className="text-[11px] text-muted-foreground">(not on the Hub)</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Anniversary · {fmtDate(partnership.anniversary_date)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={unlink} disabled={loading}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
    </div>
  );
}

function OutgoingPending({
  p,
  onDone,
}: {
  p: FamilyPartnership;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  async function cancel() {
    setLoading(true);
    await call("/api/family/partnership", "DELETE", { id: p.id });
    setLoading(false);
    onDone();
  }
  return (
    <div className="rounded-lg border border-dashed p-3 flex items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">
        Waiting for <span className="font-medium text-foreground">{p.partnerName}</span>{" "}
        to confirm the link.
      </p>
      <Button variant="ghost" size="sm" disabled={loading} onClick={cancel}>
        Cancel
      </Button>
    </div>
  );
}

// ── Link a new spouse ──────────────────────────────────────

function LinkSpouse({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"user" | "manual">("user");
  const [picked, setPicked] = useState<LinkableUser | null>(null);
  const [manualName, setManualName] = useState("");
  const [anniversary, setAnniversary] = useState("");
  const [status, setStatus] = useState<PartnerStatus>("married");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Link your spouse
      </Button>
    );
  }

  async function submit() {
    setError(null);
    if (mode === "user" && !picked) return setError("Pick a Hub member to link.");
    if (mode === "manual" && !manualName.trim())
      return setError("Enter your spouse's name.");

    setLoading(true);
    const r = await call("/api/family/partnership", "POST", {
      partnerUserId: mode === "user" ? picked?.id : null,
      partnerName: mode === "manual" ? manualName.trim() : null,
      anniversaryDate: anniversary || null,
      status,
    });
    setLoading(false);
    if (!r.ok) return setError(r.error ?? null);
    onDone();
  }

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex gap-1 rounded-lg bg-muted/40 p-1 text-xs">
        <button
          type="button"
          onClick={() => setMode("user")}
          className={`flex-1 rounded-md px-2 py-1 ${mode === "user" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
        >
          Hub member
        </button>
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={`flex-1 rounded-md px-2 py-1 ${mode === "manual" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
        >
          Not on the Hub
        </button>
      </div>

      {mode === "user" ? (
        <UserPicker picked={picked} onPick={setPicked} />
      ) : (
        <input
          className={inputCls}
          placeholder="Spouse's full name"
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Anniversary
          </span>
          <input
            type="date"
            className={inputCls}
            value={anniversary}
            onChange={(e) => setAnniversary(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Status
          </span>
          <select
            className={inputCls}
            value={status}
            onChange={(e) => setStatus(e.target.value as PartnerStatus)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mode === "user" && (
        <p className="text-[11px] text-muted-foreground">
          They&apos;ll get a request to confirm the link before it goes live.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={loading} onClick={submit}>
          {loading ? "Saving…" : "Link spouse"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function UserPicker({
  picked,
  onPick,
}: {
  picked: LinkableUser | null;
  onPick: (u: LinkableUser | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkableUser[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (picked) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/family/search-users?q=${encodeURIComponent(query.trim())}`
        );
        const data = await res.json().catch(() => ({}));
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, picked]);

  if (picked) {
    return (
      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{picked.name}</div>
          {picked.hint && (
            <div className="text-[11px] text-muted-foreground">{picked.hint}</div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => onPick(null)}>
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        className={inputCls}
        placeholder="Search by name or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {searching && (
        <p className="text-[11px] text-muted-foreground px-1">Searching…</p>
      )}
      {results.length > 0 && (
        <div className="rounded-md border divide-y max-h-44 overflow-y-auto">
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                onPick(u);
                setResults([]);
                setQuery("");
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/50"
            >
              <span className="text-sm truncate">{u.name}</span>
              {u.hint && (
                <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
                  {u.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Children ───────────────────────────────────────────────

function ChildrenList({
  children,
  onDone,
}: {
  children: FamilyChild[];
  onDone: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-2">
      {children.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No children added yet.</p>
      )}
      {children.map((c) => (
        <ChildRow key={c.id} child={c} onDone={onDone} />
      ))}

      {adding ? (
        <ChildForm
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            onDone();
          }}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Baby className="mr-1.5 h-3.5 w-3.5" /> Add a child
        </Button>
      )}
    </div>
  );
}

function ChildRow({ child, onDone }: { child: FamilyChild; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);

  async function remove() {
    if (!confirm(`Remove ${child.full_name}?`)) return;
    setLoading(true);
    await call("/api/family/children", "DELETE", { id: child.id });
    setLoading(false);
    onDone();
  }

  if (editing) {
    return (
      <ChildForm
        child={child}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onDone();
        }}
      />
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{child.full_name}</div>
        <div className="text-[11px] text-muted-foreground">
          {child.birth_date ? fmtDate(child.birth_date) : "No birthday set"}
          {child.notes ? ` · ${child.notes}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={remove} disabled={loading}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ChildForm({
  child,
  onCancel,
  onSaved,
}: {
  child?: FamilyChild;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(child?.full_name ?? "");
  const [birthDate, setBirthDate] = useState(child?.birth_date?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(child?.notes ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!fullName.trim()) return setError("Enter the child's name.");
    setLoading(true);
    const r = child
      ? await call("/api/family/children", "PATCH", {
          id: child.id,
          fullName,
          birthDate: birthDate || null,
          notes,
        })
      : await call("/api/family/children", "POST", {
          fullName,
          birthDate: birthDate || null,
          notes,
        });
    setLoading(false);
    if (!r.ok) return setError(r.error ?? null);
    onSaved();
  }

  return (
    <div className="rounded-md border p-3 space-y-2">
      <input
        className={inputCls}
        placeholder="Full name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          className={inputCls}
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={loading} onClick={save}>
          {loading ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" disabled={loading} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
