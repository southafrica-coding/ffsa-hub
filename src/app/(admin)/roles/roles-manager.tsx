"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  Users,
  Lock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { Permission, PermissionsByModule } from "@/services/permissions";

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
};

export function RolesManager({
  roles,
  permissionsByModule,
  memberCounts,
  bundles,
  callerKeys,
  isSuperAdmin,
}: {
  roles: Role[];
  permissionsByModule: PermissionsByModule;
  memberCounts: Record<string, number>;
  bundles: Record<string, string[]>;
  callerKeys: string[];
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // null = list view; "new" = creating; Role = editing that role
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBuiltIns, setShowBuiltIns] = useState(false);

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
    return isSuperAdmin || callerKeySet.has(p.key);
  }

  async function save() {
    const name = displayName.trim();
    if (!name) {
      toast.error("Give the role a name");
      return;
    }
    const isNew = editing === "new";
    const url = isNew ? "/api/admin/roles" : `/api/admin/roles/${(editing as Role).id}`;
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
    toast.success(isNew ? "Role created" : "Role updated");
    setEditing(null);
    startTransition(() => router.refresh());
  }

  async function remove(role: Role) {
    if (
      !confirm(
        `Delete the "${role.display_name}" role? People holding it will lose the access it granted.`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/roles/${role.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Could not delete the role");
      return;
    }
    toast.success("Role deleted");
    startTransition(() => router.refresh());
  }

  // ───────── Editor view ─────────
  if (editing !== null) {
    const isNew = editing === "new";
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="page-title">
            {isNew ? "New role" : `Edit ${(editing as Role).display_name}`}
          </h1>
        </div>

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
          <Button onClick={save} disabled={isPending}>
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
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              {count}
            </span>
          </div>
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
            <Button variant="ghost" size="sm" onClick={() => remove(role)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="page-eyebrow">SYSTEM SETTINGS</p>
          <h1 className="page-title">Roles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Job titles that grant access. Edit one and everyone who holds it updates instantly.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> New role
        </Button>
      </div>

      <div className="space-y-3">
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
    </div>
  );
}
