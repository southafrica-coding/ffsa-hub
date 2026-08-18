"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInputNative } from "@/components/ui/phone-input-native";
import { MoreHorizontal, Plus, Star, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Email = {
  id: string;
  email: string;
  label: string;
  is_primary: boolean;
};
type Phone = {
  id: string;
  phone: string;
  phone_normalized: string | null;
  label: string;
  is_primary: boolean;
};

export function IdentifiersCard({
  contactId,
  emails,
  phones,
}: {
  contactId: string;
  emails: Email[];
  phones: Phone[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<"email" | "phone" | null>(null);
  const [addValue, setAddValue] = useState("");
  const [addLabel, setAddLabel] = useState("other");
  const [addError, setAddError] = useState<string | null>(null);

  async function setPrimary(kind: "email" | "phone", id: string) {
    setBusy(id);
    const res = await fetch(
      `/api/contacts/${contactId}/identifiers/${kind}/${id}/primary`,
      { method: "POST" }
    );
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Failed to set primary");
      return;
    }
    router.refresh();
  }

  async function remove(kind: "email" | "phone", id: string, value: string) {
    if (!confirm(`Remove ${value} from this contact?`)) return;
    setBusy(id);
    const res = await fetch(
      `/api/contacts/${contactId}/identifiers/${kind}/${id}`,
      { method: "DELETE" }
    );
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Failed to remove");
      return;
    }
    router.refresh();
  }

  async function handleAdd() {
    if (!addValue.trim()) {
      setAddError("Required");
      return;
    }
    setAddError(null);
    setBusy("add");
    const res = await fetch(`/api/contacts/${contactId}/identifiers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        [adding!]: addValue.trim(),
        label: addLabel,
      }),
    });
    setBusy(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAddError(body.error ?? "Failed to add");
      return;
    }
    if (
      (adding === "email" && body.emailSkipped) ||
      (adding === "phone" && body.phoneSkipped)
    ) {
      setAddError("Already on file");
      return;
    }
    setAdding(null);
    setAddValue("");
    setAddLabel("other");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contact information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <Section
          title="Email"
          onAdd={() => {
            setAdding("email");
            setAddValue("");
            setAddLabel("other");
            setAddError(null);
          }}
        >
          {emails.length === 0 && adding !== "email" && (
            <p className="text-sm text-muted-foreground">No email on file.</p>
          )}
          {emails.map((e) => (
            <Row
              key={e.id}
              value={e.email}
              label={e.label}
              isPrimary={e.is_primary}
              busy={busy === e.id}
              onMakePrimary={
                e.is_primary ? null : () => setPrimary("email", e.id)
              }
              onRemove={() => remove("email", e.id, e.email)}
            />
          ))}
          {adding === "email" && (
            <AddRow
              kind="email"
              value={addValue}
              label={addLabel}
              error={addError}
              busy={busy === "add"}
              onChange={setAddValue}
              onLabelChange={setAddLabel}
              onCancel={() => setAdding(null)}
              onSubmit={handleAdd}
            />
          )}
        </Section>

        <Section
          title="Phone"
          onAdd={() => {
            setAdding("phone");
            setAddValue("");
            setAddLabel("other");
            setAddError(null);
          }}
        >
          {phones.length === 0 && adding !== "phone" && (
            <p className="text-sm text-muted-foreground">No phone on file.</p>
          )}
          {phones.map((p) => (
            <Row
              key={p.id}
              value={p.phone}
              normalized={p.phone_normalized}
              label={p.label}
              isPrimary={p.is_primary}
              busy={busy === p.id}
              onMakePrimary={
                p.is_primary ? null : () => setPrimary("phone", p.id)
              }
              onRemove={() => remove("phone", p.id, p.phone)}
            />
          ))}
          {adding === "phone" && (
            <AddRow
              kind="phone"
              value={addValue}
              label={addLabel}
              error={addError}
              busy={busy === "add"}
              onChange={setAddValue}
              onLabelChange={setAddLabel}
              onCancel={() => setAdding(null)}
              onSubmit={handleAdd}
            />
          )}
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({
  value,
  normalized,
  label,
  isPrimary,
  busy,
  onMakePrimary,
  onRemove,
}: {
  value: string;
  normalized?: string | null;
  label: string;
  isPrimary: boolean;
  busy: boolean;
  onMakePrimary: (() => void) | null;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        {isPrimary && (
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm truncate">{value}</p>
          {normalized && normalized !== value && (
            <p className="text-[10px] font-mono text-muted-foreground truncate">
              {normalized}
            </p>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 ">
          {label}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            disabled={busy}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onMakePrimary && (
            <DropdownMenuItem onClick={onMakePrimary}>
              Make primary
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={onRemove}
            className="text-red-400 focus:text-red-300"
          >
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AddRow({
  kind,
  value,
  label,
  error,
  busy,
  onChange,
  onLabelChange,
  onCancel,
  onSubmit,
}: {
  kind: "email" | "phone";
  value: string;
  label: string;
  error: string | null;
  busy: boolean;
  onChange: (v: string) => void;
  onLabelChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className=" border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
      <div className="flex gap-2">
        {kind === "phone" ? (
          <PhoneInputNative
            value={value}
            onChange={onChange}
            wrapperClassName="flex gap-2 flex-1"
            inputClassName="flex h-9 w-full  border border-input bg-transparent px-3 py-1 text-sm"
            selectClassName="h-9  border border-input bg-transparent px-2 text-sm"
          />
        ) : (
          <Input
            autoFocus
            type="email"
            value={value}
            placeholder="name@example.com"
            onChange={(e) => onChange(e.target.value)}
            disabled={busy}
            className="flex-1"
          />
        )}
        <select
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          disabled={busy}
          className="border border-input bg-background text-foreground text-sm px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="personal">personal</option>
          <option value="work">work</option>
          <option value="family">family</option>
          <option value="old">old</option>
          <option value="other">other</option>
        </select>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
          className="h-7"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Cancel
        </Button>
        <Button size="sm" onClick={onSubmit} disabled={busy} className="h-7">
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
