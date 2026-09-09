"use client";
import { Masthead } from "@/components/ffsa";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Star, UserPlus, X, Check, Plus, Trash2, ChevronUp, ChevronDown, Pencil, MoreHorizontal, FolderInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  MINISTRY_TYPES,
  MINISTRY_TYPE_LABELS,
  ministryTypeOf,
  type MinistryType,
} from "@/lib/ministries/ministry-type";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PickUser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Membership = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ministry = any;
type Subcategory = { id: string; name: string; sort_order: number };

// Group key for people who are in no sub-category at all.
const UNCATEGORIZED = "__none__";

function nameOf(u: PickUser): string {
  return (
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
  const categoriesOf = (r: Membership): string[] => r.category_ids ?? [];
  const leadsCategory = (r: Membership, categoryId: string) =>
    (r.point_leader_category_ids ?? []).includes(categoryId);
  // Rank within a group: point leaders first (ministry, then this category's
  // category lead), then other leaders, then staff — so every group reads with
  // its point leader on top, remaining leaders next, and members below, each
  // tier A–Z by name. Ranking is per group because someone can be in several
  // categories and lead only one of them.
  const rankOf = (r: Membership, groupKey: string) =>
    r.is_point_leader
      ? 0
      : leadsCategory(r, groupKey)
        ? 1
        : r.member_role === "leader"
          ? 2
          : 3;
  const sortForGroup = (rows: Membership[], groupKey: string) =>
    [...rows].sort((a, b) => {
      const rank = rankOf(a, groupKey) - rankOf(b, groupKey);
      if (rank !== 0) return rank;
      return nameOf(a.user).localeCompare(nameOf(b.user), undefined, {
        sensitivity: "base",
      });
    });
  // Group the whole team (leaders + staff) by sub-category: one bucket per
  // category (in sort order), plus a trailing "Uncategorized" bucket.
  // Categories with no one still show, so admins see the empty group they made.
  // Someone in several categories appears in each of them, so the group counts
  // can add up to more than the roster size — that's expected.
  const groups: { key: string; label: string; rows: Membership[] }[] = [
    ...subcategories.map((c) => ({
      key: c.id,
      label: c.name,
      rows: sortForGroup(
        roster.filter((r) => categoriesOf(r).includes(c.id)),
        c.id
      ),
    })),
    {
      key: UNCATEGORIZED,
      label: hasCategories ? "Uncategorized" : "",
      rows: sortForGroup(
        roster.filter((r) => categoriesOf(r).length === 0),
        UNCATEGORIZED
      ),
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
    // Point leader of THIS category — someone can be in several categories and
    // lead only one, so the badge and controls are scoped to the group.
    const isCategoryLead = inCategory && leadsCategory(r, groupKey);
    const current = categoriesOf(r);
    // Categories submenu — a member can hold several, so each toggle sends the
    // whole new set. The menu stays open so several can be ticked in a row.
    const categoryMenu = hasCategories ? (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <FolderInput className="mr-2 h-3.5 w-3.5" /> Categories
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {subcategories.map((c) => {
            const checked = current.includes(c.id);
            return (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={checked}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() =>
                  call(
                    `${base}/members`,
                    "PATCH",
                    {
                      membership_id: r.id,
                      subcategory_ids: checked
                        ? current.filter((x: string) => x !== c.id)
                        : [...current, c.id],
                    },
                    checked ? "Removed from category" : "Added to category"
                  )
                }
              >
                {c.name}
              </DropdownMenuCheckboxItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={current.length === 0}
            onClick={() =>
              call(
                `${base}/members`,
                "PATCH",
                { membership_id: r.id, subcategory_ids: [] },
                "Moved to Uncategorized"
              )
            }
          >
            Uncategorized
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ) : null;
    return (
      <PersonRow
        // Someone in several categories renders once per group, so the key has
        // to include the group or React sees duplicates.
        key={`${groupKey}:${r.id}`}
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
        {/* All row actions live behind a single overflow menu so the roster
            reads clean; every item calls the same endpoints as before. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label="Actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {isLeader ? (
              <>
                {/* Point leader OF THIS CATEGORY (only inside a real category). */}
                {inCategory &&
                  (isCategoryLead ? (
                    <DropdownMenuItem
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
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() =>
                        call(
                          `${base}/subcategories/${groupKey}/point-leader`,
                          "PATCH",
                          { user_id: r.user.id },
                          "Category point leader set"
                        )
                      }
                    >
                      <Star className="mr-2 h-3.5 w-3.5" /> Make category lead
                    </DropdownMenuItem>
                  ))}
                {/* Overall MINISTRY point leader (one per ministry). */}
                {r.is_point_leader ? (
                  <DropdownMenuItem
                    onClick={() =>
                      call(`${base}/point-leader`, "PATCH", { user_id: null }, "Ministry point leader cleared")
                    }
                  >
                    Clear ministry lead
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() =>
                      call(
                        `${base}/point-leader`,
                        "PATCH",
                        { user_id: r.user.id },
                        "Ministry point leader updated"
                      )
                    }
                  >
                    <Star className="mr-2 h-3.5 w-3.5" /> Make ministry lead
                  </DropdownMenuItem>
                )}
                {categoryMenu}
                {/* Demote to plain staff — in place, no removal. */}
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() =>
                        call(`${base}/leaders`, "DELETE", { user_id: r.user.id }, "Moved to staff")
                      }
                    >
                      Make staff
                    </DropdownMenuItem>
                  </>
                )}
              </>
            ) : (
              <>
                {r.status === "pending" && (
                  <DropdownMenuItem
                    onClick={() =>
                      call(`${base}/members`, "PATCH", { membership_id: r.id }, "Approved")
                    }
                  >
                    <Check className="mr-2 h-3.5 w-3.5" /> Approve
                  </DropdownMenuItem>
                )}
                {/* Promote an existing member to leader — in place, so it works even
                    for members whose profile isn't fully set up (the picker filter
                    only gates brand-new adds, not role changes). */}
                {isAdmin && (
                  <DropdownMenuItem
                    onClick={() =>
                      call(`${base}/leaders`, "POST", { user_id: r.user.id }, "Made a leader")
                    }
                  >
                    <Star className="mr-2 h-3.5 w-3.5" /> Make leader
                  </DropdownMenuItem>
                )}
                {categoryMenu}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() =>
                    call(`${base}/members`, "DELETE", { membership_id: r.id }, "Removed")
                  }
                >
                  <X className="mr-2 h-4 w-4" /> Remove from ministry
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </PersonRow>
    );
  }

  return (
    <>
      <Masthead
        context={[
          MINISTRY_TYPE_LABELS[ministryTypeOf(ministry.ministry_type)],
          "ministry",
          ministry.is_active ? null : "retired",
        ]
          .filter(Boolean)
          .join(" · ")}
        title={ministry.name}
        actions={
          isAdmin ? (
            <MinistryEditDialog ministry={ministry} base={base} busy={busy} call={call} />
          ) : undefined
        }
      />

      {ministry.description && (
        <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
          {ministry.description}
        </p>
      )}

      <div className="space-y-8 px-5 py-6 md:px-8 md:py-7">

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
    </>
  );
}

