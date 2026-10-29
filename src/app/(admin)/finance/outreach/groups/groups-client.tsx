"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Masthead, MastheadAction, MastheadButton, SectionBar, StatusPill } from "@/components/ffsa";

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

export type GroupRow = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  teamIds: string[];
  managers: { user_id: string; name: string; email: string | null }[];
  /** Administrators, and this group's own managers. */
  canManageTeams: boolean;
};

/** outreach_group_team_directory(): names, places and dates, no money. */
export type DirectoryTeam = {
  team_id: string;
  team_name: string;
  location: string | null;
  country: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  program_code: string | null;
  archived: boolean;
};

export type PersonOption = { id: string; name: string; email: string | null };

const statusTones: Record<string, "good" | "warn" | "quiet" | "bad"> = {
  planning: "quiet",
  active: "good",
  review: "warn",
  closed: "bad",
};

function dates(t: DirectoryTeam): string {
  const f = (d: string) => new Date(d).toLocaleDateString();
  if (t.start_date && t.end_date) return `${f(t.start_date)} – ${f(t.end_date)}`;
  if (t.start_date) return `From ${f(t.start_date)}`;
  return "—";
}

async function send(url: string, method: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return true;
    const data = await res.json().catch(() => ({}));
    toast.error(data.error || "Something went wrong");
  } catch {
    toast.error("Network error");
  }
  return false;
}

// ────────────────────────────────────────────────────────────
// SCREEN
// ────────────────────────────────────────────────────────────

