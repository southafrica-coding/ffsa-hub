"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PersonQuickView } from "@/components/people/person-quick-view";
import type { PersonRef } from "@/services/person-quick-view";
import {
  ChevronRight,
  MoreHorizontal,
  Mail,
  AlertCircle,
  Power,
  PowerOff,
  Trash2,
  ShieldCheck,
  Search,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  deriveUserLifecycle,
  formatRelativeTime,
  groupMissingFields,
  type LifecycleInfo,
  type UserLifecycleStage,
} from "@/lib/users/lifecycle";
import { UserAvatar } from "@/components/ui/user-avatar";
import { deriveJobTitle, type MinistryRole } from "@/lib/users/derive-title";

type UserRow = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  avatar_url: string | null;
  is_active: boolean;
  invited_at: string | null;
  accepted_at: string | null;
  status: string | null;
  job_title: string | null;
  department: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  marital_status: string | null;
  nationality: string | null;
  health_insurance_provider: string | null;
  health_insurance_expiry_date: string | null;
  last_sign_in_at: string | null;
  user_roles: Array<{
    id: string;
    scope_type: string | null;
    roles: { display_name: string; name?: string } | null;
  }>;
};

const MEMBERSHIP_OPTIONS = [
  { value: "none", label: "—" },
  { value: "staff", label: "Staff" },
  { value: "student", label: "Student" },
  { value: "community", label: "Community" },
] as const;

// The single membership role shown/edited in the Users list. Staff wins over
// student, student over community (mirrors the app's precedence).
function currentMembership(user: UserRow): "staff" | "student" | "community" | "none" {
  const names = new Set(
    user.user_roles.map((ur) => ur.roles?.name).filter((n): n is string => !!n)
  );
  if (names.has("staff")) return "staff";
  if (names.has("student")) return "student";
  if (names.has("community_member")) return "community";
  return "none";
}

// Fallback only — real labels come from staff_ministries (departmentLabels
// prop). Kept in sync with the ministry names for slugs not found there.
const DEPARTMENT_LABELS: Record<string, string> = {
  leadership_team: "Leadership Team",
  prayer_and_worship: "Prayer & Worship",
  media: "Media",
  hulk: "HULC",
  operations: "Operations",
  training: "Training",
  project_54: "Project 54",
  education: "Education",
  woven: "Woven",
};

const STAGE_STYLES: Record<
  UserLifecycleStage,
  { className: string; style?: React.CSSProperties }
> = {
  active: {
    className: "",
  },
  invited: {
    className: "",
    style: {
      borderColor: "hsl(210 90% 60% / 0.4)",
      color: "var(--electric)",
      background: "transparent",
    },
  },
  profile_incomplete: {
    className: "",
    style: {
      borderColor: "var(--amber-border)",
      color: "var(--amber)",
      background: "var(--yellow-dim)",
    },
  },
  pending_approval: {
    className: "",
    style: {
      borderColor: "hsl(42 95% 55% / 0.4)",
      color: "var(--ink)",
      background: "var(--yellow-dim)",
    },
  },
  inactive: {
    className: "",
    style: {
      borderColor: "hsl(0 0% 50% / 0.3)",
      color: "var(--text-tertiary)",
      background: "var(--ink)",
    },
  },
};