// Admin control to rename a ministry, edit its description, and retire /
// reactivate it. Backed by PATCH /api/ministries/[id].
function MinistryEditDialog({
  ministry,
  base,
  busy,
  call,
}: {
  ministry: Ministry;
  base: string;
  busy: boolean;
  call: (
    url: string,
    method: string,
    body: Record<string, unknown>,
    okMsg?: string
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string>(ministry.name ?? "");
  const [description, setDescription] = useState<string>(
    ministry.description ?? ""
  );
  const [isActive, setIsActive] = useState<boolean>(ministry.is_active ?? true);
  const [ministryType, setMinistryType] = useState<MinistryType>(
    ministryTypeOf(ministry.ministry_type)
  );

  function reset() {
    setName(ministry.name ?? "");
    setDescription(ministry.description ?? "");
    setIsActive(ministry.is_active ?? true);
    setMinistryType(ministryTypeOf(ministry.ministry_type));
  }

  async function submit() {
    if (!name.trim()) return;
    await call(
      base,
      "PATCH",
      {
        name: name.trim(),
        description: description.trim() || null,
        is_active: isActive,
        ministry_type: ministryType,
      },
      "Ministry updated"
    );
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) reset();
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="mr-1 h-4 w-4" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit ministry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ministry-edit-name">Name</Label>
            <Input
              id="ministry-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ministry-edit-type">Type</Label>
            {/* Native <select> on purpose — Radix popover selects don't open
                in Safari (PR #193). */}
            <select
              id="ministry-edit-type"
              className="h-10 w-full"
              value={ministryType}
              onChange={(e) => setMinistryType(e.target.value as MinistryType)}
            >
              {MINISTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MINISTRY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ministry-edit-desc">Description</Label>
            <Textarea
              id="ministry-edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this ministry does"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={!isActive}
              onChange={(e) => setIsActive(!e.target.checked)}
            />
            Retired (hidden from active ministry lists)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
