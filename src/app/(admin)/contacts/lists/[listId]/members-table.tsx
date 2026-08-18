"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

type Member = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
};

export function MembersTable({
  listId,
  members,
}: {
  listId: string;
  members: Member[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function remove(contactId: string, name: string) {
    if (!confirm(`Remove ${name} from this list?`)) return;
    setBusyId(contactId);
    setErr(null);
    const res = await fetch(
      `/api/contacts/lists/${listId}/members/${contactId}`,
      { method: "DELETE" }
    );
    setBusyId(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to remove contact");
      return;
    }
    router.refresh();
  }

  function displayName(m: Member) {
    const first = m.preferred_name || m.first_name;
    return `${first} ${m.last_name}`.trim();
  }

  if (members.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        This list has no contacts yet. Add people from the{" "}
        <Link href="/contacts" className="underline">
          contacts table
        </Link>{" "}
        or from a contact&apos;s profile.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Name</TableHead>
              <TableHead className="whitespace-nowrap">Email</TableHead>
              <TableHead className="whitespace-nowrap">Phone</TableHead>
              <TableHead className="whitespace-nowrap">Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap">
                  <Link
                    href={`/contacts/${m.id}`}
                    className="font-medium hover:underline"
                  >
                    {displayName(m)}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {m.email ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {m.phone ?? "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge
                    variant={m.status === "active" ? "default" : "outline"}
                    className="capitalize"
                  >
                    {m.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => remove(m.id, displayName(m))}
                    disabled={busyId === m.id}
                    aria-label="Remove from list"
                    className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
