"use client";

import { useMemo, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  Link as LinkIcon,
  MailWarning,
  UserMinus,
  Lock,
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
import { getInsuranceConfirmation } from "@/lib/users/profile-fields";
import { UserAvatar } from "@/components/ui/user-avatar";
import { deriveJobTitle, type MinistryRole } from "@/lib/users/derive-title";
import { ConvertToCommunityDialog } from "./convert-to-community-dialog";
import { SetDepartmentDialog } from "./set-department-dialog";
import { formatInviteDate } from "@/lib/schools/setup-invite-schedule";
import {
  SuperAdminBadge,
  SUPER_ADMIN_LOCKED_NOTE,
} from "@/components/super-admin-badge";
import { ConfirmAccessDialog } from "@/components/confirm-access-dialog";
import {
  accessChangeReducer,
  isConfirming,
  membershipChangeTitle,
  postAccessChange,
  shownValue,
  IDLE,
  type AccessChangeState,
} from "@/lib/users/access-change";

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
  /** Setup link held until this date (migration 230). */
  setup_invite_due_on?: string | null;
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
  /** Open-ended medical scheme: no expiry, re-confirmed yearly (migration 211). */
  health_insurance_no_expiry?: boolean | null;
  health_insurance_confirmed_at?: string | null;
  last_sign_in_at: string | null;
  /** No password has ever been set — they cannot sign in (migration 203). */
  needs_setup?: boolean;
  /** Their address has bounced, so any link we email is dropped unsent. */
  email_suppressed?: boolean;
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

type Membership = "staff" | "student" | "community" | "none";

/** Wording for the confirm dialog and toasts ("—" reads badly in a sentence). */
function membershipLabel(value: Membership): string {
  return value === "none"
    ? "no membership role"
    : MEMBERSHIP_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

// The single membership role shown/edited in the Users list. Staff wins over
// student, student over community (mirrors the app's precedence).
export function currentMembership(user: UserRow): Membership {
  const names = new Set(
    (user.user_roles ?? []).map((ur) => ur.roles?.name).filter((n): n is string => !!n)
  );
  if (names.has("staff")) return "staff";
  if (names.has("student")) return "student";
  if (names.has("community_member")) return "community";
  return "none";
}

// The two roles a community member is allowed to keep. Anything else is
// elevated access that the Role dropdown does NOT remove — see
// /api/admin/convert-to-community.
const COMMUNITY_FLOOR_ROLES = new Set(["community_member", "self_service"]);

/** Roles beyond the community floor — job titles, admin, super_admin, … */
export function elevatedRoleCount(user: UserRow): number {
  return (user.user_roles ?? []).filter(
    (ur) => ur.roles?.name && !COMMUNITY_FLOOR_ROLES.has(ur.roles.name)
  ).length;
}

export function holdsSuperAdmin(user: UserRow): boolean {
  return (user.user_roles ?? []).some((ur) => ur.roles?.name === "super_admin");
}

/** Already a plain community member as far as the list can tell. */
function isCommunityOnly(user: UserRow): boolean {
  return (
    currentMembership(user) === "community" &&
    elevatedRoleCount(user) === 0 &&
    !user.department &&
    !user.job_title
  );
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
  invite_scheduled: {
    className: "",
    style: {
      borderColor: "hsl(210 90% 60% / 0.4)",
      borderStyle: "dashed",
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
      borderColor: "#FFF4D9",
      color: "#0A0A0A",
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
  departmentOptions: staffDepartmentOptions = [],
  ministryRoleByUser,
  schoolByUser,
  awaitingArrivalByUser,
  isSuperAdmin = false,
  canChangeSuperAdmins = false,
}: {
  users: UserRow[];
  currentUserId: string;
  // DB-backed department value→label map (from the editable Settings list).
  // Falls back to the built-in defaults for any value not present.
  departmentLabels?: Record<string, string>;
  // Active main ministries a staff member can be given as their department.
  departmentOptions?: { value: string; label: string }[];
  // user_id → strongest ministry role, for the derived job title.
  ministryRoleByUser?: Record<string, MinistryRole>;
  // user_id → current school name, for a student's derived job title.
  schoolByUser?: Record<string, string>;
  // user_id → upcoming school they're accepted to but haven't arrived at.
  awaitingArrivalByUser?: Record<string, { school: string; startsOn: string | null }>;
  // Super admins get the inline membership-role picker in the Role column.
  isSuperAdmin?: boolean;
  // Only a real super_admin may change a super admin's account; a General
  // Admin sees those rows locked. The API refuses it either way.
  canChangeSuperAdmins?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // Person quick-view side panel (opens on a row click).
  const [quickPerson, setQuickPerson] = useState<PersonRef | null>(null);
  // The "they've left staff" picker — see convert-to-community-dialog.
  const [converting, setConverting] = useState<{
    userId: string;
    name: string;
  } | null>(null);
  // Someone just made Staff — prompt for their department straight away.
  const [pickingDepartment, setPickingDepartment] = useState<{
    userId: string;
    name: string;
    department: string | null;
  } | null>(null);

  // The membership dropdown never saves on change: picking a value opens a
  // confirmation, and the select keeps showing the saved value until Confirm
  // (and falls back to it if the save fails). See lib/users/access-change.ts.
  const [membershipChange, dispatchMembership] = useReducer(
    accessChangeReducer<Membership>,
    IDLE as AccessChangeState<Membership>
  );
  const membershipUser =
    membershipChange.status === "idle"
      ? null
      : users.find((u) => u.id === membershipChange.key) ?? null;

  async function confirmMembership() {
    if (membershipChange.status !== "confirming" || !membershipUser) return;
    const { to, from } = membershipChange;
    const name = displayName(membershipUser);
    dispatchMembership({ type: "confirm" });
    const result = await postAccessChange(
      "/api/admin/set-membership-role",
      { user_id: membershipUser.id, role: to },
      `Could not change ${name}'s membership role`
    );
    if (!result.ok) {
      toast.error(result.error);
      dispatchMembership({ type: "fail", error: result.error });
      return;
    }
    toast.success(
      to === "none"
        ? `${name}'s membership role was cleared`
        : `${name} is now ${membershipLabel(to)}`
    );
    dispatchMembership({ type: "succeed" });
    if (to === "staff" && from !== "staff") {
      setPickingDepartment({
        userId: membershipUser.id,
        name,
        department: membershipUser.department,
      });
    }
    router.refresh();
  }

  // Mark inactive / Reactivate: same confirm-then-toast treatment.
  const [activeChange, setActiveChange] = useState<{
    user: UserRow;
    is_active: boolean;
  } | null>(null);
  const [activeSaving, setActiveSaving] = useState(false);

  async function confirmSetActive() {
    if (!activeChange) return;
    const { user, is_active } = activeChange;
    const name = displayName(user);
    setActiveSaving(true);
    setBusy(user.id);
    const result = await postAccessChange(
      "/api/admin/set-user-active",
      { user_id: user.id, is_active },
      is_active ? `Could not reactivate ${name}` : `Could not mark ${name} inactive`
    );
    setActiveSaving(false);
    setBusy(null);
    setActiveChange(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(is_active ? `${name} reactivated` : `${name} marked inactive`);
    router.refresh();
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
  const [insuranceConfirmDueOnly, setInsuranceConfirmDueOnly] = useState(false);
  const [profileIncompleteOnly, setProfileIncompleteOnly] = useState(false);
  // Accepted students who haven't arrived yet: show only them, hide them, or
  // (both off) no constraint.
  const [arrivalFilter, setArrivalFilter] = useState<"all" | "only" | "hide">("all");

  const deptLabels = useMemo(
    () => ({ ...DEPARTMENT_LABELS, ...(departmentLabels ?? {}) }),
    [departmentLabels]
  );

  // Department options for the filter — only departments people actually hold,
  // labelled from the Ministry tab. Listing every known slug offered choices
  // that always return nothing: part-time ministries (never selectable as a
  // department) and retired fallback slugs. Driving the list off the data also
  // means a since-retired ministry stays filterable while anyone is still on
  // it. Sorted by label.
  const departmentOptions = useMemo(() => {
    const bySlug = new Map<string, string>();
    for (const user of users) {
      const slug = user.department;
      if (!slug) continue;
      bySlug.set(slug, deptLabels[slug] ?? slug);
    }
    return [...bySlug.entries()]
      .map(([slug, label]) => ({ slug, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [deptLabels, users]);

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
      // Open-ended policy overdue its annual re-confirmation. Deliberately
      // separate from the two expiry facets — a no-expiry policy matches
      // neither of those, by design.
      if (insuranceConfirmDueOnly) {
        const level = getInsuranceConfirmation(user).level;
        if (level !== "due" && level !== "blocking") return false;
      }
      // Profile-incomplete facet.
      if (profileIncompleteOnly && lifecycle.stage !== "profile_incomplete") {
        return false;
      }
      // Not-arrived-yet facet.
      if (arrivalFilter !== "all") {
        const awaiting = !!awaitingArrivalByUser?.[user.id];
        if (arrivalFilter === "only" ? !awaiting : awaiting) return false;
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
    arrivalFilter,
    awaitingArrivalByUser,
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
    (insuranceConfirmDueOnly ? 1 : 0) +
    (profileIncompleteOnly ? 1 : 0) +
    (arrivalFilter !== "all" ? 1 : 0);

  function clearFilters() {
    setMembershipFilter(new Set());
    setDepartmentFilter("all");
    setInsuranceExpiredOnly(false);
    setInsuranceExpiringOnly(false);
    setInsuranceConfirmDueOnly(false);
    setProfileIncompleteOnly(false);
    setArrivalFilter("all");
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

  // The escape hatch for the one case email can never fix: a suppressed
  // address. Puts the link on the clipboard so it can be sent by hand, which
  // is what deleting-and-recreating the account used to be for.
  async function handleCopySetupLink(user: UserRow) {
    setBusy(user.id);
    try {
      const res = await fetch("/api/admin/setup-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Could not create a setup link");
        return;
      }
      try {
        await navigator.clipboard.writeText(data.url);
        alert(
          `Setup link copied — valid 30 days. Send it to ${user.email} yourself.`
        );
      } catch {
        // Clipboard access can be refused (insecure origin, permissions).
        // Showing the link still beats failing: it can be copied by hand.
        prompt("Copy this setup link (valid 30 days):", data.url);
      }
    } catch {
      alert("Network error");
    } finally {
      setBusy(null);
    }
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

  async function handleDelete(user: UserRow) {
    if (
      !confirm(
        `Delete ${displayName(user)}? This permanently removes their account. ` +
          `Their application is kept but is unlinked from the person, and their ` +
          `roles and enrolments go with the account. ` +
          `If they simply can't sign in, use "Copy setup link" instead.`
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
            active={insuranceConfirmDueOnly}
            onClick={() => setInsuranceConfirmDueOnly((v) => !v)}
          >
            Insurance confirm due
          </FilterChip>
          <FilterChip
            active={profileIncompleteOnly}
            onClick={() => setProfileIncompleteOnly((v) => !v)}
          >
            Profile incomplete
          </FilterChip>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <FilterChip
            active={arrivalFilter === "only"}
            onClick={() => setArrivalFilter((v) => (v === "only" ? "all" : "only"))}
          >
            Not arrived yet
          </FilterChip>
          <FilterChip
            active={arrivalFilter === "hide"}
            onClick={() => setArrivalFilter((v) => (v === "hide" ? "all" : "hide"))}
          >
            Hide not arrived
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
              const targetIsSuper = holdsSuperAdmin(user);
              const locked = targetIsSuper && !canChangeSuperAdmins;

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
                      {targetIsSuper && <SuperAdminBadge />}
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
                    {isSuperAdmin && !locked ? (
                      <select
                        className="h-8 border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                        value={shownValue(
                          membershipChange,
                          user.id,
                          currentMembership(user)
                        )}
                        disabled={
                          isBusy ||
                          (membershipChange.status === "saving" &&
                            membershipChange.key === user.id)
                        }
                        onChange={(e) =>
                          dispatchMembership({
                            type: "request",
                            key: user.id,
                            from: currentMembership(user),
                            to: e.target.value as Membership,
                          })
                        }
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
                      {awaitingArrivalByUser?.[user.id] && (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                          title={`Accepted to ${awaitingArrivalByUser[user.id].school}${
                            awaitingArrivalByUser[user.id].startsOn
                              ? `, which starts ${formatInviteDate(awaitingArrivalByUser[user.id].startsOn!)}`
                              : ""
                          } — not marked arrived yet.`}
                        >
                          Not arrived yet
                        </Badge>
                      )}
                      {/* "Invited" already implies no password, so only flag
                          the surprising case: someone who looks joined but
                          still cannot sign in. That mismatch is what used to
                          get diagnosed by deleting the account. */}
                      {user.needs_setup && lifecycle.stage !== "invited" && (
                        <Badge
                          variant="outline"
                          className="text-amber-700 border-amber-300"
                          title="This account has never had a password set, so they cannot sign in. Use Copy setup link."
                        >
                          No password yet
                        </Badge>
                      )}
                      {user.email_suppressed && (
                        <Badge
                          variant="outline"
                          className="text-red-700 border-red-300"
                          title="This address has bounced before, so any link we email is dropped unsent. Use Copy setup link and send it another way."
                        >
                          <MailWarning className="h-3 w-3 mr-1" />
                          Email bouncing
                        </Badge>
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
                      {(() => {
                        // An open-ended policy never expires, so it earns no
                        // expiry badge — only this one, once its annual
                        // re-confirmation is overdue.
                        const confirm = getInsuranceConfirmation(user);
                        if (confirm.level !== "due" && confirm.level !== "blocking") {
                          return null;
                        }
                        return (
                          <Badge
                            variant="outline"
                            style={{
                              borderColor: "var(--amber-border)",
                              color: "var(--amber)",
                              background: "var(--yellow-dim)",
                            }}
                            title={
                              confirm.dueOn
                                ? `Annual health-insurance confirmation was due ${confirm.dueOn}`
                                : "Health insurance has never been confirmed"
                            }
                          >
                            Insurance confirm due
                          </Badge>
                        );
                      })()}
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

                          {lifecycle.stage === "invite_scheduled" && (
                            <DropdownMenuItem
                              onClick={() => handleResendInvite(user)}
                            >
                              <Mail className="h-4 w-4 mr-2" />
                              Send setup link now
                            </DropdownMenuItem>
                          )}

                          {user.needs_setup && (
                            <DropdownMenuItem
                              onClick={() => handleCopySetupLink(user)}
                            >
                              <LinkIcon className="h-4 w-4 mr-2" />
                              Copy setup link
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

                          {locked && (
                            <DropdownMenuItem
                              disabled
                              className="items-start whitespace-normal text-xs"
                            >
                              <Lock className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
                              {SUPER_ADMIN_LOCKED_NOTE}
                            </DropdownMenuItem>
                          )}

                          {!isSelf && !locked && lifecycle.stage !== "inactive" && (
                            <DropdownMenuItem
                              onClick={() => setActiveChange({ user, is_active: false })}
                            >
                              <PowerOff className="h-4 w-4 mr-2" />
                              Mark inactive
                            </DropdownMenuItem>
                          )}

                          {lifecycle.stage === "inactive" && (
                            <DropdownMenuItem
                              onClick={() => setActiveChange({ user, is_active: true })}
                            >
                              <Power className="h-4 w-4 mr-2" />
                              Reactivate
                            </DropdownMenuItem>
                          )}

                          {!isSelf && !locked && isSuperAdmin && !isCommunityOnly(user) && (
                            <DropdownMenuItem
                              onClick={() =>
                                setConverting({
                                  userId: user.id,
                                  name: displayName(user),
                                })
                              }
                            >
                              <UserMinus className="h-4 w-4 mr-2" />
                              Convert to community member
                            </DropdownMenuItem>
                          )}

                          {!isSelf && !locked && (
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

      {membershipUser && membershipChange.status !== "idle" && (
        <ConfirmAccessDialog
          open={isConfirming(membershipChange)}
          title={membershipChangeTitle(
            displayName(membershipUser),
            membershipLabel(membershipChange.from),
            membershipLabel(membershipChange.to)
          )}
          confirmLabel="Change role"
          busy={membershipChange.status === "saving"}
          onConfirm={confirmMembership}
          onCancel={() => dispatchMembership({ type: "cancel" })}
        >
          <p>
            This changes what {displayName(membershipUser)} can see and do in the
            hub. Their job titles and permission grants are not touched; if they
            hold no other titles, their department is cleared.
          </p>
          {/* Community only swaps the label — say so rather than letting it
              look like the demotion it isn't. */}
          {membershipChange.to === "community" &&
            elevatedRoleCount(membershipUser) > 0 && (
              <p>
                <strong>
                  {displayName(membershipUser)} still holds{" "}
                  {elevatedRoleCount(membershipUser)} other role
                  {elevatedRoleCount(membershipUser) === 1 ? "" : "s"}
                </strong>
                , plus any permissions and ministry memberships — all of which
                keep working. To actually remove staff access, cancel and use
                &ldquo;Convert to community member&rdquo; in the ⋯ menu.
              </p>
            )}
        </ConfirmAccessDialog>
      )}

      {activeChange && (
        <ConfirmAccessDialog
          open
          title={
            activeChange.is_active
              ? `Reactivate ${displayName(activeChange.user)}?`
              : `Mark ${displayName(activeChange.user)} inactive?`
          }
          confirmLabel={activeChange.is_active ? "Reactivate" : "Mark inactive"}
          destructive={!activeChange.is_active}
          busy={activeSaving}
          onConfirm={confirmSetActive}
          onCancel={() => setActiveChange(null)}
        >
          <p>
            {activeChange.is_active
              ? `${displayName(activeChange.user)} will be marked active again, with the roles and permissions they already hold.`
              : `${displayName(activeChange.user)} will be marked inactive. Their roles and profile are kept, so they can be reactivated later.`}
          </p>
        </ConfirmAccessDialog>
      )}

      {converting && (
        <ConvertToCommunityDialog
          userId={converting.userId}
          personName={converting.name}
          open
          onOpenChange={(o) => {
            if (!o) setConverting(null);
          }}
        />
      )}
      {pickingDepartment && (
        <SetDepartmentDialog
          userId={pickingDepartment.userId}
          personName={pickingDepartment.name}
          currentDepartment={pickingDepartment.department}
          options={staffDepartmentOptions}
          open
          onOpenChange={(o) => {
            if (!o) setPickingDepartment(null);
          }}
        />
      )}
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

  if (stage === "invite_scheduled" && user.setup_invite_due_on) {
    return <span>Setup link on {formatInviteDate(user.setup_invite_due_on)}</span>;
  }

  if (user.last_sign_in_at) {
    return <span>Last seen {formatRelativeTime(user.last_sign_in_at)}</span>;
  }

  if (user.accepted_at) {
    return <span>Joined {formatRelativeTime(user.accepted_at)}</span>;
  }

  return <span>Never</span>;
}
