"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Masthead, MastheadButton } from "@/components/ffsa";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionButton, Facts } from "../_components/ui";
import { fleetFetch } from "../_components/client-api";
import { PFIELDS, providerBody, siteHref, siteLabel, telHref, type Provider } from "./provider-fields";

export type { Provider };

const field = "min-h-11 w-full border border-rule-strong bg-white px-3 py-2 text-[15px] focus:border-ink focus:outline-none";

function Phone({ n }: { n: string }) {
  return (
    <a href={telHref(n)} className="inline-flex min-h-11 items-center gap-2 underline decoration-1 underline-offset-2">
      {n} <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]">· Call</span>
    </a>
  );
}

/** Workshops & providers: the list, and the add/edit dialog. */
export function Workshops({ providers, canManage }: { providers: Provider[]; canManage: boolean }) {
  const [editing, setEditing] = useState<Provider | "new" | null>(null);

  return (
    <>
      <Masthead
        context="Fleet · Workshops"
        title="Workshops & providers"
        actions={canManage ? <MastheadButton onClick={() => setEditing("new")}>Add provider</MastheadButton> : undefined}
      />
      <p className="px-5 pt-5 text-[14px] text-[#55524A] md:px-8">
        Where the vehicles go for services, repairs and inspections a non-mechanic can’t do.
      </p>
      {!providers.length ? (
        <p className="px-5 py-6 text-[14px] text-[#55524A] md:px-8">No providers yet.</p>
      ) : (
        <ul className="mt-4 max-w-3xl divide-y divide-ink border-y border-ink">
          {providers.map((p) => (
            <li key={p.id} data-provider={p.id} className="py-2">
              <div className="flex items-start justify-between gap-3 px-5 pt-2 md:px-8">
                <div className="min-w-0">
                  <h2 className="break-words text-[22px] leading-tight">{p.name}</h2>
                  {p.services && <p className="mt-0.5 text-[14px] text-[#55524A]">{p.services}</p>}
                </div>
                {canManage && (
                  <ActionButton onClick={() => setEditing(p)} className="shrink-0">
                    Edit
                  </ActionButton>
                )}
              </div>
              <Facts
                rows={[
                  ["Phone", p.phone ? <Phone n={p.phone} /> : ""],
                  ["Other phone", p.phone2 ? <Phone n={p.phone2} /> : ""],
                  [
                    "Email",
                    p.email ? (
                      <a href={`mailto:${p.email}`} className="inline-flex min-h-11 items-center break-all underline decoration-1 underline-offset-2">
                        {p.email}
                      </a>
                    ) : (
                      ""
                    ),
                  ],
                  ["Address", p.address],
                  [
                    "Website",
                    p.website ? (
                      <a href={siteHref(p.website)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-all underline decoration-1 underline-offset-2">
                        {siteLabel(p.website)}
                      </a>
                    ) : (
                      ""
                    ),
                  ],
                  ["Hours", p.hours],
                ]}
              />
              {p.notes && <p className="whitespace-pre-line px-5 pb-2 text-[13px] text-[#55524A] md:px-8">{p.notes}</p>}
            </li>
          ))}
        </ul>
      )}
      {canManage && <ProviderDialog provider={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ProviderDialog({ provider, onClose }: { provider: Provider | "new" | null; onClose: () => void }) {
  const router = useRouter();
  const p = provider && provider !== "new" ? provider : null;
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [shownFor, setShownFor] = useState<Provider | "new" | null>(null);

  // Reset the form each time the dialog opens for a provider.
  if (provider !== shownFor) {
    setShownFor(provider);
    setValues(Object.fromEntries(PFIELDS.map(([k]) => [k, (p && p[k]) || ""])));
  }

  async function save() {
    const body = providerBody(values);
    if (!body.name) return toast.error("Enter the provider’s name.");
    setSaving(true);
    try {
      await fleetFetch(p ? `/api/vehicles/fleet/providers/${p.id}` : "/api/vehicles/fleet/providers", { method: p ? "PUT" : "POST", body });
      toast.success("Provider saved.");
      onClose();
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!p || !window.confirm("Delete this provider? Past workshop visits keep the name.")) return;
    setSaving(true);
    try {
      await fleetFetch(`/api/vehicles/fleet/providers/${p.id}`, { method: "DELETE" });
      toast.success("Provider deleted.");
      onClose();
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!provider} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{p ? `Edit ${p.name}` : "Add provider"}</DialogTitle>
        </DialogHeader>
        <form
          id="provider-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {PFIELDS.map(([k, label]) => (
            <label key={k} className={k === "notes" || k === "address" || k === "services" ? "grid gap-1.5 sm:col-span-2" : "grid gap-1.5"}>
              <span className="mono-label">{label}</span>
              {k === "notes" ? (
                <textarea className={field} rows={3} value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
              ) : (
                <input
                  className={field}
                  type={k === "email" ? "email" : k === "phone" || k === "phone2" ? "tel" : "text"}
                  inputMode={k === "website" ? "url" : undefined}
                  autoComplete="off"
                  value={values[k] ?? ""}
                  onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                />
              )}
            </label>
          ))}
        </form>
        <DialogFooter className="gap-2">
          {p && (
            <ActionButton onClick={remove} disabled={saving} className="border-destructive text-destructive sm:mr-auto">
              Delete
            </ActionButton>
          )}
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          <ActionButton tone="solid" onClick={save} disabled={saving} className="sm:min-w-24">
            Save
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
