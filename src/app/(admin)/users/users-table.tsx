"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  MoreHorizontal,
  Mail,
  AlertCircle,
  Power,
  PowerOff,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  deriveUserLifecycle,
  formatRelativeTime,
  type UserLifecycleStage,
} from "@/lib/users/lifecycle";
import { UserAvatar } from "@/components/ui/user-avatar";

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
    roles: { display_name: string } | null;
  }>;
};

const DEPARTMENT_LABELS: Record<string, string> = {
  leadership_team: "Leadership Team",
  prayer_and_worship: "Prayer and Worship",
  media: "Media",
  hulk: "Hulk",
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
      color: "hsl(210 90% 70%)",
      background: "hsl(210 80% 18%)",
    },
  },
  profile_incomplete: {
    className: "",
    style: {
      borderColor: "hsl(28 95% 55% / 0.4)",
      color: "hsl(28 95% 65%)",
      background: "hsl(28 80% 16%)",
    },
  },
  pending_approval: {
    className: "",
    style: {
      borderColor: "hsl(42 95% 55% / 0.4)",
      color: "hsl(42 95% 60%)",
      background: "hsl(42 80% 18%)",
    },
  },
  inactive: {
    className: "",
    style: {
      borderColor: "hsl(0 0% 50% / 0.3)",
      color: "hsl(0 0% 70%)",
      background: "hsl(0 0% 14%)",
    },
  },
};

function displayName(u: UserRow): string {
  return (
    u.display_name ??
    (u.first_name
      ? `${u.preferred_name ?? u.first_name} ${u.last_name ?? ""}`.trim()
      : "—")
  );
}

export function UsersTable({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

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
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Job Title</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Activity</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center text-muted-foreground py-8"
              >
                No users found
              </TableCell>
            </TableRow>
          ) : (
            users.map((user) => {
              const lifecycle = deriveUserLifecycle(user);
              const stageStyle = STAGE_STYLES[lifecycle.stage];
              const isSelf = user.id === currentUserId;
              const isBusy = busy === user.id;

              return (
                <TableRow
                  key={user.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/users/${user.id}`)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        src={user.avatar_url}
                        name={user.preferred_name ?? user.first_name ?? user.email}
                        size={28}
                      />
                      <span className="truncate">{displayName(user)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.job_title ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.department
                      ? DEPARTMENT_LABELS[user.department] ?? user.department
                      : "—"}
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
                        <span className="text-[11px] text-muted-foreground">
                          {lifecycle.completedRequired} of{" "}
                          {lifecycle.totalRequired} fields
                        </span>
                      )}
                      {lifecycle.insurance.state === "expired" && (
                        <Badge
                          variant="outline"
                          style={{
                            borderColor: "hsl(0 84% 60% / 0.4)",
                            color: "hsl(0 84% 72%)",
                            background: "hsl(0 70% 16%)",
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
                            borderColor: "hsl(28 95% 55% / 0.4)",
                            color: "hsl(28 95% 65%)",
                            background: "hsl(28 80% 16%)",
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
    </div>
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
