"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { updateContact, archiveContact } from "@/services/contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

type Option = { value: string; label: string };

export type EditableContact = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  marital_status?: string | null;
  nationality?: string | null;
  preferred_language?: string | null;
  preferred_channel?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

const TEXT_FIELDS: {
  section: string;
  rows: { key: keyof EditableContact; label: string; type?: string }[];
}[] = [
  {
    section: "Name",
    rows: [
      { key: "first_name", label: "Legal first name" },
      { key: "last_name", label: "Legal last name" },
      { key: "preferred_name", label: "Preferred name" },
    ],
  },
  {
    section: "Demographics",
    rows: [
      { key: "date_of_birth", label: "Date of birth", type: "date" },
      { key: "nationality", label: "Nationality" },
      { key: "preferred_language", label: "Preferred language" },
      { key: "preferred_channel", label: "Preferred channel" },
    ],
  },
  {
    section: "Address",
    rows: [
      { key: "address_line_1", label: "Address line 1" },
      { key: "address_line_2", label: "Address line 2" },
      { key: "city", label: "City" },
      { key: "province", label: "Province" },
      { key: "postal_code", label: "Postal code" },
      { key: "country", label: "Country" },
    ],
  },
];

const MARITAL_OPTIONS: Option[] = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
];

const ALL_KEYS: (keyof EditableContact)[] = [
  ...TEXT_FIELDS.flatMap((g) => g.rows.map((r) => r.key)),
  "gender",
  "marital_status",
];

function initialForm(c: EditableContact): Record<string, string> {
  const form: Record<string, string> = {};
  for (const key of ALL_KEYS) form[key] = (c[key] as string | null) ?? "";
  return form;
}

const selectClass =
  "flex h-9 w-full  border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function EditContactDialog({
  contact,
  genderOptions = [],
}: {
  contact: EditableContact;
  genderOptions?: Option[];
}) {
  const router = useRouter();
  // Browser client; contacts RLS lets admins / contacts.edit holders update.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(() =>
    initialForm(contact)
  );

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    const payload: Record<string, string | null> = {};
    for (const key of ALL_KEYS) {
      const v = form[key]?.trim() ?? "";
      payload[key] = v === "" ? null : v;
    }
    const { error } = await updateContact(supabase, contact.id, payload);
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Could not save the contact");
      return;
    }
    toast.success("Contact updated");
    setOpen(false);
    router.refresh();
  }

  async function archive() {
    if (!confirm("Archive this contact? They'll be hidden from the active list."))
      return;
    setBusy(true);
    const { error } = await archiveContact(supabase, contact.id);
    setBusy(false);
    if (error) {
      toast.error(error.message ?? "Could not archive the contact");
      return;
    }
    toast.success("Contact archived");
    router.push("/contacts");
  }

  // Preserve a stored value that's no longer in the option list.
  const genderChoices =
    form.gender && !genderOptions.some((o) => o.value === form.gender)
      ? [...genderOptions, { value: form.gender, label: form.gender }]
      : genderOptions;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setForm(initialForm(contact));
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="mr-1 h-4 w-4" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit contact</DialogTitle>
          <DialogDescription>
            Email and phone are managed under Identifiers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {TEXT_FIELDS.map((group) => (
            <div key={group.section} className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.section}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.section === "Demographics" && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-gender">Gender</Label>
                      <select
                        id="edit-gender"
                        className={selectClass}
                        value={form.gender ?? ""}
                        onChange={(e) => set("gender", e.target.value)}
                      >
                        <option value="">— None —</option>
                        {genderChoices.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-marital">Marital status</Label>
                      <select
                        id="edit-marital"
                        className={selectClass}
                        value={form.marital_status ?? ""}
                        onChange={(e) => set("marital_status", e.target.value)}
                      >
                        <option value="">— None —</option>
                        {MARITAL_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                {group.rows.map((row) => (
                  <div key={row.key as string} className="space-y-1.5">
                    <Label htmlFor={`edit-${row.key as string}`}>
                      {row.label}
                    </Label>
                    <Input
                      id={`edit-${row.key as string}`}
                      type={row.type ?? "text"}
                      value={form[row.key as string] ?? ""}
                      onChange={(e) => set(row.key as string, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={archive}
            disabled={busy}
          >
            Archive
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
