"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Search, Loader2 } from "lucide-react";

export type ProgramStaffRow = {
  id: string;
  user_id: string;
  created_at: string;
  users: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
};

type UserPick = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

function displayName(u: {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
} | null): string {
  if (!u) return "Unknown";
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || u.email || "Unknown";
}

// People who review applicants assigned to them. They do not edit the
// form, the emails, or fees. Leaders and schools.manage add them here.
export function StaffTab({
  programId,
  staff: initialStaff,
  allUsers,
}: {
  programId: string;
  staff: ProgramStaffRow[];
  allUsers: UserPick[];
}) {
  const router = useRouter();
  const [staff, setStaff] = useState<ProgramStaffRow[]>(initialStaff);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const staffIds = useMemo(() => new Set(staff.map((member) => member.user_id)), [staff]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allUsers
      .filter((u) => !staffIds.has(u.id))
      .filter((u) => {
        const hay = `${u.first_name ?? ""} ${u.last_name ?? ""} ${u.email ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 6);
  }, [query, allUsers, staffIds]);

  async function mutate(method: "POST" | "DELETE", userId: string) {
    setBusyId(userId);
    setError(null);
    const res = await fetch(`/api/schools/programs/${programId}/staff`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Something went wrong");
      return;
    }
    const data = (await res.json()) as { staff: ProgramStaffRow[] };
    setStaff(data.staff);
    setQuery("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">School staff</CardTitle>
        <p className="text-sm text-muted-foreground">
          Staff review the applicants assigned to them. They can leave notes and
          an interview outcome. They do not edit the application form or the
          emails, and they do not see fees.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {staff.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No staff yet. Add the people who will interview applicants.
          </p>
        ) : (
          <ul className="divide-y border">
            {staff.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{displayName(member.users)}</p>
                  {member.users?.email && (
                    <p className="text-xs text-muted-foreground truncate">{member.users.email}</p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive shrink-0"
                  disabled={busyId === member.user_id}
                  onClick={() => mutate("DELETE", member.user_id)}
                >
                  {busyId === member.user_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  <span className="sr-only">Remove {displayName(member.users)}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people to add as staff…"
              className="pl-8"
              aria-label="Search people to add as staff"
            />
          </div>
          {matches.length > 0 && (
            <ul className="border divide-y">
              {matches.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{displayName(u)}</p>
                    {u.email && <p className="text-xs text-muted-foreground truncate">{u.email}</p>}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={busyId === u.id}
                    onClick={() => mutate("POST", u.id)}
                  >
                    {busyId === u.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-1" /> Add
                      </>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() && matches.length === 0 && (
            <p className="text-xs text-muted-foreground">No matching people not already on staff.</p>
          )}
        </div>

        <Badge variant="outline" className="font-normal">
          {staff.length} staff
        </Badge>
      </CardContent>
    </Card>
  );
}
