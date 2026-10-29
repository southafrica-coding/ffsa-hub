"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, Plus, UserMinus } from "lucide-react";
import { ConvertToCommunityDialog } from "../convert-to-community-dialog";
import { ConfirmAccessDialog } from "@/components/confirm-access-dialog";
import { postAccessChange } from "@/lib/users/access-change";

export type AssignedRole = {
  id: string;
  role_id: string;
  scope_type: string | null;
  scope_id: string | null;
  display_name: string;
};
export type AssignableRole = {
  id: string;
  display_name: string;
  // When set (e.g. "program"), adding the role prompts for a scope first.
  scope_type?: string | null;
};

export function RoleAssignment({
  userId,
  assigned,
  assignable,
  scopeLabels,
  programOptions = [],
  canManage,
  canConvertToCommunity = false,
  lockedNote,
  personName = "this person",
}: {
  userId: string;
  assigned: AssignedRole[];
  assignable: AssignableRole[];
  scopeLabels: Record<string, string>;
  programOptions?: { id: string; label: string }[];
  canManage: boolean;
  // Super admins and admins only, and never on your own account — the endpoint enforces
  // both, this just hides a button that would always fail.
  canConvertToCommunity?: boolean;
  // Shown when titles are read-only because the person is a Super Admin and
  // the viewer is not (pass canManage/canConvertToCommunity false as well).
  lockedNote?: string;
  personName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The scope-capable role awaiting a program pick (2nd menu level), or null.
  const [scopingRole, setScopingRole] = useState<AssignableRole | null>(null);
  const [converting, setConverting] = useState(false);

  const assignedIds = new Set(assigned.map((a) => a.role_id));
  // Scope-capable roles stay available even once assigned, so a leader can be
  // added to more than one program; global roles drop off after assignment.
  const options = assignable.filter((r) => r.scope_type || !assignedIds.has(r.id));

  function closeMenu() {
    setOpen(false);
    setScopingRole(null);
  }

  // Adding or removing a title changes what this person can reach, so neither
  // happens on click: it waits here for the confirmation dialog.
  const [pending, setPending] = useState<
    | {
        kind: "add";
        roleId: string;
        label: string;
        scopeType: string | null;
        scopeId: string | null;
      }
    | { kind: "remove"; role: AssignedRole; label: string }
    | null
  >(null);

  function titleLabel(displayName: string, scopeId: string | null) {
    return scopeId && scopeLabels[scopeId]
      ? `${displayName} · ${scopeLabels[scopeId]}`
      : displayName;
  }

  function addRole(
    role: AssignableRole,
    scopeType: string | null = null,
    scopeId: string | null = null
  ) {
    closeMenu();
    setPending({
      kind: "add",
      roleId: role.id,
      label: titleLabel(role.display_name, scopeId),
      scopeType,
      scopeId,
    });
  }

  function removeRole(a: AssignedRole) {
    setPending({ kind: "remove", role: a, label: titleLabel(a.display_name, a.scope_id) });
  }

  async function confirmPending() {
    if (!pending) return;
    setBusy(true);
    const result =
      pending.kind === "add"
        ? await postAccessChange(
            "/api/admin/grant-role",
            {
              user_id: userId,
              role_id: pending.roleId,
              scope_type: pending.scopeType,
              scope_id: pending.scopeId,
            },
            "Could not add the title"
          )
        : await postAccessChange(
            "/api/admin/revoke-role",
            {
              user_id: userId,
              role_id: pending.role.role_id,
              scope_type: pending.role.scope_type,
              scope_id: pending.role.scope_id,
            },
            "Could not remove the title"
          );
    setBusy(false);
    setPending(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      pending.kind === "add"
        ? `Added “${pending.label}” to ${personName}`
        : `Removed “${pending.label}” from ${personName}`
    );
    router.refresh();
  }

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid var(--rule)",
        padding: "20px",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
          fontSize: "1rem",
          letterSpacing: "0.07em",
          color: "var(--text-primary)",
          marginBottom: "4px",
        }}
      >
        Job titles
      </p>
      <p style={{ fontSize: "13px", color: "#55524A", marginBottom: "14px" }}>
        Stack as many as fit the person — access is the combined total of every title.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        {assigned.length === 0 && (
          <span style={{ fontSize: "13px", color: "#45423B" }}>No titles yet.</span>
        )}

        {assigned.map((a) => (
          <span
            key={a.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "#FFF4D9",
              color: "var(--ink)",
              border: "1px solid #FFF4D9",
              padding: "5px 10px",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            {a.display_name}
            {a.scope_id && scopeLabels[a.scope_id] && (
              <span style={{ color: "var(--ink)", fontSize: "11px" }}>
                · {scopeLabels[a.scope_id]}
              </span>
            )}
            {canManage && (
              <button
                onClick={() => removeRole(a)}
                disabled={busy}
                aria-label={`Remove ${a.display_name}`}
                style={{ display: "inline-flex", cursor: "pointer", color: "var(--ink)" }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        ))}

        {canManage && (
          <div style={{ position: "relative", display: "inline-block" }}>
            <button
              onClick={() => (open ? closeMenu() : setOpen(true))}
              disabled={busy || options.length === 0}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                border: "1px dashed var(--rule-strong)",
                background: "transparent",
                color: "#7C786C",
                padding: "5px 10px",
                fontSize: "13px",
                cursor: options.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add title
            </button>
            {open && options.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  zIndex: 20,
                  minWidth: "200px",
                  maxHeight: "260px",
                  overflowY: "auto",
                  background: "var(--surface-2)",
                  border: "1px solid var(--rule-strong)",
                  padding: "4px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
              >
                {scopingRole ? (
                  // 2nd level: pick which program this scoped role applies to.
                  <>
                    <button
                      onClick={() => setScopingRole(null)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "7px 10px",
                        fontSize: "12px",
                        color: "#7C786C",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      ← {scopingRole.display_name} · pick a program
                    </button>
                    {programOptions.length === 0 && (
                      <span
                        style={{
                          display: "block",
                          padding: "7px 10px",
                          fontSize: "12px",
                          color: "#45423B",
                        }}
                      >
                        No programs available.
                      </span>
                    )}
                    {programOptions.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => addRole(scopingRole, "program", p.id)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "7px 10px",
                          fontSize: "13px",
                          color: "var(--text-primary)",
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </>
                ) : (
                  options.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => (r.scope_type === "program" ? setScopingRole(r) : addRole(r))}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "7px 10px",
                        fontSize: "13px",
                        color: "var(--text-primary)",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      {r.display_name}
                      {r.scope_type === "program" && (
                        <span style={{ color: "#45423B", fontSize: "11px" }}> · by program</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {pending && (
        <ConfirmAccessDialog
          open
          title={
            pending.kind === "add"
              ? `Add the title “${pending.label}” to ${personName}?`
              : `Remove the title “${pending.label}” from ${personName}?`
          }
          confirmLabel={pending.kind === "add" ? "Add title" : "Remove title"}
          destructive={pending.kind === "remove"}
          busy={busy}
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        >
          <p>
            {pending.kind === "add"
              ? `${personName} gets everything this title unlocks, on top of their other titles.`
              : `${personName} loses whatever this title unlocks that none of their other titles or permissions also give.`}
          </p>
        </ConfirmAccessDialog>
      )}

      {lockedNote && (
        <p style={{ fontSize: "12px", color: "#55524A", marginTop: "14px" }}>
          {lockedNote}
        </p>
      )}

      {canConvertToCommunity && (
        <div
          style={{
            marginTop: "18px",
            paddingTop: "14px",
            borderTop: "1px solid var(--rule)",
          }}
        >
          <button
            onClick={() => setConverting(true)}
            disabled={busy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              border: "1px solid var(--rule-strong)",
              background: "transparent",
              color: "var(--text-primary)",
              padding: "6px 12px",
              fontSize: "13px",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            <UserMinus className="h-3.5 w-3.5" /> Convert to community member
          </button>
          <p style={{ fontSize: "12px", color: "#55524A", marginTop: "8px" }}>
            They&rsquo;ve left staff. Clears their titles, permissions and ministry
            memberships in one go — pick anything they should keep (community
            members do serve in ministries). Their login, profile and history stay.
          </p>
          <ConvertToCommunityDialog
            userId={userId}
            personName={personName}
            open={converting}
            onOpenChange={setConverting}
          />
        </div>
      )}
    </div>
  );
}
