"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Permission, UserPermission, ScopeOption, PermissionsByModule } from "@/services/permissions";
import { SuperAdminConfirmDialog } from "./super-admin-confirm-dialog";

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
  bookings: "Space Bookings",
  vehicles: "Rent a Vehicle",
  "org-chart": "Org Chart",
  "records-library": "Records Library",
  ministry: "Ministry",
  legal: "Legal",
  okrs: "OKRs",
  "brand-kit": "Brand Kit",
  administration: "Administration",
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
        border: "1px solid var(--rule)",
        overflow: "hidden",
      }}
    >
      {/* Scope header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        style={{ background: "#FFFFFF" }}
        onClick={() => setOpen((o) => !o)}
      >
        {/* Select-all checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleAll(); }}
          style={{
            width: "18px",
            height: "18px",
            border: "1px solid var(--rule-strong)",
            background: allChecked
              ? "#0A0A0A"
              : someChecked
              ? "#FFF4D9"
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
            <Minus className="h-3 w-3" style={{ color: "#0A0A0A" }} />
          ) : null}
        </button>

        <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)", flex: 1 }}>
          {scope.label}
          <span
            style={{
              fontSize: "9px",
              letterSpacing: "0.15em",
              color: "#45423B",
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
            borderTop: "1px solid var(--rule)",
          }}
        >
          {permissions.map((p) => {
            const key = grantedKey(p.id, scope.scope_type, scope.id);
            const checked = granted.has(key);
            return (
              <label
                key={p.id}
                className="flex items-center gap-2 cursor-pointer"
                style={{ fontSize: "13px", color: "#9A9689" }}
              >
                <button
                  onClick={() => onToggle(p.id, scope.scope_type, scope.id, !checked)}
                  style={{
                    width: "16px",
                    height: "16px",
                    border: "1px solid var(--rule-strong)",
                    background: checked ? "#FFB801" : "transparent",
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
        background: "#FFFFFF",
        border: "1px solid var(--rule)",
        overflow: "hidden",
      }}
    >
      {/* Module header */}
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: "1px solid var(--rule)" }}
      >
        <p
          style={{
            fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
            fontSize: "1rem",
            letterSpacing: "0.07em",
            color: "var(--text-primary)",
          }}
        >
          {label}
        </p>

        {/* Select-all global — hidden in restricted (per-program-only) mode */}
        {!hideGlobal && (
          <button
            onClick={toggleGlobalAll}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: "#45423B", cursor: "pointer" }}
          >
            <div
              style={{
                width: "16px",
                height: "16px",
                border: "1px solid var(--rule-strong)",
                background: globalAllChecked
                  ? "#0A0A0A"
                  : globalSomeChecked
                  ? "#FFF4D9"
                  : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {globalAllChecked ? (
                <Check className="h-2.5 w-2.5 text-black" />
              ) : globalSomeChecked ? (
                <Minus className="h-2.5 w-2.5" style={{ color: "#0A0A0A" }} />
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
        {!hideGlobal && globalPermissions.length > 0 && relevantScopes.length > 0 && (
          <p
            style={{
              fontSize: "11px",
              color: "var(--ink)",
              margin: 0,
            }}
          >
            Applies to <strong>all</strong> programs. To limit someone to one
            school, leave these unticked and use <strong>Scoped Access</strong>{" "}
            below.
          </p>
        )}
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
                  style={{ fontSize: "13px", color: "#9A9689" }}
                >
                  <button
                    onClick={() => onToggle(p.id, null, null, !checked)}
                    style={{
                      width: "16px",
                      height: "16px",
                      border: "1px solid var(--rule-strong)",
                      background: checked ? "#FFB801" : "transparent",
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
                color: "#2A2822",
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

/**
 * One admin-tier row: heading, what it grants, and the grant/remove button.
 *
 * Shared by General Admin and Super Admin so the two read as one scale rather
 * than two unrelated switches. Active state is the yellow-dim treatment the
 * Super Admin card has always used.
 */
function TierPanel({
  heading,
  active,
  description,
  isSelf,
  busy,
  actionLabel,
  onAction,
}: {
  heading: string;
  active: boolean;
  description: string;
  isSelf: boolean;
  busy: boolean;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      style={{
        background: active ? "var(--yellow-dim)" : "#FFFFFF",
        border: active ? "1px solid #FFF4D9" : "1px solid var(--rule)",
        padding: "1.25rem 1.5rem",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div
            style={{
              fontSize: "9px",
              letterSpacing: "0.2em",
              color: active ? "#0A0A0A" : "#45423B",
              textTransform: "uppercase",
              fontWeight: 700,
              marginBottom: "6px",
            }}
          >
            {heading}
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
          {isSelf && (
            <p className="text-xs mt-2" style={{ color: "#7C786C" }}>
              You cannot change your own admin status.
            </p>
          )}
        </div>
        <Button
          onClick={onAction}
          disabled={busy || isSelf}
          variant={active ? "outline" : "default"}
          style={
            active
              ? { borderColor: "#FFF4D9", color: "#0A0A0A" }
              : { background: "#FFB801", color: "#0A0A0A", fontWeight: 700 }
          }
        >
          {busy ? "Saving…" : actionLabel}
        </Button>
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
  // Only a real super_admin may grant Super Admin or Records Library access;
  // a General Admin gets the full editor minus those two.
  canGrantSuperAdmin = true,
  // When the caller is not a super_admin, this controls what they can edit:
  //   null  → can manage assignable-contact for every program (global schools.manage)
  //   array → can manage only these specific program ids
  managedProgramIds = null,
  isTargetSuperAdmin = false,
  isTargetGeneralAdmin = false,
  isSelf = false,
  personName = "This person",
}: {
  userId: string;
  currentStatus: string;
  currentJobTitle: string;
  permissionsByModule: PermissionsByModule;
  userPermissions: UserPermission[];
  scopeOptions: ScopeOption[];
  isSuperAdmin?: boolean;
  canGrantSuperAdmin?: boolean;
  managedProgramIds?: string[] | null;
  isTargetSuperAdmin?: boolean;
  isTargetGeneralAdmin?: boolean;
  isSelf?: boolean;
  personName?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [jobTitle, setJobTitle] = useState(currentJobTitle);
  const [status, setStatus] = useState(currentStatus);
  // Which tier row is mid-request ("admin"), and whether the Super Admin
  // confirmation is open (and in which direction).
  const [togglingTier, setTogglingTier] = useState<string | null>(null);
  const [superAdminPrompt, setSuperAdminPrompt] = useState<
    "grant" | "remove" | null
  >(null);

  // General Admin toggles straight from the panel. Super Admin routes through
  // SuperAdminConfirmDialog instead — see the tier rows below.
  async function handleToggleTier(roleName: string) {
    if (isSelf) {
      toast.error("You cannot change your own admin status.");
      return;
    }

    const grant = roleName === "super_admin" ? !isTargetSuperAdmin : !isTargetGeneralAdmin;
    setTogglingTier(roleName);
    try {
      const res = await fetch(
        grant ? "/api/admin/grant-role" : "/api/admin/revoke-role",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, role_name: roleName }),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Could not update this role.");
        return;
      }

      toast.success(grant ? "General Admin granted" : "General Admin removed");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Could not update this role.");
    } finally {
      setTogglingTier(null);
    }
  }

  // For non-super-admin granters we narrow the editor to only the
  // `schools.assignable_as_contact` permission, scoped to programs they
  // themselves have `schools.manage` on.
  const effectivePermissionsByModule: PermissionsByModule = isSuperAdmin
    ? canGrantSuperAdmin
      ? permissionsByModule
      : Object.fromEntries(
          Object.entries(permissionsByModule).map(([mod, perms]) => [
            mod,
            perms.filter((p) => p.key !== "records_library.manage"),
          ])
        )
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

  // Preferred order for the modules we lay out deliberately; anything else in
  // the catalog (Space Bookings, Vehicles, Org Chart, …) follows alphabetically
  // so a new module is grantable the moment its permissions exist.
  const moduleOrder = (() => {
    const preferred = [
      "contacts",
      "events",
      "schools",
      "teams",
      "finance",
      "communications",
      "mission",
      "prayer-room",
    ];
    const present = Object.keys(effectivePermissionsByModule);
    const extra = present
      .filter((m) => !preferred.includes(m))
      .sort((a, b) => (MODULE_LABELS[a] ?? a).localeCompare(MODULE_LABELS[b] ?? b));
    return [...preferred.filter((m) => present.includes(m)), ...extra];
  })();

  return (
    <div className="space-y-6">
      {/* The two admin tiers, most-restricted first. They differ in exactly
          one thing (the Records Library), so they are shown together and say
          so. General Admin: super_admin or admin. Super Admin: super_admin
          only (canGrantSuperAdmin) — the API enforces both, see
          SUPER_ADMIN_ONLY_ROLES / ADMIN_TIER_ROLES in lib/auth/check-role-grant.ts. */}
      {isSuperAdmin && (
        <>
          <TierPanel
            heading={
              isTargetGeneralAdmin
                ? "General Admin — Active"
                : "General Admin (no records library)"
            }
            active={isTargetGeneralAdmin}
            description="Everything a Super Admin can reach, except the Records Library."
            isSelf={isSelf}
            busy={togglingTier === "admin" || isPending}
            actionLabel={
              isTargetGeneralAdmin ? "Remove General Admin" : "Make General Admin"
            }
            onAction={() => handleToggleTier("admin")}
          />

          {canGrantSuperAdmin && (
          <>
          <TierPanel
            heading={
              isTargetSuperAdmin
                ? "Super Admin — Active"
                : "Super Admin (including records library)"
            }
            active={isTargetSuperAdmin}
            description="Bypasses all roles and permission checks — unrestricted access to every module and every record, the Records Library included."
            isSelf={isSelf}
            busy={isPending}
            actionLabel={
              isTargetSuperAdmin ? "Remove Super Admin" : "Make Super Admin"
            }
            onAction={() =>
              setSuperAdminPrompt(isTargetSuperAdmin ? "remove" : "grant")
            }
          />

          <SuperAdminConfirmDialog
            userId={userId}
            personName={personName}
            mode={superAdminPrompt ?? "grant"}
            open={superAdminPrompt !== null}
            onOpenChange={(o) => !o && setSuperAdminPrompt(null)}
          />
          </>
          )}
        </>
      )}

      {/* Job title + approve section — super_admin and admin */}
      {isSuperAdmin && (
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid var(--rule)",
            padding: "1.25rem 1.5rem",
          }}
        >
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex-1">
              <Label
                htmlFor="job-title"
                style={{ fontSize: "9px", letterSpacing: "0.2em", color: "#45423B", textTransform: "uppercase" }}
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
                    background: "var(--yellow-dim)",
                    color: "#0A0A0A",
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
                    background: "transparent",
                    color: "var(--green-text)",
                  }}
                >
                  Active
                </span>
              )}
              <Button
                onClick={handleSave}
                disabled={saving || isPending}
                style={{
                  background: "#FFB801",
                  color: "#0A0A0A",
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
            background: "#FFFFFF",
            border: "1px solid var(--rule)",
            padding: "1.25rem 1.5rem",
          }}
        >
          <div>
            <p
              style={{
                fontSize: "9px",
                letterSpacing: "0.2em",
                fontWeight: 700,
                color: "#0A0A0A",
                textTransform: "uppercase",
              }}
            >
              Schools Manager View
            </p>
            <p style={{ fontSize: "13px", color: "var(--text-primary)", marginTop: "4px" }}>
              You can flag this user as available to be assigned as a point of
              contact for programs you manage.
            </p>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || isPending}
            style={{ background: "#FFB801", color: "#0A0A0A", fontWeight: 700 }}
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
            color: "#0A0A0A",
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
