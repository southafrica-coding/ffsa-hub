"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Search, Loader2 } from "lucide-react";

export type ProgramLeaderRow = {
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

// The "Leaders" tab: the team of people who lead this school. Being a
// leader grants program-scoped control (this program's settings,
// applications and — next — its emails). Any leader, or a schools admin,
// can grow or prune the team.
export function LeadersTab({
  programId,
  leaders: initialLeaders,
  allUsers,
}: {
  programId: string;
  leaders: ProgramLeaderRow[];
  allUsers: UserPick[];
}) {
  const router = useRouter();
  const [leaders, setLeaders] = useState<ProgramLeaderRow[]>(initialLeaders);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const leaderIds = useMemo(
    () => new Set(leaders.map((l) => l.user_id)),
    [leaders]
  );

  // Candidates = active users not already on the team, matched on the query.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allUsers
      .filter((u) => !leaderIds.has(u.id))
      .filter((u) => {
        const hay = `${u.first_name ?? ""} ${u.last_name ?? ""} ${u.email ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 6);
  }, [query, allUsers, leaderIds]);

  async function mutate(method: "POST" | "DELETE", userId: string) {
    setBusyId(userId);
    setError(null);
    const res = await fetch(`/api/schools/programs/${programId}/leaders`, {
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
    const data = (await res.json()) as { leaders: ProgramLeaderRow[] };
    setLeaders(data.leaders);
    setQuery("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">School leaders</CardTitle>
        <p className="text-sm text-muted-foreground">
          Leaders control this school — its settings, applicants and the
          emails sent to students. A school can have as many leaders as it
          needs.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {leaders.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No leaders yet. Add the people who run this school below.
          </p>
        ) : (
          <ul className="divide-y border">
            {leaders.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {displayName(l.users)}
                  </p>
                  {l.users?.email && (
                    <p className="text-xs text-muted-foreground truncate">
                      {l.users.email}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive shrink-0"
                  disabled={busyId === l.user_id}
                  onClick={() => mutate("DELETE", l.user_id)}
                >
                  {busyId === l.user_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
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
              placeholder="Search people to add as a leader…"
              className="pl-8"
            />
          </div>
          {matches.length > 0 && (
            <ul className="border divide-y">
              {matches.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm truncate">{displayName(u)}</p>
                    {u.email && (
                      <p className="text-xs text-muted-foreground truncate">
                        {u.email}
                      </p>
                    )}
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
            <p className="text-xs text-muted-foreground">
              No matching people not already on the team.
            </p>
          )}
        </div>

        <Badge variant="outline" className="font-normal">
          {leaders.length} leader{leaders.length === 1 ? "" : "s"}
        </Badge>
      </CardContent>
    </Card>
  );
}