// A small toggleable filter pill — outline when off, solid when on.
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        " border px-3 py-1 text-xs font-medium transition-colors " +
        (active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function displayName(u: UserRow): string {
  return (
    u.display_name ??
    (u.first_name
      ? `${u.first_name} ${u.last_name ?? ""}`.trim()
      : "—")
  );
}

export function UsersTable({
  users,
  currentUserId,
  departmentLabels,
  ministryRoleByUser,
  schoolByUser,
  isSuperAdmin = false,
}: {
  users: UserRow[];
  currentUserId: string;
  // DB-backed department value→label map (from the editable Settings list).
  // Falls back to the built-in defaults for any value not present.
  departmentLabels?: Record<string, string>;
  // user_id → strongest ministry role, for the derived job title.
  ministryRoleByUser?: Record<string, MinistryRole>;
  // user_id → current school name, for a student's derived job title.
  schoolByUser?: Record<string, string>;
  // Super admins get the inline membership-role picker in the Role column.
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // Person quick-view side panel (opens on a row click).
  const [quickPerson, setQuickPerson] = useState<PersonRef | null>(null);

  async function handleSetMembership(userId: string, role: string) {
    setBusy(userId);
    try {
      const res = await fetch("/api/admin/set-membership-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, role }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }
  const [search, setSearch] = useState("");
  // Filter facets. Membership is multi-select (OR within); each category ANDs
  // with the others. "all" department = no department constraint.
  const [membershipFilter, setMembershipFilter] = useState<Set<string>>(
    () => new Set()
  );
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [insuranceExpiredOnly, setInsuranceExpiredOnly] = useState(false);
  const [insuranceExpiringOnly, setInsuranceExpiringOnly] = useState(false);
  const [profileIncompleteOnly, setProfileIncompleteOnly] = useState(false);

  const deptLabels = useMemo(
    () => ({ ...DEPARTMENT_LABELS, ...(departmentLabels ?? {}) }),
    [departmentLabels]
  );

  // Department options for the filter — live labels first, then any built-in
  // fallback not already present. Sorted by label.
  const departmentOptions = useMemo(() => {
    const bySlug = new Map<string, string>();
    for (const [slug, label] of Object.entries(deptLabels)) {
      bySlug.set(slug, label);
    }
    return [...bySlug.entries()]
      .map(([slug, label]) => ({ slug, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [deptLabels]);

  // Annotate each user once with the values every downstream step needs:
  // membership, derived lifecycle (insurance + stage), and the derived title.
  const annotated = useMemo(() => {
    return users.map((user) => {
      const membership = currentMembership(user);
      const lifecycle = deriveUserLifecycle(user);
      const title = deriveJobTitle({
        jobTitle: user.job_title,
        membership,
        departmentLabel: user.department
          ? deptLabels[user.department] ?? user.department
          : null,
        ministryRole: ministryRoleByUser?.[user.id] ?? null,
        schoolLabel: schoolByUser?.[user.id] ?? null,
      });
      return { user, membership, lifecycle, title };
    });
  }, [users, deptLabels, ministryRoleByUser, schoolByUser]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = annotated.filter(({ user, membership, lifecycle, title }) => {
      // Membership facet (OR within the selected set).
      if (membershipFilter.size > 0 && !membershipFilter.has(membership)) {
        return false;
      }
      // Department facet.
      if (departmentFilter !== "all" && user.department !== departmentFilter) {
        return false;
      }
      // Insurance-expired facet.
      if (insuranceExpiredOnly && lifecycle.insurance.state !== "expired") {
        return false;
      }
      // Insurance-expiring-soon facet.
      if (insuranceExpiringOnly && lifecycle.insurance.state !== "expiring") {
        return false;
      }
      // Profile-incomplete facet.
      if (profileIncompleteOnly && lifecycle.stage !== "profile_incomplete") {
        return false;
      }
      // Free-text search over the visible fields (incl. the derived title).
      if (q) {
        const departmentLabel = user.department
          ? deptLabels[user.department] ?? user.department
          : "";
        const haystack = [
          displayName(user),
          user.email ?? "",
          title ?? "",
          user.job_title ?? "",
          user.department ?? "",
          departmentLabel,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    // Alphabetical by the name shown in the table.
    return [...matched].sort((a, b) =>
      displayName(a.user).localeCompare(displayName(b.user), undefined, {
        sensitivity: "base",
      })
    );
  }, [
    annotated,
    search,
    membershipFilter,
    departmentFilter,
    insuranceExpiredOnly,
    insuranceExpiringOnly,
    profileIncompleteOnly,
    deptLabels,
  ]);

  function toggleMembership(value: string) {
    setMembershipFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const activeFilterCount =
    membershipFilter.size +
    (departmentFilter !== "all" ? 1 : 0) +
    (insuranceExpiredOnly ? 1 : 0) +
    (insuranceExpiringOnly ? 1 : 0) +
    (profileIncompleteOnly ? 1 : 0);

  function clearFilters() {
    setMembershipFilter(new Set());
    setDepartmentFilter("all");
    setInsuranceExpiredOnly(false);
    setInsuranceExpiringOnly(false);
    setProfileIncompleteOnly(false);
  }

  async function callApi(
    path: string,
    body: Record<string, unknown>,
    successMessage?: string
  ) {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Something went wrong");
        return false;
      }
      if (successMessage) alert(successMessage);
      router.refresh();
      return true;
    } catch {
      alert("Network error");
      return false;
    }
  }

  async function handleResendInvite(user: UserRow) {
    setBusy(user.id);
    await callApi(
      "/api/admin/resend-user-invite",
      { user_id: user.id },
      `Invite resent to ${user.email}`
    );
    setBusy(null);
  }

  async function handleSendReminder(user: UserRow) {
    setBusy(user.id);
    await callApi(
      "/api/admin/send-profile-reminder",
      { user_id: user.id },
      `Reminder sent to ${user.email}`
    );
    setBusy(null);
  }

  async function handleSetActive(user: UserRow, is_active: boolean) {
    setBusy(user.id);
    await callApi("/api/admin/set-user-active", {
      user_id: user.id,
      is_active,
    });
    setBusy(null);
  }

  async function handleDelete(user: UserRow) {
    if (
      !confirm(
        `Delete ${displayName(user)}? This permanently removes their account. Audit history is preserved.`
      )
    ) {
      return;
    }
    setBusy(user.id);
    await callApi("/api/admin/delete-user", { user_id: user.id });
    setBusy(null);
  }

  return (
    <div className=" border bg-card">
      <div className="p-3 border-b space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, job title, or department..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Department facet */}
          <select
            className="h-9 border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            aria-label="Filter by department"
          >
            <option value="all">All departments</option>
            {departmentOptions.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.label}
              </option>
            ))}
          </select>

          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              onClick={clearFilters}
            >
              <X className="h-4 w-4" />
              Clear
            </Button>
          )}
        </div>

        {/* Visible membership + status facets — click to toggle. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(["staff", "student", "community"] as const).map((value) => (
            <FilterChip
              key={value}
              active={membershipFilter.has(value)}
              onClick={() => toggleMembership(value)}
            >
              {MEMBERSHIP_OPTIONS.find((o) => o.value === value)?.label ?? value}
            </FilterChip>
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <FilterChip
            active={insuranceExpiredOnly}
            onClick={() => setInsuranceExpiredOnly((v) => !v)}
          >
            Insurance expired
          </FilterChip>
          <FilterChip
            active={insuranceExpiringOnly}
            onClick={() => setInsuranceExpiringOnly((v) => !v)}
          >
            Insurance expiring soon
          </FilterChip>
          <FilterChip
            active={profileIncompleteOnly}
            onClick={() => setProfileIncompleteOnly((v) => !v)}
          >
            Profile incomplete
          </FilterChip>
        </div>

        <p className="text-xs text-muted-foreground">
          Showing {filteredUsers.length} of {users.length}
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Job Title</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Activity</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredUsers.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="text-center text-muted-foreground py-8"
              >
                No users found
              </TableCell>
            </TableRow>
          ) : (
            filteredUsers.map(({ user, lifecycle, title }) => {
              const stageStyle = STAGE_STYLES[lifecycle.stage];
              const isSelf = user.id === currentUserId;
              const isBusy = busy === user.id;

              return (
                <TableRow
                  key={user.id}
                  className="cursor-pointer"
                  onClick={() =>
                    setQuickPerson({ userId: user.id, name: displayName(user) })
                  }
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        src={user.avatar_url}
                        name={user.first_name ?? user.email}
                        size={28}
                      />
                      <span className="truncate">{displayName(user)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {title ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.department
                      ? deptLabels[user.department] ?? user.department
                      : "—"}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {isSuperAdmin ? (
                      <select
                        className="h-8 border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                        value={currentMembership(user)}
                        disabled={isBusy}
                        onChange={(e) => handleSetMembership(user.id, e.target.value)}
                        aria-label="Membership role"
                      >
                        {MEMBERSHIP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        {MEMBERSHIP_OPTIONS.find((o) => o.value === currentMembership(user))?.label ?? "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 items-start">
                      <Badge
                        variant="outline"
                        className={stageStyle.className}
                        style={stageStyle.style}
                        title={lifecycle.description}
                      >
                        {lifecycle.label}
                      </Badge>
                      {lifecycle.stage === "profile_incomplete" && (
                        <MissingFieldsPopover lifecycle={lifecycle} />
                      )}
                      {lifecycle.insurance.state === "expired" && (
                        <Badge
                          variant="outline"
                          style={{
                            borderColor: "hsl(0 84% 60% / 0.4)",
                            color: "hsl(var(--destructive))",
                            background: "transparent",
                          }}
                          title={`Health insurance expired ${lifecycle.insurance.expiryDate ?? ""}`}
                        >
                          Insurance expired
                        </Badge>
                      )}
                      {lifecycle.insurance.state === "expiring" && (
                        <Badge
                          variant="outline"
                          style={{
                            borderColor: "var(--amber-border)",
                            color: "var(--amber)",
                            background: "var(--yellow-dim)",
                          }}
                          title={`Health insurance expires ${lifecycle.insurance.expiryDate ?? ""}`}
                        >
                          Insurance expires in {lifecycle.insurance.daysLeft ?? 0}d
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    <ActivityCell user={user} stage={lifecycle.stage} />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground"
                            disabled={isBusy}
                            aria-label="User actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            {lifecycle.label}
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />

                          {lifecycle.stage === "invited" && (
                            <DropdownMenuItem
                              onClick={() => handleResendInvite(user)}
                            >
                              <Mail className="h-4 w-4 mr-2" />
                              Resend invite
                            </DropdownMenuItem>
                          )}

                          {lifecycle.stage === "profile_incomplete" && (
                            <DropdownMenuItem
                              onClick={() => handleSendReminder(user)}
                            >
                              <AlertCircle className="h-4 w-4 mr-2" />
                              Send profile reminder
                            </DropdownMenuItem>
                          )}

                          {lifecycle.stage === "pending_approval" && (
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(`/users/${user.id}`)
                              }
                            >
                              <ShieldCheck className="h-4 w-4 mr-2" />
                              Review & approve
                            </DropdownMenuItem>
                          )}

                          {!isSelf && lifecycle.stage !== "inactive" && (
                            <DropdownMenuItem
                              onClick={() => handleSetActive(user, false)}
                            >
                              <PowerOff className="h-4 w-4 mr-2" />
                              Mark inactive
                            </DropdownMenuItem>
                          )}

                          {lifecycle.stage === "inactive" && (
                            <DropdownMenuItem
                              onClick={() => handleSetActive(user, true)}
                            >
                              <Power className="h-4 w-4 mr-2" />
                              Reactivate
                            </DropdownMenuItem>
                          )}

                          {!isSelf && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => handleDelete(user)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete user
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <PersonQuickView
        personRef={quickPerson}
        onClose={() => setQuickPerson(null)}
      />
    </div>
  );
}

// The "X of Y fields" summary under the "Profile Incomplete" badge, upgraded
// to a click-to-open list of exactly which required fields are still missing —
// so a super admin can see what's blocking the user without opening their form.
function MissingFieldsPopover({ lifecycle }: { lifecycle: LifecycleInfo }) {
  const groups = groupMissingFields(lifecycle.missingFields);
  const count = lifecycle.missingFields.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Stop the row's onClick from navigating to /users/[id].
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-amber underline decoration-dotted underline-offset-2 hover:text-amber dark:text-amber dark:hover:text-amber"
        >
          <AlertCircle className="h-3 w-3 shrink-0" />
          {count} missing · {lifecycle.completedRequired}/{lifecycle.totalRequired}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-semibold mb-2">
          Missing {count} field{count === 1 ? "" : "s"}
        </p>
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing outstanding.</p>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <div key={group.section}>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {group.section}
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {group.fields.map((field) => (
                    <li key={field.field} className="text-xs">
                      {field.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ActivityCell({
  user,
  stage,
}: {
  user: UserRow;
  stage: UserLifecycleStage;
}) {
  if (stage === "invited") {
    return (
      <div className="flex flex-col">
        <span>Invited {formatRelativeTime(user.invited_at)}</span>
      </div>
    );
  }

  if (user.last_sign_in_at) {
    return <span>Last seen {formatRelativeTime(user.last_sign_in_at)}</span>;
  }

  if (user.accepted_at) {
    return <span>Joined {formatRelativeTime(user.accepted_at)}</span>;
  }

  return <span>Never</span>;
}
