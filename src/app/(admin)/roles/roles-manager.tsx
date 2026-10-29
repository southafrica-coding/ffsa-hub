"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Pencil,
  Trash2,
  Users,
  Lock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Masthead } from "@/components/ffsa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";
import { ConfirmAccessDialog } from "@/components/confirm-access-dialog";
import type { Permission, PermissionsByModule } from "@/services/permissions";
import type { RoleMember } from "@/services/roles";

type Role = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  is_system: boolean;
};

const MODULE_ORDER = [
  "contacts", "communications", "events", "schools", "teams",
  "finance", "mission", "prayer-room", "records-library", "administration",
];
const MODULE_LABELS: Record<string, string> = {
  contacts: "Contacts",
  communications: "Communications",
  events: "Events",
  schools: "Training",
  teams: "Teams",
  finance: "Finance",
  mission: "Mission",
  "prayer-room": "Prayer Room",
  "records-library": "Records Library",
  administration: "Administration",
  bookings: "Space Bookings",
  vehicles: "Rent a Vehicle",
  "org-chart": "Org Chart",
  ministry: "Ministry",
  legal: "Legal",
  okrs: "OKRs",
  "brand-kit": "Brand Kit",
};

export function RolesManager({
  roles,
  permissionsByModule,
  memberCounts,
  roleMembers,
  bundles,
  callerKeys,
  isSuperAdmin,
  canGrantRecordsLibrary = true,
}: {
  roles: Role[];
  permissionsByModule: PermissionsByModule;
  memberCounts: Record<string, number>;
  /** role_id -> holders. Empty for non-super-admins, who see plain counts. */
  roleMembers: Record<string, RoleMember[]>;
  bundles: Record<string, string[]>;
  callerKeys: string[];
  isSuperAdmin: boolean;
  canGrantRecordsLibrary?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // null = list view; "new" = creating; Role = editing that role
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBuiltIns, setShowBuiltIns] = useState(false);
  // The role whose holder list is open, or null.
  const [viewingMembers, setViewingMembers] = useState<Role | null>(null);

  const callerKeySet = useMemo(() => new Set(callerKeys), [callerKeys]);

  const permById = useMemo(() => {
    const m = new Map<string, Permission>();
    for (const mod of Object.keys(permissionsByModule)) {
      for (const p of permissionsByModule[mod]) m.set(p.id, p);
    }
    return m;
  }, [permissionsByModule]);

  const orderedModules = useMemo(() => {
    const present = Object.keys(permissionsByModule);
    const ordered = MODULE_ORDER.filter((m) => present.includes(m));
    const extra = present.filter((m) => !MODULE_ORDER.includes(m));
    return [...ordered, ...extra];
  }, [permissionsByModule]);

  function openNew() {
    setDisplayName("");
    setDescription("");
    setSelected(new Set());
    setEditing("new");
  }

  function openEdit(role: Role) {
    setDisplayName(role.display_name);
    setDescription(role.description ?? "");
    setSelected(new Set(bundles[role.id] ?? []));
    setEditing(role);
  }

  function togglePerm(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function canUse(p: Permission) {
    // A General Admin can bundle every capability except Records Library
    // access, which stays with the super admin.
    if (isSuperAdmin && (canGrantRecordsLibrary || p.key !== "records_library.manage")) {
      return true;
    }
    return callerKeySet.has(p.key);
  }

  // Editing an existing role changes access for everyone who holds it, and
  // deleting one takes that access away — both wait on a confirmation.
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);

  function capabilityChanges(role: Role) {
    const before = new Set(bundles[role.id] ?? []);
    const label = (id: string) => {
      const p = permById.get(id);
      return p ? `${MODULE_LABELS[p.module] ?? p.module} · ${p.display_name}` : "Capability";
    };
    return {
      added: Array.from(selected).filter((id) => !before.has(id)).map(label),
      removed: Array.from(before).filter((id) => !selected.has(id)).map(label),
    };
  }

  function requestSave() {
    if (!displayName.trim()) {
      toast.error("Give the role a name");
      return;
    }
    // A new role isn't held by anyone yet, so creating it changes nobody's access.
    if (editing === "new") {
      void save();
      return;
    }
    setConfirmingSave(true);
  }

  async function save() {
    const name = displayName.trim();
    if (!name) {
      toast.error("Give the role a name");
      return;
    }
    const isNew = editing === "new";
    const url = isNew ? "/api/admin/roles" : `/api/admin/roles/${(editing as Role).id}`;
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: name,
          description: description.trim() || null,
          permission_ids: Array.from(selected),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Could not save the role");
        return;
      }
      toast.success(isNew ? `Role “${name}” created` : `Role “${name}” updated`);
      setEditing(null);
      startTransition(() => router.refresh());
    } catch {
      toast.error("Could not save the role — check your connection and try again.");
    } finally {
      setBusy(false);
      setConfirmingSave(false);
    }
  }

  async function remove(role: Role) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/roles/${role.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Could not delete the role");
        return;
      }
      toast.success(`Role “${role.display_name}” deleted`);
      startTransition(() => router.refresh());
    } catch {
      toast.error("Could not delete the role — check your connection and try again.");
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  // ───────── Editor view ─────────
  if (editing !== null) {
    const isNew = editing === "new";
    return (
      <div className="ffsa-screen">
        <Masthead
          context="System settings · roles"
          title={isNew ? "New role" : `Edit ${(editing as Role).display_name}`}
          actions={
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="shrink-0 border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone"
            >
              ← Back
            </button>
          }
        />
        <div className="max-w-3xl space-y-6 px-5 py-6 md:px-8 md:py-7">

        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Title</Label>
            <Input
              id="role-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. DTS Leader"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-desc">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="role-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this job title is for"
              rows={2}
            />
          </div>
        </div>

        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div>
            <p className="text-sm font-medium">Capabilities</p>
            <p className="text-sm text-muted-foreground">
              Everything this title unlocks. Stack it with others on a person — access is the
              combined total.
            </p>
          </div>
          <div className="space-y-5">
            {orderedModules.map((mod) => (
              <div key={mod} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {MODULE_LABELS[mod] ?? mod}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {permissionsByModule[mod].map((p) => {
                    const usable = canUse(p);
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm ${
                          usable
                            ? "cursor-pointer hover:bg-accent/50"
                            : "opacity-50 cursor-not-allowed"
                        }`}
                      >
                        <Checkbox
                          checked={selected.has(p.id)}
                          disabled={!usable}
                          onCheckedChange={() => usable && togglePerm(p.id)}
                        />
                        <span className="flex-1">{p.display_name}</span>
                        {!usable && <Lock className="h-3 w-3 text-muted-foreground" />}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={requestSave} disabled={isPending || busy}>
            {isNew ? "Create role" : "Save changes"}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          {!isSuperAdmin && (
            <span className="ml-auto text-xs text-muted-foreground">
              Greyed-out capabilities are ones you don&apos;t hold yourself.
            </span>
          )}
        </div>
        </div>

        {!isNew && confirmingSave && (() => {
          const role = editing as Role;
          const holders = memberCounts[role.id] ?? 0;
          const { added, removed } = capabilityChanges(role);
          return (
            <ConfirmAccessDialog
              open
              title={`Save changes to “${role.display_name}”?`}
              confirmLabel="Save changes"
              busy={busy}
              onConfirm={save}
              onCancel={() => setConfirmingSave(false)}
            >
              <p>
                {holders === 0
                  ? "Nobody holds this role yet."
                  : `This changes access straight away for the ${holders} ${
                      holders === 1 ? "person" : "people"
                    } who hold it.`}
              </p>
              {added.length + removed.length === 0 ? (
                <p>The capabilities are unchanged — only the name or description.</p>
              ) : (
                <ul className="max-h-[40vh] space-y-1 overflow-y-auto">
                  {added.map((l) => (
                    <li key={`+${l}`}>
                      <strong>Adds</strong> {l}
                    </li>
                  ))}
                  {removed.map((l) => (
                    <li key={`-${l}`}>
                      <strong>Removes</strong> {l}
                    </li>
                  ))}
                </ul>
              )}
            </ConfirmAccessDialog>
          );
        })()}
      </div>
    );
  }

  // ───────── List view ─────────
  const jobTitles = roles.filter((r) => !r.is_system);
  const superAdmin = roles.find((r) => r.name === "super_admin");
  const otherBuiltIns = roles.filter((r) => r.is_system && r.name !== "super_admin");

  const roleCard = (role: Role) => {
    const bundle = bundles[role.id] ?? [];
    const modules = Array.from(
      new Set(bundle.map((id) => permById.get(id)?.module).filter(Boolean))
    ) as string[];
    const count = memberCounts[role.id] ?? 0;
    const members = roleMembers[role.id] ?? [];
    return (
      <div
        key={role.id}
        className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{role.display_name}</span>
            {role.is_system && (
              <Badge variant="outline" className="text-[10px]">
                System
              </Badge>
            )}
            {members.length > 0 ? (
              // Super admins can open the list — "who can see everything?"
              // should be one click, not a database query.
              <button
                type="button"
                onClick={() => setViewingMembers(role)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                title={`See who holds ${role.display_name}`}
              >
                <Users className="h-3 w-3" />
                {count}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                {count}
              </span>
            )}
          </div>
          {role.description && (
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{role.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {modules.length === 0 ? (
              <span className="text-xs text-muted-foreground">No capabilities yet</span>
            ) : (
              modules.map((m) => (
                <Badge key={m} variant="outline" className="text-[10px]">
                  {MODULE_LABELS[m] ?? m}
                </Badge>
              ))
            )}
          </div>
        </div>
        {!role.is_system && (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => openEdit(role)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(role)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`System settings · ${roles.length} role${roles.length === 1 ? "" : "s"}`}
        title="Roles"
        actions={
          <button
            type="button"
            onClick={openNew}
            className="shrink-0 border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622]"
          >
            + New role
          </button>
        }
      />

      <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
        Job titles that grant access. Edit one and everyone who holds it updates
        instantly.
      </p>

      <div className="space-y-3 px-5 py-6 md:px-8 md:py-7">
        {jobTitles.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-card/40 p-6 text-center text-sm text-muted-foreground">
            No job titles yet. Create one with &ldquo;New role&rdquo;.
          </p>
        ) : (
          jobTitles.map(roleCard)
        )}
      </div>

      {superAdmin && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Master key
          </p>
          {roleCard(superAdmin)}
        </div>
      )}

      {otherBuiltIns.length > 0 && (
        <div className="rounded-lg border bg-card/40">
          <button
            onClick={() => setShowBuiltIns((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm text-muted-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <Lock className="h-3.5 w-3.5" />
              Built-in roles · read-only ({otherBuiltIns.length})
            </span>
            {showBuiltIns ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          {showBuiltIns && (
            <div className="space-y-3 border-t p-3">{otherBuiltIns.map(roleCard)}</div>
          )}
        </div>
      )}

      {deleting && (
        <ConfirmAccessDialog
          open
          title={`Delete the “${deleting.display_name}” role?`}
          confirmLabel="Delete role"
          destructive
          busy={busy}
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        >
          <p>
            {(memberCounts[deleting.id] ?? 0) === 0
              ? "Nobody holds this role."
              : `The ${memberCounts[deleting.id]} ${
                  memberCounts[deleting.id] === 1 ? "person" : "people"
                } holding it will lose the access it granted.`}
          </p>
        </ConfirmAccessDialog>
      )}

      <Dialog
        open={viewingMembers !== null}
        onOpenChange={(o) => !o && setViewingMembers(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Who holds {viewingMembers?.display_name}
            </DialogTitle>
            <DialogDescription>
              {(roleMembers[viewingMembers?.id ?? ""] ?? []).length} person
              {(roleMembers[viewingMembers?.id ?? ""] ?? []).length === 1 ? "" : "s"}
              . Open a name to manage their access.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] divide-y overflow-y-auto">
            {(roleMembers[viewingMembers?.id ?? ""] ?? []).map((m) => (
              <Link
                key={`${m.id}-${m.scopeType ?? "global"}`}
                href={`/users/${m.id}/permissions`}
                className="flex items-center justify-between gap-3 px-1 py-2.5 hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{m.name}</div>
                  {m.email && (
                    <div className="truncate text-xs text-muted-foreground">
                      {m.email}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {m.scopeType && (
                    <Badge variant="outline" className="text-[10px]">
                      by {m.scopeType}
                    </Badge>
                  )}
                  {m.neverSignedIn && (
                    <Badge variant="outline" className="text-[10px]">
                      Never signed in
                    </Badge>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
