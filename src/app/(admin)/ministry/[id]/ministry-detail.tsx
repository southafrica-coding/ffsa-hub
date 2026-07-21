"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Star, UserPlus, X, Check, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
type Subcategory = { id: string; name: string; sort_order: number };

// Select needs a non-empty string value; this stands in for "no sub-category".
const UNCATEGORIZED = "__none__";

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
  subcategories,
  isAdmin,
}: {
  ministry: Ministry;
  roster: Membership[];
  pickable: PickUser[];
  subcategories: Subcategory[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const leaders = roster.filter((r) => r.member_role === "leader");
  const inMinistry = new Set(roster.map((r) => r.user?.id));
  const leaderIds = new Set(leaders.map((l) => l.user?.id));
  const base = `/api/ministries/${ministry.id}`;

  const hasCategories = subcategories.length > 0;
  // Group the whole team (leaders + staff) by sub-category: one bucket per
  // category (in sort order), plus a trailing "Uncategorized" bucket. `roster`
  // is already ordered leaders-first, so leaders sit at the top of each group.
  // Categories with no one still show, so admins see the empty group they made.
  const groups: { key: string; label: string; rows: Membership[] }[] = [
    ...subcategories.map((c) => ({
      key: c.id,
      label: c.name,
      rows: roster.filter((r) => r.subcategory_id === c.id),
    })),
    {
      key: UNCATEGORIZED,
      label: hasCategories ? "Uncategorized" : "",
      rows: roster.filter((r) => !r.subcategory_id),
    },
  ];

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

  // Persist a new category order by writing each category's sort_order to its
  // position. Writes run in parallel, then one refresh.
  async function reorderCategories(orderedIds: string[]) {
    setBusy(true);
    const results = await Promise.all(
      orderedIds.map((sid, i) =>
        fetch(`${base}/subcategories/${sid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: i }),
        })
      )
    );
    setBusy(false);
    if (results.some((r) => !r.ok)) {
      toast.error("Couldn't reorder categories");
      return;
    }
    router.refresh();
  }

  // One row for anyone on the team. Leaders and staff share the category
  // picker; the action buttons differ by role. `groupKey` is the sub-category
  // this row is being rendered under (or UNCATEGORIZED) — used to scope the
  // per-category point-leader control.
  function renderRow(r: Membership, groupKey: string) {
    const isLeader = r.member_role === "leader";
    const inCategory = groupKey !== UNCATEGORIZED;
    // r.subcategory_id === groupKey here, so this flag is the point leader of
    // THIS category. Only meaningful inside a real category group.
    const isCategoryLead = inCategory && r.is_category_point_leader;
    return (
      <PersonRow
        key={r.id}
        user={r.user}
        badge={
          <>
            {r.is_point_leader && (
              <Badge className="gap-1">
                <Star className="h-3 w-3" /> Ministry Point Leader
              </Badge>
            )}
            {isCategoryLead && (
              <Badge variant="secondary" className="gap-1">
                <Star className="h-3 w-3" /> Category Point Leader
              </Badge>
            )}
            {isLeader && !r.is_point_leader && !isCategoryLead && (
              <Badge variant="secondary">Leader</Badge>
            )}
            {r.status === "pending" && <Badge variant="outline">Pending</Badge>}
          </>
        }
      >
        {hasCategories && (
          <Select
            value={r.subcategory_id ?? UNCATEGORIZED}
            onValueChange={(v) =>
              call(
                `${base}/members`,
                "PATCH",
                {
                  membership_id: r.id,
                  subcategory_id: v === UNCATEGORIZED ? null : v,
                },
                "Moved"
              )
            }
            disabled={busy}
          >
            <SelectTrigger className="h-8 w-40" aria-label="Category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNCATEGORIZED}>Uncategorized</SelectItem>
              {subcategories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isLeader ? (
          <>
            {/* Point leader OF THIS CATEGORY (only inside a real category). */}
            {inCategory &&
              (isCategoryLead ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    call(
                      `${base}/subcategories/${groupKey}/point-leader`,
                      "PATCH",
                      { user_id: null },
                      "Category point leader cleared"
                    )
                  }
                >
                  Clear category lead
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    call(
                      `${base}/subcategories/${groupKey}/point-leader`,
                      "PATCH",
                      { user_id: r.user.id },
                      "Category point leader set"
                    )
                  }
                >
                  <Star className="mr-1 h-3.5 w-3.5" /> Category lead
                </Button>
              ))}
            {/* Overall MINISTRY point leader (one per ministry). */}
            {r.is_point_leader ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  call(`${base}/point-leader`, "PATCH", { user_id: null }, "Ministry point leader cleared")
                }
              >
                Clear ministry lead
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
                    { user_id: r.user.id },
                    "Ministry point leader updated"
                  )
                }
              >
                <Star className="mr-1 h-3.5 w-3.5" /> Ministry lead
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label="Remove leader"
                onClick={() =>
                  call(`${base}/leaders`, "DELETE", { user_id: r.user.id }, "Leader removed")
                }
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </>
        ) : (
          <>
            {r.status === "pending" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  call(`${base}/members`, "PATCH", { membership_id: r.id }, "Approved")
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
                call(`${base}/members`, "DELETE", { membership_id: r.id }, "Removed")
              }
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
      </PersonRow>
    );
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

      {/* Categories — admin-managed list that sub-divides the team. */}
      {isAdmin && (
        <CategoryManager
          subcategories={subcategories}
          base={base}
          busy={busy}
          call={call}
          onReorder={reorderCategories}
        />
      )}

      {/* Team (leaders + staff), grouped by sub-category. */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Team
          </h2>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <PersonPicker
                label="Add leader"
                options={pickable.filter((u) => !leaderIds.has(u.id))}
                onPick={(uid) => call(`${base}/leaders`, "POST", { user_id: uid }, "Leader added")}
                disabled={busy}
              />
            )}
            <PersonPicker
              label="Add staff"
              options={pickable.filter((u) => !inMinistry.has(u.id))}
              onPick={(uid) => call(`${base}/members`, "POST", { user_id: uid }, "Staff added")}
              disabled={busy}
            />
          </div>
        </div>
        {roster.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one on the team yet.</p>
        ) : (
          <div className="space-y-5">
            {groups.map((g) =>
              // Hide the trailing "Uncategorized" group only when it's empty.
              g.rows.length === 0 && g.key === UNCATEGORIZED ? null : (
                <div key={g.key} className="space-y-2">
                  {g.label && (
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.label}{" "}
                      <span className="text-muted-foreground/60">({g.rows.length})</span>
                    </h3>
                  )}
                  {g.rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No one here yet.</p>
                  ) : (
                    g.rows.map((r) => renderRow(r, g.key))
                  )}
                </div>
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function CategoryManager({
  subcategories,
  base,
  busy,
  call,
  onReorder,
}: {
  subcategories: Subcategory[];
  base: string;
  busy: boolean;
  call: (
    url: string,
    method: string,
    body: Record<string, unknown>,
    okMsg?: string
  ) => Promise<void>;
  onReorder: (orderedIds: string[]) => void;
}) {
  const [newName, setNewName] = useState("");
  // Local draft names keyed by category id, so each row's input is editable.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const nameFor = (c: Subcategory) => drafts[c.id] ?? c.name;

  // Move a category up/down and persist the new order (used to put a chosen
  // category, e.g. "Training Team", first).
  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= subcategories.length) return;
    const ids = subcategories.map((c) => c.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    onReorder(ids);
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Categories
      </h2>

      {subcategories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No categories yet. Add one to group the staff team.
        </p>
      ) : (
        <div className="space-y-2">
          {subcategories.map((c, index) => {
            const draft = nameFor(c).trim();
            return (
              <div key={c.id} className="flex items-center gap-2">
                <div className="flex flex-col">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={busy || index === 0}
                    aria-label={`Move ${c.name} up`}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={busy || index === subcategories.length - 1}
                    aria-label={`Move ${c.name} down`}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <Input
                  value={nameFor(c)}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [c.id]: e.target.value }))
                  }
                  className="h-8 max-w-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || draft === "" || draft === c.name}
                  onClick={() =>
                    call(
                      `${base}/subcategories/${c.id}`,
                      "PATCH",
                      { name: draft },
                      "Category renamed"
                    )
                  }
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label={`Delete ${c.name}`}
                  onClick={() =>
                    call(
                      `${base}/subcategories/${c.id}`,
                      "DELETE",
                      {},
                      "Category deleted"
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Input
          placeholder="New category name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="h-8 max-w-xs"
        />
        <Button
          size="sm"
          disabled={busy || newName.trim() === ""}
          onClick={async () => {
            await call(
              `${base}/subcategories`,
              "POST",
              { name: newName.trim() },
              "Category added"
            );
            setNewName("");
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
    </section>
  );
}
