"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
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
import { SUPER_ADMIN_LOCKED_NOTE } from "@/components/super-admin-badge";

type EditableUser = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
  date_of_birth?: string | null;
  nationality?: string | null;
  gender?: string | null;
  marital_status?: string | null;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  department?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

type Option = { value: string; label: string };

// Text fields we render as plain inputs, grouped by section.
const FIELDS: {
  section: string;
  rows: { key: keyof EditableUser; label: string; type?: string }[];
}[] = [
  {
    section: "Personal",
    rows: [
      { key: "first_name", label: "Legal first name" },
      { key: "last_name", label: "Legal last name" },
      { key: "date_of_birth", label: "Date of birth", type: "date" },
      { key: "nationality", label: "Nationality" },
      { key: "gender", label: "Gender" },
      { key: "marital_status", label: "Marital status" },
    ],
  },
  {
    section: "Contact",
    rows: [
      { key: "email", label: "Login email", type: "email" },
      { key: "phone", label: "Phone" },
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

function initialForm(user: EditableUser): Record<string, string> {
  const form: Record<string, string> = {};
  for (const group of FIELDS) {
    for (const row of group.rows) {
      form[row.key as string] = (user[row.key] as string | null) ?? "";
    }
  }
  form.department = user.department ?? "";
  form.job_title = user.job_title ?? "";
  return form;
}

export function EditProfileDialog({
  user,
  departmentOptions = [],
  departmentEditable = true,
  lockAccountFields = false,
}: {
  user: EditableUser;
  departmentOptions?: Option[];
  // Students & community members are department-less; hide the field for them.
  departmentEditable?: boolean;
  // A General Admin editing a Super Admin: login email and job title are the
  // super admin's own tier to change (the API refuses a change to either).
  lockAccountFields?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(() =>
    initialForm(user)
  );

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    // Send every field; the API allow-lists them and skips the email auth
    // update when it matches the current address. Empty strings become null so
    // an admin can clear an optional field.
    const payload: Record<string, string | null> = {};
    for (const group of FIELDS) {
      for (const row of group.rows) {
        const v = form[row.key as string]?.trim() ?? "";
        payload[row.key as string] = v === "" ? null : v;
      }
    }
    const dept = form.department?.trim() ?? "";
    payload.department = dept === "" ? null : dept;

    // Job title is an optional override — blank means "auto-generate from
    // department & ministry role" (the API allow-lists job_title).
    const jobTitle = form.job_title?.trim() ?? "";
    payload.job_title = jobTitle === "" ? null : jobTitle;

    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast.error(b.error ?? "Could not save the profile");
      return;
    }
    toast.success("Profile updated");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Reset the form to the latest server values whenever the dialog opens.
        if (o) setForm(initialForm(user));
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="mr-1 h-4 w-4" /> Edit profile
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Changing the login email updates the user&apos;s sign-in identity
            immediately — no confirmation email is sent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {FIELDS.map((group) => (
            <div key={group.section} className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.section}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.rows.map((row) => (
                  <div key={row.key as string} className="space-y-1.5">
                    <Label htmlFor={`edit-${row.key as string}`}>
                      {row.label}
                    </Label>
                    <Input
                      id={`edit-${row.key as string}`}
                      type={row.type ?? "text"}
                      value={form[row.key as string] ?? ""}
                      disabled={lockAccountFields && row.key === "email"}
                      onChange={(e) =>
                        set(row.key as string, e.target.value)
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="space-y-1.5">
            <Label htmlFor="edit-job_title">Job title override</Label>
            <Input
              id="edit-job_title"
              type="text"
              value={form.job_title ?? ""}
              disabled={lockAccountFields}
              onChange={(e) => set("job_title", e.target.value)}
              placeholder="Auto-generated from department & ministry role"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to auto-generate from department &amp; ministry role
              (e.g. “Media Ministry Leader”). Type a value to override it.
            </p>
          </div>

          {lockAccountFields && (
            <p className="text-xs text-muted-foreground">
              {SUPER_ADMIN_LOCKED_NOTE} Their login email and job title are
              locked.
            </p>
          )}

          {departmentEditable && (
          <div className="space-y-1.5">
            <Label htmlFor="edit-department">Department</Label>
            <select
              id="edit-department"
              className="flex h-9 w-full border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={form.department ?? ""}
              onChange={(e) => set("department", e.target.value)}
            >
              <option value="">— None —</option>
              {departmentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {/* Preserve a legacy value that's no longer in the list. */}
              {form.department &&
                !departmentOptions.some((o) => o.value === form.department) && (
                  <option value={form.department}>{form.department}</option>
                )}
            </select>
          </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
