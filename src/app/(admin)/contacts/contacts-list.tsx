"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PersonQuickView } from "@/components/people/person-quick-view";
import type { PersonRef } from "@/services/person-quick-view";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Search } from "lucide-react";
import type { Tables } from "@/types/database";
import { getLabelColors } from "@/lib/label-color";
import type { ContactSort } from "@/services/contacts";

type PersonType = Tables<"person_types">;

const SORT_LABELS: Record<ContactSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name_asc: "Name (A–Z)",
  name_desc: "Name (Z–A)",
  recent: "Recently interacted",
};

interface ContactsListProps {
  contacts: Array<{
    id: string;
    first_name: string;
    last_name: string;
    preferred_name: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    marketing_status?: string | null;
    date_of_birth?: string | null;
    marital_status?: string | null;
    gender?: string | null;
    nationality?: string | null;
    city?: string | null;
    country?: string | null;
    preferred_language?: string | null;
    source?: string | null;
    last_interaction_at?: string | null;
    person_type_assignments?: Array<{
      person_types: { name: string } | null;
    }>;
    contact_labels?: Array<{
      labels: { id: string; slug: string; name: string; color: string | null } | null;
    }>;
  }>;
  personTypes: PersonType[];
  lists: Array<{ id: string; name: string }>;
  totalCount: number;
  currentPage: number;
  pageSize: number;
  searchQuery?: string;
  statusFilter: string;
  sort: ContactSort;
}

