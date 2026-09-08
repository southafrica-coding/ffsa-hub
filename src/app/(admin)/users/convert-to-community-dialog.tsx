"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The "they've left staff" picker. Everything the person holds beyond the
// community floor is listed and removed by default; ticking an item keeps it.
//
// Selective on purpose: community members do serve in ministries, and some
// keep a specific permission (a ministry leader who is not staff, a volunteer
// who still needs one module). A blanket strip would break those people.

type Removable = {
  roles: { id: string; name: string; display_name: string }[];
  permissions: {
    id: string;
    key: string;
    display_name: string;
    module: string;
  }[];
  ministries: {
    id: string;
    name: string;
    member_role: string;
    is_point_leader: boolean;
    status: string;
  }[];
  department: string | null;
  job_title: string | null;
  nothing_to_do: boolean;
};

export function ConvertToCommunityDialog({
  userId,
  personName,
  open,
  onOpenChange,
  onConverted,
}: {
  userId: string;
  personName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful conversion, before the router refresh. */
  onConverted?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removable, setRemovable] = useState<Removable | null>(null);
  // Ids ticked to KEEP. Empty = the full demotion, which is the common case.
  const [keepRoles, setKeepRoles] = useState<Set<string>>(new Set());
  const [keepPerms, setKeepPerms] = useState<Set<string>>(new Set());
  const [keepMinistries, setKeepMinistries] = useState<Set<string>>(new Set());
  const [keepDepartment, setKeepDepartment] = useState(false);
  const [keepJobTitle, setKeepJobTitle] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setRemovable(null);
    setKeepRoles(new Set());
    setKeepPerms(new Set());
    setKeepMinistries(new Set());
    setKeepDepartment(false);
    setKeepJobTitle(false);

    (async () => {
      try {
        const res = await fetch(`/api/admin/convert-to-community?user_id=${userId}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          toast.error(data.error ?? "Could not read this person's access");
          onOpenChange(false);
          return;
        }
        setRemovable(data.removable as Removable);
      } catch {
        if (!cancelled) {
          toast.error("Network error");
          onOpenChange(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, userId, onOpenChange]);

  function toggle(
    set: Set<string>,
    setter: (s: Set<string>) => void,
    id: string
  ) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/convert-to-community", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          keep: {
            role_ids: [...keepRoles],
            permission_ids: [...keepPerms],
            membership_ids: [...keepMinistries],
            department: keepDepartment,
            job_title: keepJobTitle,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not convert this person");
        return;
      }
      toast.success(`${personName} is now a community member`);
      onOpenChange(false);
      onConverted?.();
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  const keptCount =
    keepRoles.size +
    keepPerms.size +
    keepMinistries.size +
    (keepDepartment ? 1 : 0) +
    (keepJobTitle ? 1 : 0);

  const removedCount = removable
    ? removable.roles.length +
      removable.permissions.length +
      removable.ministries.length +
      (removable.department ? 1 : 0) +
      (removable.job_title ? 1 : 0) -
      keptCount
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Convert {personName} to a community member</DialogTitle>
          <DialogDescription>
            Everything below is removed unless you tick it to keep. They keep
            their login, profile, family and history either way, and can still
            sign in to the portal.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="text-sm text-muted-foreground py-6">Reading their access…</p>
        )}

        {!loading && removable?.nothing_to_do && (
          <p className="text-sm text-muted-foreground py-6">
            {personName} holds nothing beyond community access — there is
            nothing to remove.
          </p>
        )}

        {!loading && removable && !removable.nothing_to_do && (
          <div className="max-h-[50vh] overflow-y-auto space-y-5 pr-1">
            {removable.roles.length > 0 && (
              <Section
                title="Job titles & roles"
                hint="Each one carries its own permissions."
              >
                {removable.roles.map((r) => (
                  <Row
                    key={r.id}
                    checked={keepRoles.has(r.id)}
                    onToggle={() => toggle(keepRoles, setKeepRoles, r.id)}
                    label={r.display_name || r.name}
                    note={r.name === "super_admin" ? "full access to everything" : undefined}
                  />
                ))}
              </Section>
            )}

            {removable.ministries.length > 0 && (
              <Section
                title="Ministry membership"
                hint="Keep these if they still serve — community members can."
              >
                {removable.ministries.map((m) => (
                  <Row
                    key={m.id}
                    checked={keepMinistries.has(m.id)}
                    onToggle={() => toggle(keepMinistries, setKeepMinistries, m.id)}
                    label={m.name}
                    note={
                      m.is_point_leader
                        ? "point leader"
                        : m.member_role === "leader"
                          ? "leader"
                          : undefined
                    }
                  />
                ))}
              </Section>
            )}

            {removable.permissions.length > 0 && (
              <Section
                title="Direct permissions"
                hint="Granted to this person specifically, outside any role."
              >
                {removable.permissions.map((p) => (
                  <Row
                    key={p.id}
                    checked={keepPerms.has(p.id)}
                    onToggle={() => toggle(keepPerms, setKeepPerms, p.id)}
                    label={p.display_name || p.key}
                    note={p.module || undefined}
                  />
                ))}
              </Section>
            )}

            {(removable.department || removable.job_title) && (
              <Section title="Profile">
                {removable.department && (
                  <Row
                    checked={keepDepartment}
                    onToggle={() => setKeepDepartment((v) => !v)}
                    label={`Department: ${removable.department}`}
                    note="shown in the Users list"
                  />
                )}
                {removable.job_title && (
                  <Row
                    checked={keepJobTitle}
                    onToggle={() => setKeepJobTitle((v) => !v)}
                    label={`Job title: ${removable.job_title}`}
                  />
                )}
              </Section>
            )}
          </div>
        )}

        <DialogFooter className="items-center">
          {!loading && removable && !removable.nothing_to_do && (
            <span className="text-xs text-muted-foreground mr-auto">
              {removedCount} removed · {keptCount} kept
            </span>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || loading || !removable || removable.nothing_to_do}
          >
            {busy ? "Converting…" : "Convert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {hint && <p className="text-xs text-muted-foreground mb-2">{hint}</p>}
      <div className={hint ? "space-y-1" : "space-y-1 mt-2"}>{children}</div>
    </div>
  );
}

function Row({
  checked,
  onToggle,
  label,
  note,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  note?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer py-1">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        className="mt-0.5"
        aria-label={`Keep ${label}`}
      />
      <span className={checked ? "" : "text-muted-foreground"}>
        <span className={checked ? "" : "line-through"}>{label}</span>
        {note && (
          <span className="ml-1.5 text-xs text-muted-foreground">· {note}</span>
        )}
      </span>
    </label>
  );
}
