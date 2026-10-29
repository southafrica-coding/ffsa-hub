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

// Lower-case, strip accents (é → e, ë → e, å → a) and spell out the letters
// that don't decompose (ø → o, æ → ae, ß → ss), so typing a name the way it
// sounds still finds it. A plain includes() on the raw text missed everyone
// with an accent in their name.
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/đ/g, "d")
    .replace(/ł/g, "l");
}

// A free-text jump-to-person box for the Ministry list page, so finding
// someone doesn't require clicking through every ministry first. Filters
// the already-scoped staff list the server passed down (admin/leadership
// team see everyone; a ministry leader sees only the ministries they lead).
export function StaffSearch({ staff }: { staff: Staff[] }) {
  const [query, setQuery] = useState("");

  // Folded once per staff list rather than on every keystroke.
  const haystacks = useMemo(
    () =>
      staff.map((u) => ({
        u,
        text: fold(
          [u.first_name, u.last_name, u.display_name, u.email].filter(Boolean).join(" ")
        ),
      })),
    [staff]
  );

  // Every typed word has to appear somewhere, in any order — so "anna smith"
  // still finds "Anna Marie Smith", and "smith anna" works too.
  const matches = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return haystacks
      .filter(({ text }) => words.every((w) => text.includes(w)))
      .map(({ u }) => u)
      .slice(0, 8);
  }, [haystacks, query]);

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