export function ContactsList({
  contacts,
  lists,
  totalCount,
  currentPage,
  pageSize,
  searchQuery,
  statusFilter,
  sort,
}: ContactsListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchQuery ?? "");
  // Person quick-view side panel (opens on a name click).
  const [quickPerson, setQuickPerson] = useState<PersonRef | null>(null);

  // Multi-select for bulk "Add to list". Keyed by contact id, scoped to the
  // current page (selection clears when the visible rows change).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageIds = contacts.map((c) => c.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (pageIds.every((id) => prev.has(id))) return new Set();
      return new Set(pageIds);
    });
  }

  // Live debounced search — typing immediately filters after 300ms of idle.
  // Skip the very first run so hydration doesn't bounce the URL just because
  // the controlled input was initialised with the existing ?search= value.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (search) {
        params.set("search", search);
      } else {
        params.delete("search");
      }
      params.delete("page");
      router.replace(`/contacts?${params.toString()}`);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function handleStatusFilter(status: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("status", status);
    params.delete("page");
    router.push(`/contacts?${params.toString()}`);
  }

  function handleSortChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "newest") {
      params.delete("sort");
    } else {
      params.set("sort", value);
    }
    params.delete("page");
    router.push(`/contacts?${params.toString()}`);
  }

  const totalPages = Math.ceil(totalCount / pageSize);

  function displayName(contact: ContactsListProps["contacts"][0]) {
    if (contact.preferred_name) {
      return `${contact.preferred_name} ${contact.last_name}`;
    }
    return `${contact.first_name} ${contact.last_name}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1">
          {["active", "inactive", "archived"].map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? "default" : "ghost"}
              size="sm"
              onClick={() => handleStatusFilter(status)}
              className="capitalize"
            >
              {status}
            </Button>
          ))}
        </div>

        <Select value={sort} onValueChange={handleSortChange}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as ContactSort[]).map((key) => (
              <SelectItem key={key} value={key}>
                {SORT_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Link href="/contacts/new" className="ml-auto">
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" />
            Add Contact
          </Button>
        </Link>
      </div>

      {selected.size > 0 && (
        <BulkAddToList
          lists={lists}
          selectedIds={Array.from(selected)}
          onClear={() => setSelected(new Set())}
          onDone={() => {
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all on this page"
                  className="align-middle"
                />
              </TableHead>
              <TableHead className="whitespace-nowrap">Name</TableHead>
              <TableHead className="whitespace-nowrap">Email</TableHead>
              <TableHead className="whitespace-nowrap">Phone</TableHead>
              <TableHead className="whitespace-nowrap">Labels</TableHead>
              <TableHead className="whitespace-nowrap">DOB</TableHead>
              <TableHead className="whitespace-nowrap">Marital</TableHead>
              <TableHead className="whitespace-nowrap">City</TableHead>
              <TableHead className="whitespace-nowrap">Country</TableHead>
              <TableHead className="whitespace-nowrap">Nationality</TableHead>
              <TableHead className="whitespace-nowrap">Marketing</TableHead>
              <TableHead className="whitespace-nowrap">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                  No contacts found
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  data-state={selected.has(contact.id) ? "selected" : undefined}
                >
                  <TableCell className="w-10">
                    <input
                      type="checkbox"
                      checked={selected.has(contact.id)}
                      onChange={() => toggleOne(contact.id)}
                      aria-label={`Select ${displayName(contact)}`}
                      className="align-middle"
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() =>
                        setQuickPerson({
                          contactId: contact.id,
                          name: displayName(contact),
                        })
                      }
                      className="font-medium hover:underline text-left"
                    >
                      {displayName(contact)}
                    </button>
                    {contact.preferred_name && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({contact.first_name})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {contact.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {contact.phone ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap min-w-[140px]">
                      {contact.contact_labels?.slice(0, 4).map((cl) => {
                        if (!cl.labels) return null;
                        const colors = getLabelColors(cl.labels);
                        return (
                          <span
                            key={cl.labels.id}
                            className="inline-flex items-center text-xs px-1.5 py-0.5 rounded-full border font-medium whitespace-nowrap"
                            style={{
                              backgroundColor: colors.bg,
                              color: colors.text,
                              borderColor: colors.border,
                            }}
                          >
                            {cl.labels.name}
                          </span>
                        );
                      })}
                      {(contact.contact_labels?.length ?? 0) > 4 && (
                        <span className="text-xs text-muted-foreground">
                          +{(contact.contact_labels?.length ?? 0) - 4}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {contact.date_of_birth
                      ? new Date(contact.date_of_birth).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground capitalize whitespace-nowrap">
                    {contact.marital_status ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {contact.city ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {contact.country ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {contact.nationality ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <MarketingChip status={contact.marketing_status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge
                      variant={contact.status === "active" ? "default" : "outline"}
                      className="capitalize"
                    >
                      {contact.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            {currentPage > 1 && (
              <Link
                href={`/contacts?${new URLSearchParams({
                  ...Object.fromEntries(searchParams.entries()),
                  page: String(currentPage - 1),
                }).toString()}`}
              >
                <Button variant="outline" size="sm">
                  Previous
                </Button>
              </Link>
            )}
            {currentPage < totalPages && (
              <Link
                href={`/contacts?${new URLSearchParams({
                  ...Object.fromEntries(searchParams.entries()),
                  page: String(currentPage + 1),
                }).toString()}`}
              >
                <Button variant="outline" size="sm">
                  Next
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}

      <PersonQuickView
        personRef={quickPerson}
        onClose={() => setQuickPerson(null)}
      />
    </div>
  );
}

function BulkAddToList({
  lists,
  selectedIds,
  onClear,
  onDone,
}: {
  lists: Array<{ id: string; name: string }>;
  selectedIds: string[];
  onClear: () => void;
  onDone: () => void;
}) {
  const [pickId, setPickId] = useState("");
  const [newName, setNewName] = useState("");
  const [creatingNew, setCreatingNew] = useState(lists.length === 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addToList() {
    setErr(null);
    let listId = pickId;

    if (creatingNew) {
      const name = newName.trim();
      if (!name) {
        setErr("Name the new list.");
        return;
      }
      setBusy(true);
      const res = await fetch("/api/contacts/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setBusy(false);
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(data.error ?? "Failed to create list");
        return;
      }
      const data = (await res.json()) as { list: { id: string } };
      listId = data.list.id;
    } else if (!listId) {
      setErr("Pick a list.");
      return;
    }

    setBusy(true);
    const res = await fetch(`/api/contacts/lists/${listId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: selectedIds }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to add to list");
      return;
    }
    onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-secondary/40 px-4 py-3">
      <span className="text-sm font-medium">
        {selectedIds.length} selected
      </span>

      {creatingNew ? (
        <Input
          placeholder="New list name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={busy}
          className="h-9 w-56"
          autoFocus
        />
      ) : (
        <Select value={pickId} onValueChange={setPickId}>
          <SelectTrigger className="h-9 w-56">
            <SelectValue placeholder="Add to list…" />
          </SelectTrigger>
          <SelectContent>
            {lists.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {lists.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setCreatingNew((v) => !v);
            setErr(null);
          }}
          className="text-xs text-blue-600 hover:underline"
        >
          {creatingNew ? "Pick existing" : "Create new"}
        </button>
      )}

      <Button size="sm" onClick={addToList} disabled={busy}>
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
        Clear
      </Button>

      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}

function MarketingChip({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const cls =
    status === "subscribed"
      ? "bg-green-100 text-green-800 border-green-300"
      : status === "unsubscribed_all"
      ? "bg-red-100 text-red-800 border-red-300"
      : status === "bounced"
      ? "bg-orange-100 text-orange-800 border-orange-300"
      : "bg-gray-100 text-gray-700 border-gray-300";
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}
