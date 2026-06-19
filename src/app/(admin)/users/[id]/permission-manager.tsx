"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Permission, UserPermission, ScopeOption, PermissionsByModule } from "@/services/permissions";

// Module display labels matching modules.ts ids
const MODULE_LABELS: Record<string, string> = {
  contacts: "Contacts",
  events: "Events",
  schools: "Training",
  teams: "Teams",
  finance: "Finance",
  communications: "Communications",
  mission: "Mission",
  "prayer-room": "Prayer Room",
};

// Which scope_type applies to each module
const MODULE_SCOPE_TYPES: Record<string, "program" | "team" | "event" | null> = {
  schools: "program",
  teams: "team",
  events: "event",
  finance: null, // finance can be scoped to both programs and teams
};

type GrantedKey = string; // `${permission_id}::${scope_type ?? ""}::${scope_id ?? ""}`

function grantedKey(permId: string, scopeType?: string | null, scopeId?: string | null) {
  return `${permId}::${scopeType ?? ""}::${scopeId ?? ""}`;
}

function ScopeSection({
  scope,
  permissions,
  granted,
  onToggle,
}: {
  scope: ScopeOption;
  permissions: Permission[];
  granted: Set<GrantedKey>;
  onToggle: (permId: string, scopeType: string, scopeId: string, checked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const allChecked = permissions.every((p) =>
    granted.has(grantedKey(p.id, scope.scope_type, scope.id))
  );
  const someChecked = permissions.some((p) =>
    granted.has(grantedKey(p.id, scope.scope_type, scope.id))
  );

  function toggleAll() {
    const next = !allChecked;
    for (const p of permissions) {
      onToggle(p.id, scope.scope_type, scope.id, next);
    }
  }

  return (
    <div
      style={{
        border: "1px solid hsl(22 8% 14%)",
        borderRadius: "8px",
        overflow: "hidden",
      }}
    >
      {/* Scope header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        style={{ background: "hsl(22 10% 7%)" }}
        onClick={() => setOpen((o) => !o)}
      >
        {/* Select-all checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleAll(); }}
          style={{
            width: "18px",
            height: "18px",
            borderRadius: "4px",
            border: "1px solid hsl(22 8% 28%)",
            background: allChecked
              ? "hsl(42 95% 55%)"
              : someChecked
              ? "hsl(42 95% 55% / 0.3)"
              : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            cursor: "pointer",
          }}
        >
          {allChecked ? (
            <Check className="h-3 w-3 text-black" />
          ) : someChecked ? (
            <Minus className="h-3 w-3" style={{ color: "hsl(42 95% 55%)" }} />
          ) : null}
        </button>

        <span style={{ fontSize: "13px", fontWeight: 500, color: "#F0EBE3", flex: 1 }}>
          {scope.label}
          <span
            style={{
              fontSize: "9px",
              letterSpacing: "0.15em",
              color: "hsl(30 8% 42%)",
              marginLeft: "8px",
              textTransform: "uppercase",
            }}
          >
            {scope.scope_type}
          </span>
        </span>

        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </div>

      {/* Expanded permissions */}
      {open && (
        <div
          className="grid gap-x-6 gap-y-2 px-4 py-3"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            borderTop: "1px solid hsl(22 8% 12%)",
          }}
        >
          {permissions.map((p) => {
            const key = grantedKey(p.id, scope.scope_type, scope.id);
            const checked = granted.has(key);
            return (
              <label
                key={p.id}
                className="flex items-center gap-2 cursor-pointer"
                style={{ fontSize: "13px", color: "hsl(30 8% 65%)" }}
              >
                <button
                  onClick={() => onToggle(p.id, scope.scope_type, scope.id, !checked)}
                  style={{
                    width: "16px",
                    height: "16px",
                    borderRadius: "3px",
                    border: "1px solid hsl(22 8% 28%)",
                    background: checked ? "hsl(42 95% 55%)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    cursor: "pointer",
                  }}
                >
                  {checked && <Check className="h-2.5 w-2.5 text-black" />}
                </button>
                {p.display_name}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModuleSection({
  moduleId,
  permissions,
  granted,
  scopeOptions,
  onToggle,
  hideGlobal = false,
}: {
  moduleId: string;
  permissions: Permission[];
  granted: Set<GrantedKey>;
  scopeOptions: ScopeOption[];
  onToggle: (permId: string, scopeType: string | null, scopeId: string | null, checked: boolean) => void;
  hideGlobal?: boolean;
}) {
  const label = MODULE_LABELS[moduleId] ?? moduleId;

  // Some permissions are scoped-only — they must always be tied to a
  // specific program/team/event and can never be granted globally.
  // E.g. `schools.assignable_as_contact` (per-program), and
  // `events.assignable_as_followup_handler` (per-event) — each grant
  // makes the user assignable for exactly the scope it's tied to.
  const SCOPED_ONLY_KEYS = new Set([
    "schools.assignable_as_contact",
    "events.assignable_as_followup_handler",
  ]);
  const globalPermissions = permissions.filter(
    (p) => !SCOPED_ONLY_KEYS.has(p.key)
  );

  // Global (no scope) permissions
  const globalAllChecked =
    globalPermissions.length > 0 &&
    globalPermissions.every((p) => granted.has(grantedKey(p.id, null, null)));
  const globalSomeChecked = globalPermissions.some((p) =>
    granted.has(grantedKey(p.id, null, null))
  );

  function toggleGlobalAll() {
    const next = !globalAllChecked;
    for (const p of globalPermissions) {
      onToggle(p.id, null, null, next);
    }
  }

  // Relevant scopes for this module
  const scopeType = MODULE_SCOPE_TYPES[moduleId];
  const relevantScopes = scopeType
    ? scopeOptions.filter((s) => s.scope_type === scopeType)
    : moduleId === "finance"
    ? scopeOptions.filter((s) => s.scope_type === "program" || s.scope_type === "team")
    : [];

  return (
    <div
      style={{
        background: "hsl(22 10% 8%)",
        border: "1px solid hsl(22 8% 14%)",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      {/* Module header */}
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: "1px solid hsl(22 8% 12%)" }}
      >
        <p
          style={{
            fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
            fontSize: "1rem",
            letterSpacing: "0.07em",
            color: "#F0EBE3",
          }}
        >
          {label}
        </p>

        {/* Select-all global — hidden in restricted (per-program-only) mode */}
        {!hideGlobal && (
          <button
            onClick={toggleGlobalAll}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: "hsl(30 8% 45%)", cursor: "pointer" }}
          >
            <div
              style={{
                width: "16px",
                height: "16px",
                borderRadius: "3px",
                border: "1px solid hsl(22 8% 28%)",
                background: globalAllChecked
                  ? "hsl(42 95% 55%)"
                  : globalSomeChecked
                  ? "hsl(42 95% 55% / 0.3)"
                  : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {globalAllChecked ? (
                <Check className="h-2.5 w-2.5 text-black" />
              ) : globalSomeChecked ? (
                <Minus className="h-2.5 w-2.5" style={{ color: "hsl(42 95% 55%)" }} />
              ) : null}
            </div>
            Select all
          </button>
        )}
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Global permission checkboxes — hidden in restricted mode.
            Scoped-only permissions are excluded; they appear only in the
            per-scope sections below. */}
        {!hideGlobal && globalPermissions.length > 0 && (
          <div
            className="grid gap-x-6 gap-y-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
          >
            {globalPermissions.map((p) => {
              const key = grantedKey(p.id, null, null);
              const checked = granted.has(key);
              return (
                <label
                  key={p.id}
                  className="flex items-center gap-2 cursor-pointer"
                  style={{ fontSize: "13px", color: "hsl(30 8% 65%)" }}
                >
                  <button
                    onClick={() => onToggle(p.id, null, null, !checked)}
                    style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "3px",
                      border: "1px solid hsl(22 8% 28%)",
                      background: checked ? "hsl(42 95% 55%)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      cursor: "pointer",
                    }}
                  >
                    {checked && <Check className="h-2.5 w-2.5 text-black" />}
                  </button>
                  {p.display_name}
                </label>
              );
            })}
          </div>
        )}

        {/* Scoped sections (existing programs/teams/events only) */}
        {relevantScopes.length > 0 && (
          <div className="space-y-2">
            <p
              style={{
                fontSize: "9px",
                letterSpacing: "0.2em",
                fontWeight: 600,
                color: "hsl(30 8% 38%)",
                textTransform: "uppercase",
              }}
            >
              Scoped Access
            </p>
            {relevantScopes.map((scope) => (
              <ScopeSection
                key={`${scope.scope_type}::${scope.id}`}
                scope={scope}
                permissions={permissions}
                granted={granted}
                onToggle={(permId, st, sid, checked) => onToggle(permId, st, sid, checked)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PermissionManager({
  userId,
  currentStatus,
  currentJobTitle,
  permissionsByModule,
  userPermissions,
  scopeOptions,
  isSuperAdmin = true,
  // When the caller is not a super_admin, this controls what they can edit:
  //   null  → can manage assignable-contact for every program (global schools.manage)
  //   array → can manage only these specific program ids
  managedProgramIds = null,
  isTargetSuperAdmin = false,
  isSelf = false,
}: {
  userId: string;
  currentStatus: string;
  currentJobTitle: string;
  permissionsByModule: PermissionsByModule;
  userPermissions: UserPermission[];
  scopeOptions: ScopeOption[];
  isSuperAdmin?: boolean;
  managedProgramIds?: string[] | null;
  isTargetSuperAdmin?: boolean;
  isSelf?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [jobTitle, setJobTitle] = useState(currentJobTitle);
  const [status, setStatus] = useState(currentStatus);
  const [togglingSuperAdmin, setTogglingSuperAdmin] = useState(false);

  async function handleToggleSuperAdmin() {
    if (isSelf) {
      alert("You cannot change your own super_admin status.");
      return;
    }

    const grant = !isTargetSuperAdmin;
    const confirmMsg = grant
      ? "Grant Super Admin? This bypasses ALL roles and permission checks — the user will have unrestricted access to every module and every record in the system."
      : "Remove Super Admin? The user will lose unrestricted access and fall back to their other roles and permissions.";

    if (!confirm(confirmMsg)) return;

    setTogglingSuperAdmin(true);
    try {
      const endpoint = grant
        ? "/api/admin/grant-role"
        : "/api/admin/revoke-role";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, role_name: "super_admin" }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to update super_admin role.");
        return;
      }

      startTransition(() => router.refresh());
    } catch {
      alert("Failed to update super_admin role.");
    } finally {
      setTogglingSuperAdmin(false);
    }
  }

  // For non-super-admin granters we narrow the editor to only the
  // `schools.assignable_as_contact` permission, scoped to programs they
  // themselves have `schools.manage` on.
  const effectivePermissionsByModule: PermissionsByModule = isSuperAdmin
    ? permissionsByModule
    : {
        schools: (permissionsByModule.schools ?? []).filter(
          (p) => p.key === "schools.assignable_as_contact"
        ),
      };

  const effectiveScopeOptions: ScopeOption[] = isSuperAdmin
    ? scopeOptions
    : managedProgramIds === null
    ? scopeOptions.filter((s) => s.scope_type === "program")
    : scopeOptions.filter(
        (s) => s.scope_type === "program" && managedProgramIds.includes(s.id)
      );

  // Build the initial granted set from DB
  const initialGranted = new Set<GrantedKey>(
    userPermissions.map((up) =>
      grantedKey(up.permission_id, up.scope_type, up.scope_id)
    )
  );
  const [granted, setGranted] = useState<Set<GrantedKey>>(initialGranted);

  // Build a map of key → permission_id for lookup
  const permIdByKey = new Map<GrantedKey, string>();
  for (const perms of Object.values(permissionsByModule)) {
    for (const p of perms) {
      // preload — key with null scope
      permIdByKey.set(grantedKey(p.id, null, null), p.id);
      for (const s of scopeOptions) {
        permIdByKey.set(grantedKey(p.id, s.scope_type, s.id), p.id);
      }
    }
  }

  // Build permission_id → id lookup from permissions list
  function getPermissionId(permId: string) {
    return permId; // already the DB uuid
  }

  function handleToggle(
    permId: string,
    scopeType: string | null,
    scopeId: string | null,
    checked: boolean
  ) {
    const key = grantedKey(permId, scopeType, scopeId);
    setGranted((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);

    try {
      // Diff: what was added and what was removed
      const toGrant: Array<{ permission_id: string; scope_type: string | null; scope_id: string | null }> = [];
      const toRevoke: Array<{ permission_id: string; scope_type: string | null; scope_id: string | null }> = [];

      // Collect all possible keys we *could* have toggled. Using the
      // filtered (effective) maps means non-super-admin grants never emit
      // changes to permissions/scopes they shouldn't be touching.
      const allKeys = new Map<GrantedKey, { permission_id: string; scope_type: string | null; scope_id: string | null }>();
      for (const perms of Object.values(effectivePermissionsByModule)) {
        for (const p of perms) {
          if (isSuperAdmin) {
            allKeys.set(grantedKey(p.id, null, null), { permission_id: p.id, scope_type: null, scope_id: null });
          }
          for (const s of effectiveScopeOptions) {
            allKeys.set(grantedKey(p.id, s.scope_type, s.id), {
              permission_id: p.id,
              scope_type: s.scope_type,
              scope_id: s.id,
            });
          }
        }
      }

      for (const [key, meta] of allKeys) {
        const wasGranted = initialGranted.has(key);
        const isGranted = granted.has(key);
        if (isGranted && !wasGranted) toGrant.push(meta);
        if (!isGranted && wasGranted) toRevoke.push(meta);
      }

      // Execute grants
      await Promise.all(
        toGrant.map((g) =>
          fetch("/api/admin/grant-permission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: userId,
              permission_id: g.permission_id,
              scope_type: g.scope_type,
              scope_id: g.scope_id,
            }),
          })
        )
      );

      // Execute revokes
      await Promise.all(
        toRevoke.map((r) =>
          fetch("/api/admin/revoke-permission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: userId,
              permission_id: r.permission_id,
              scope_type: r.scope_type,
              scope_id: r.scope_id,
            }),
          })
        )
      );

      // Job-title / approve flow is super-admin-only.
      if (isSuperAdmin) {
        if (status === "pending_approval") {
          const res = await fetch("/api/admin/approve-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId, job_title: jobTitle }),
          });
          if (res.ok) setStatus("active");
        } else if (jobTitle !== currentJobTitle) {
          await fetch("/api/admin/approve-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId, job_title: jobTitle }),
          });
        }
      }

      startTransition(() => router.refresh());
    } catch {
      alert("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const moduleOrder = [
    "contacts",
    "events",
    "schools",
    "teams",
    "finance",
    "communications",
    "mission",
    "prayer-room",
  ];

  return (
    <div className="space-y-6">
      {/* Super Admin toggle — super_admin only */}
      {isSuperAdmin && (
        <div
          style={{
            background: isTargetSuperAdmin
              ? "hsl(42 30% 10%)"
              : "hsl(22 10% 8%)",
            border: isTargetSuperAdmin
              ? "1px solid hsl(42 95% 55% / 0.4)"
              : "1px solid hsl(22 8% 14%)",
            borderRadius: "12px",
            padding: "1.25rem 1.5rem",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div
                style={{
                  fontSize: "9px",
                  letterSpacing: "0.2em",
                  color: isTargetSuperAdmin
                    ? "hsl(42 95% 55%)"
                    : "hsl(30 8% 42%)",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  marginBottom: "6px",
                }}
              >
                {isTargetSuperAdmin
                  ? "Super Admin — Active"
                  : "Super Admin"}
              </div>
              <p className="text-sm text-muted-foreground">
                Bypasses all roles and permission checks. The user has
                unrestricted access to every module and every record.
              </p>
              {isSelf && (
                <p
                  className="text-xs mt-2"
                  style={{ color: "hsl(30 8% 55%)" }}
                >
                  You cannot change your own super_admin status.
                </p>
              )}
            </div>
            <Button
              onClick={handleToggleSuperAdmin}
              disabled={togglingSuperAdmin || isPending || isSelf}
              variant={isTargetSuperAdmin ? "outline" : "default"}
              style={
                isTargetSuperAdmin
                  ? {
                      borderColor: "hsl(42 95% 55% / 0.4)",
                      color: "hsl(42 95% 55%)",
                    }
                  : {
                      background: "hsl(42 95% 55%)",
                      color: "#0D0B09",
                      fontWeight: 700,
                    }
              }
            >
              {togglingSuperAdmin
                ? "Saving…"
                : isTargetSuperAdmin
                ? "Remove Super Admin"
                : "Make Super Admin"}
            </Button>
          </div>
        </div>
      )}

      {/* Job title + approve section — super_admin only */}
      {isSuperAdmin && (
        <div
          style={{
            background: "hsl(22 10% 8%)",
            border: "1px solid hsl(22 8% 14%)",
            borderRadius: "12px",
            padding: "1.25rem 1.5rem",
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex-1">
              <Label
                htmlFor="job-title"
                style={{ fontSize: "9px", letterSpacing: "0.2em", color: "hsl(30 8% 42%)", textTransform: "uppercase" }}
              >
                Job Title
              </Label>
              <Input
                id="job-title"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. DTS Program Leader"
                className="mt-1"
              />
            </div>

            <div className="flex items-center gap-3">
              {status === "pending_approval" && (
                <span
                  style={{
                    fontSize: "10px",
                    letterSpacing: "0.1em",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    background: "hsl(42 80% 18%)",
                    color: "hsl(42 95% 55%)",
                  }}
                >
                  Pending Approval
                </span>
              )}
              {status === "active" && (
                <span
                  style={{
                    fontSize: "10px",
                    letterSpacing: "0.1em",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    background: "hsl(142 60% 20%)",
                    color: "hsl(142 60% 55%)",
                  }}
                >
                  Active
                </span>
              )}
              <Button
                onClick={handleSave}
                disabled={saving || isPending}
                style={{
                  background: "hsl(42 95% 55%)",
                  color: "#0D0B09",
                  fontWeight: 700,
                }}
              >
                {saving
                  ? "Saving…"
                  : status === "pending_approval"
                  ? "Approve & Activate"
                  : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Restricted-mode banner + standalone save button */}
      {!isSuperAdmin && (
        <div
          className="flex items-start justify-between gap-4"
          style={{
            background: "hsl(22 10% 8%)",
            border: "1px solid hsl(22 8% 14%)",
            borderRadius: "12px",
            padding: "1.25rem 1.5rem",
          }}
        >
          <div>
            <p
              style={{
                fontSize: "9px",
                letterSpacing: "0.2em",
                fontWeight: 700,
                color: "hsl(42 95% 55%)",
                textTransform: "uppercase",
              }}
            >
              Schools Manager View
            </p>
            <p style={{ fontSize: "13px", color: "#F0EBE3", marginTop: "4px" }}>
              You can flag this user as available to be assigned as a point of
              contact for programs you manage.
            </p>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || isPending}
            style={{ background: "hsl(42 95% 55%)", color: "#0D0B09", fontWeight: 700 }}
          >
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      )}

      {/* Permission modules */}
      <div className="space-y-4">
        <p
          style={{
            fontSize: "9px",
            letterSpacing: "0.3em",
            fontWeight: 700,
            color: "hsl(42 95% 55%)",
            textTransform: "uppercase",
          }}
        >
          Access Privileges
        </p>

        {moduleOrder.map((moduleId) => {
          const perms = effectivePermissionsByModule[moduleId];
          if (!perms || perms.length === 0) return null;
          return (
            <ModuleSection
              key={moduleId}
              moduleId={moduleId}
              permissions={perms}
              granted={granted}
              scopeOptions={effectiveScopeOptions}
              onToggle={handleToggle}
              hideGlobal={!isSuperAdmin}
            />
          );
        })}
      </div>
    </div>
  );
}
