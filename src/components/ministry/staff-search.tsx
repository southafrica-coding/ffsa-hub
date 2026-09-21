"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/user-avatar";

export type Staff = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  preferred_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

function nameOf(u: Staff): string {
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.display_name || u.email || "Unknown";
}

// A free-text jump-to-person box for the Ministry list page, so finding
// someone doesn't require clicking through every ministry first. Filters
// the already-scoped staff list the server passed down (admin/leadership
// team see everyone; a ministry leader sees only the ministries they lead).
export function StaffSearch({ staff }: { staff: Staff[] }) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return staff
      .filter((u) => `${nameOf(u)} ${u.email ?? ""}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [staff, query]);

  return (
    <div className="relative max-w-sm px-5 py-4 md:px-8">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Find a staff member…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      {query.trim() !== "" && (
        <div className="absolute left-5 right-5 top-full z-10 mt-1 max-w-sm border border-border bg-card shadow-md md:left-8 md:right-8">
          {matches.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">No one found.</p>
          ) : (
            matches.map((u) => (
              <Link
                key={u.id}
                href={`/ministry/staff/${u.id}`}
                className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted"
              >
                <UserAvatar src={u.avatar_url} name={nameOf(u)} size={24} />
                <span className="truncate">{nameOf(u)}</span>
                {u.email && (
                  <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                )}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
