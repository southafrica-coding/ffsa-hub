"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type HubUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

type Role = {
  id: string;
  role_name: string;
  user_id: string | null;
  contact_id: string | null;
  display_name: string | null;
  notes: string | null;
  users: { id: string; first_name: string | null; last_name: string | null } | null;
  contacts: { id: string; first_name: string | null; last_name: string | null } | null;
};

export function RolesRoster({
  eventId,
  roles,
  users,
}: {
  eventId: string;
  roles: Role[];
  users: HubUser[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [assignMode, setAssignMode] = useState<"user" | "name">("user");
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function assigneeLabel(r: Role): string {
    if (r.users) return `${r.users.first_name ?? ""} ${r.users.last_name ?? ""}`.trim();
    if (r.contacts)
      return `${r.contacts.first_name ?? ""} ${r.contacts.last_name ?? ""}`.trim();
    return r.display_name ?? "—";
  }

  async function addRole() {
    if (!roleName.trim()) {
      setErr("Role name is required.");
      return;
    }
    if (assignMode === "user" && !userId) {
      setErr("Pick a Hub user.");
      return;
    }
    if (assignMode === "name" && !displayName.trim()) {
      setErr("Type a name.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/events/${eventId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roleName: roleName.trim(),
        userId: assignMode === "user" ? userId : null,
        displayName: assignMode === "name" ? displayName.trim() : null,
        notes: notes.trim() || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to add role");
      return;
    }
    setAdding(false);
    setRoleName("");
    setUserId("");
    setDisplayName("");
    setNotes("");
    router.refresh();
  }

  async function removeRole(roleId: string) {
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/roles/${roleId}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to delete");
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Roster &amp; roles</CardTitle>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs text-ink hover:underline"
          >
            + Add role
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No roles assigned yet.</p>
        ) : (
          <ul className="space-y-2">
            {roles.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 border p-3"
              >
                <div>
                  <p className="text-sm">
                    <span className="font-medium">{r.role_name}</span>
                    <span className="text-muted-foreground"> · {assigneeLabel(r)}</span>
                    {!r.user_id && !r.contact_id && (
                      <span className="ml-1 text-xs text-muted-foreground">(volunteer)</span>
                    )}
                  </p>
                  {r.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5">{r.notes}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeRole(r.id)}
                  disabled={busy}
                  className="text-xs text-destructive hover:underline shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="border-t pt-3 space-y-2">
            <input
              type="text"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder="Role (e.g. MC, Registration desk, Follow-up team)"
              className="w-full border px-2 py-1.5 text-sm"
              disabled={busy}
            />
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={assignMode === "user"}
                  onChange={() => setAssignMode("user")}
                />
                Hub user
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={assignMode === "name"}
                  onChange={() => setAssignMode("name")}
                />
                Name (volunteer)
              </label>
            </div>
            {assignMode === "user" ? (
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full border px-2 py-1.5 text-sm"
                disabled={busy}
              >
                <option value="">— pick a user —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {`${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Volunteer name"
                className="w-full border px-2 py-1.5 text-sm"
                disabled={busy}
              />
            )}
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="w-full border px-2 py-1.5 text-sm"
              disabled={busy}
            />
            {err && <p className="text-xs text-destructive">{err}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addRole}
                disabled={busy}
                className="px-3 py-1 bg-ink text-white text-xs hover:bg-[var(--ink-bg-hover)] disabled:bg-[color:var(--surface-4)]"
              >
                Save role
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setErr(null);
                }}
                disabled={busy}
                className="px-3 py-1 border text-xs hover:bg-[color:var(--surface-2)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