export function GroupsClient({
  groups,
  directory,
  people,
  canEditGroups,
}: {
  groups: GroupRow[];
  directory: DirectoryTeam[];
  people: PersonOption[];
  /** Administrators: create, rename and delete groups, assign managers. */
  canEditGroups: boolean;
}) {
  const [editing, setEditing] = useState<GroupRow | "new" | null>(null);
  const teamById = useMemo(() => new Map(directory.map((t) => [t.team_id, t])), [directory]);

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Outreach finance · Groups"
        title="Outreach groups"
        actions={
          <>
            <MastheadAction href="/finance/outreach">All teams</MastheadAction>
            {canEditGroups && (
              <MastheadButton onClick={() => setEditing("new")}>New group</MastheadButton>
            )}
          </>
        }
      />

      <div className="space-y-7 px-5 py-7 md:px-8">
        <p className="max-w-3xl text-[13px] text-[color:var(--text-secondary)]">
          A group bundles outreach teams of one kind. Its managers see every team in it and run
          them as a co-leader would. A team can be in more than one group. Take a team out of a
          group and its managers lose access to it straight away.
        </p>

        {groups.length === 0 ? (
          <div className="border border-ink">
            <SectionBar title="Groups" meta="0 groups" />
            <p className="px-6 py-10 text-center text-[13px] text-[color:var(--text-tertiary)]">
              {canEditGroups
                ? "No groups yet. Make one with New group, then add teams and managers."
                : "You don't manage any groups yet."}
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <GroupBlock
              key={g.id}
              group={g}
              teamById={teamById}
              directory={directory}
              people={people}
              canEditGroups={canEditGroups}
              onEdit={() => setEditing(g)}
            />
          ))
        )}
      </div>

      {editing && (
        <GroupForm
          group={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// ONE GROUP
// ────────────────────────────────────────────────────────────

function GroupBlock({
  group,
  teamById,
  directory,
  people,
  canEditGroups,
  onEdit,
}: {
  group: GroupRow;
  teamById: Map<string, DirectoryTeam>;
  directory: DirectoryTeam[];
  people: PersonOption[];
  canEditGroups: boolean;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [teamToAdd, setTeamToAdd] = useState("");
  const [managerToAdd, setManagerToAdd] = useState("");
  const [busy, setBusy] = useState(false);

  const teams = group.teamIds
    .map((id) => teamById.get(id))
    .filter((t): t is DirectoryTeam => !!t)
    .sort((a, b) => a.team_name.localeCompare(b.team_name));
  const inGroup = new Set(group.teamIds);
  const addableTeams = directory.filter((t) => !t.archived && !inGroup.has(t.team_id));
  const managerIds = new Set(group.managers.map((m) => m.user_id));
  const addablePeople = people.filter((p) => !managerIds.has(p.id));

  async function run(fn: () => Promise<boolean>) {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok) router.refresh();
    return ok;
  }

  const meta = [
    group.category,
    `${teams.length} ${teams.length === 1 ? "team" : "teams"}`,
    `${group.managers.length} ${group.managers.length === 1 ? "manager" : "managers"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="border border-ink">
      <SectionBar title={group.name} meta={meta} />

      {(group.description || canEditGroups) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-3">
          <p className="text-[13px] text-[color:var(--text-secondary)]">
            {group.description || <span className="text-[color:var(--text-tertiary)]">No description</span>}
          </p>
          {canEditGroups && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={onEdit}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (
                    !confirm(
                      `Delete the group "${group.name}"? Its teams stay as they are; its managers lose access through this group.`
                    )
                  )
                    return;
                  run(() => send("/api/finance/outreach/groups", "DELETE", { id: group.id }));
                }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Teams */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              {group.canManageTeams && <TableHead className="w-[110px]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={group.canManageTeams ? 4 : 3}
                  className="py-6 text-center text-[13px] text-[color:var(--text-tertiary)]"
                >
                  No teams in this group yet.
                </TableCell>
              </TableRow>
            ) : (
              teams.map((t) => (
                <TableRow key={t.team_id}>
                  <TableCell>
                    <Link
                      href={`/finance/outreach/${t.team_id}`}
                      className="font-display text-[16px] font-black uppercase leading-none hover:text-electric"
                    >
                      {t.team_name}
                    </Link>
                    <p className="mono-label mt-1">
                      {[t.program_code, t.location, t.country].filter(Boolean).join(" · ")}
                    </p>
                  </TableCell>
                  <TableCell className="tabular whitespace-nowrap font-mono text-[12.5px]">
                    {dates(t)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <StatusPill tone={statusTones[t.status] ?? "quiet"}>{t.status}</StatusPill>
                      {t.archived && <StatusPill tone="quiet">Archived</StatusPill>}
                    </div>
                  </TableCell>
                  {group.canManageTeams && (
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !confirm(
                              `Take ${t.team_name} out of ${group.name}? This group's managers lose access to it.`
                            )
                          )
                            return;
                          run(() =>
                            send(
                              `/api/finance/outreach/groups/teams?group_id=${group.id}&team_id=${t.team_id}`,
                              "DELETE"
                            )
                          );
                        }}
                      >
                        <X className="mr-1 h-3.5 w-3.5" /> Remove
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {group.canManageTeams && (
        <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-bone px-5 py-3">
          <span className="mono-label mr-1">Add team</span>
          <Select value={teamToAdd} onValueChange={setTeamToAdd}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder={addableTeams.length ? "Pick a team…" : "Every team is already in"} />
            </SelectTrigger>
            <SelectContent>
              {addableTeams.map((t) => (
                <SelectItem key={t.team_id} value={t.team_id}>
                  {t.team_name}
                  {t.program_code ? ` · ${t.program_code}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={busy || !teamToAdd}
            onClick={async () => {
              const ok = await run(() =>
                send("/api/finance/outreach/groups/teams", "POST", {
                  group_id: group.id,
                  team_id: teamToAdd,
                })
              );
              if (ok) setTeamToAdd("");
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
      )}

      {/* Managers */}
      <div className="border-t border-ink px-5 py-4">
        <p className="mono-label mb-2">Managers</p>
        {group.managers.length === 0 ? (
          <p className="text-[13px] text-[color:var(--text-tertiary)]">Nobody manages this group yet.</p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {group.managers.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium">{m.name}</p>
                  {m.email && <p className="mono-label truncate">{m.email}</p>}
                </div>
                {canEditGroups && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(`Stop ${m.name} managing ${group.name}?`)) return;
                      run(() =>
                        send(
                          `/api/finance/outreach/groups/managers?group_id=${group.id}&user_id=${m.user_id}`,
                          "DELETE"
                        )
                      );
                    }}
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEditGroups && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select value={managerToAdd} onValueChange={setManagerToAdd}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Pick a person…" />
              </SelectTrigger>
              <SelectContent>
                {addablePeople.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.email ? ` · ${p.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !managerToAdd}
              onClick={async () => {
                const ok = await run(() =>
                  send("/api/finance/outreach/groups/managers", "POST", {
                    group_id: group.id,
                    user_id: managerToAdd,
                  })
                );
                if (ok) setManagerToAdd("");
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add manager
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────
// CREATE / EDIT
// ────────────────────────────────────────────────────────────

function GroupForm({ group, onClose }: { group: GroupRow | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(group?.name ?? "");
  const [category, setCategory] = useState(group?.category ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const ok = await send(
      "/api/finance/outreach/groups",
      group ? "PUT" : "POST",
      {
        ...(group ? { id: group.id } : {}),
        name,
        category: category || null,
        description: description || null,
      }
    );
    setLoading(false);
    if (ok) {
      onClose();
      router.refresh();
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{group ? "Edit group" : "New outreach group"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Name *</Label>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nations outreaches"
            />
          </div>
          <div>
            <Label>Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. International"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What kind of outreach this group holds"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "Saving..." : group ? "Save" : "Create group"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
