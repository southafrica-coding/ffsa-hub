"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Star, UserPlus, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PickUser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Membership = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ministry = any;

function nameOf(u: PickUser): string {
  return (
    u?.preferred_name ||
    [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
    u?.display_name ||
    u?.email ||
    "Unknown"
  );
}

function PersonPicker({
  label,
  options,
  onPick,
  disabled,
}: {
  label: string;
  options: PickUser[];
  onPick: (userId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <UserPlus className="mr-1 h-4 w-4" /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search staff…" />
          <CommandList>
            <CommandEmpty>No one found.</CommandEmpty>
            <CommandGroup>
              {options.map((u) => (
                <CommandItem
                  key={u.id}
                  value={`${nameOf(u)} ${u.email ?? ""}`}
                  onSelect={() => {
                    setOpen(false);
                    onPick(u.id);
                  }}
                >
                  <span className="truncate">{nameOf(u)}</span>
                  {u.email && (
                    <span className="ml-2 truncate text-xs text-muted-foreground">
                      {u.email}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PersonRow({
  user,
  badge,
  children,
}: {
  user: PickUser;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar src={user?.avatar_url} name={nameOf(user)} size={32} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {nameOf(user)}
            </span>
            {badge}
          </div>
          {user?.email && (
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

export function MinistryDetail({
  ministry,
  roster,
  pickable,
  isAdmin,
}: {
  ministry: Ministry;
  roster: Membership[];
  pickable: PickUser[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const leaders = roster.filter((r) => r.member_role === "leader");
  const members = roster.filter((r) => r.member_role === "member");
  const inMinistry = new Set(roster.map((r) => r.user?.id));
  const leaderIds = new Set(leaders.map((l) => l.user?.id));
  const base = `/api/ministries/${ministry.id}`;

  async function call(
    url: string,
    method: string,
    body: Record<string, unknown>,
    okMsg?: string
  ) {
    setBusy(true);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast.error(b.error ?? "Something went wrong");
      return;
    }
    if (okMsg) toast.success(okMsg);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="page-eyebrow">MINISTRY</p>
        <h1 className="page-title">
          {ministry.name}
          {!ministry.is_active && (
            <span className="ml-2 align-middle text-base text-muted-foreground">
              (retired)
            </span>
          )}
        </h1>
        {ministry.description && (
          <p className="mt-1 text-sm text-muted-foreground">{ministry.description}</p>
        )}
      </div>

      {/* Leaders */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Leaders
          </h2>
          {isAdmin && (
            <PersonPicker
              label="Add leader"
              options={pickable.filter((u) => !leaderIds.has(u.id))}
              onPick={(uid) => call(`${base}/leaders`, "POST", { user_id: uid }, "Leader added")}
              disabled={busy}
            />
          )}
        </div>
        {leaders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leaders yet.</p>
        ) : (
          <div className="space-y-2">
            {leaders.map((l) => (
              <PersonRow
                key={l.id}
                user={l.user}
                badge={
                  l.is_point_leader ? (
                    <Badge className="gap-1">
                      <Star className="h-3 w-3" /> Point Leader
                    </Badge>
                  ) : null
                }
              >
                {l.is_point_leader ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      call(`${base}/point-leader`, "PATCH", { user_id: null }, "Point Leader cleared")
                    }
                  >
                    Clear
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      call(
                        `${base}/point-leader`,
                        "PATCH",
                        { user_id: l.user.id },
                        "Point Leader updated"
                      )
                    }
                  >
                    <Star className="mr-1 h-3.5 w-3.5" /> Make Point Leader
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label="Remove leader"
                    onClick={() =>
                      call(`${base}/leaders`, "DELETE", { user_id: l.user.id }, "Leader removed")
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </PersonRow>
            ))}
          </div>
        )}
      </section>

      {/* Staff team */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Staff team
          </h2>
          <PersonPicker
            label="Add staff"
            options={pickable.filter((u) => !inMinistry.has(u.id))}
            onPick={(uid) => call(`${base}/members`, "POST", { user_id: uid }, "Staff added")}
            disabled={busy}
          />
        </div>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff yet.</p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <PersonRow
                key={m.id}
                user={m.user}
                badge={
                  m.status === "pending" ? <Badge variant="outline">Pending</Badge> : null
                }
              >
                {m.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      call(`${base}/members`, "PATCH", { membership_id: m.id }, "Approved")
                    }
                  >
                    <Check className="mr-1 h-3.5 w-3.5" /> Approve
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label="Remove from ministry"
                  onClick={() =>
                    call(`${base}/members`, "DELETE", { membership_id: m.id }, "Removed")
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              </PersonRow>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
