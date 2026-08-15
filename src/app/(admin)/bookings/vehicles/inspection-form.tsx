"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Trash2, FileText, Image as ImageIcon } from "lucide-react";
import {
  DAMAGE_PANELS,
  INVENTORY_ITEMS,
  inspectionKindLabel,
  type InspectionKind,
} from "@/services/vehicles";
import { SectionBar } from "@/components/ffsa";

type UploadedFile = {
  id: string;
  kind: "damage_photo" | "license";
  file_name: string | null;
  signed_url: string | null;
};

export function InspectionForm({
  bookingId,
  kind,
  vehicles,
  defaultDriverNames,
  initialFiles,
}: {
  bookingId: string;
  kind: InspectionKind;
  vehicles: { id: string; name: string }[];
  defaultDriverNames: string;
  initialFiles: UploadedFile[];
}) {
  const router = useRouter();
  const isCollection = kind === "collection";

  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [driverNames, setDriverNames] = useState(defaultDriverNames);
  const [mileage, setMileage] = useState("");
  const [damagePanels, setDamagePanels] = useState<string[]>([]);
  const [inventory, setInventory] = useState<Record<string, boolean>>(
    Object.fromEntries(INVENTORY_ITEMS.map((i) => [i.key, true]))
  );
  const [washed, setWashed] = useState(false);
  const [fuelFull, setFuelFull] = useState(false);
  const [damageReported, setDamageReported] = useState(false);
  const [notes, setNotes] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [files, setFiles] = useState<UploadedFile[]>(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePanel(key: string) {
    setDamagePanels((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  }

  async function uploadFiles(list: FileList | null, fileKind: "damage_photo" | "license") {
    if (!list || list.length === 0) return;
    setUploading(true);
    for (const file of Array.from(list)) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("booking_id", bookingId);
      fd.append("kind", fileKind);
      const res = await fetch("/api/vehicles/inspections/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? `Could not upload ${file.name}`);
        continue;
      }
      setFiles((prev) => [
        ...prev,
        {
          id: json.file.id,
          kind: fileKind,
          file_name: json.file.file_name,
          signed_url: json.signed_url,
        },
      ]);
    }
    setUploading(false);
  }

  async function removeFile(f: UploadedFile) {
    const res = await fetch(`/api/vehicles/inspections/files?id=${f.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not remove the file.");
      return;
    }
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
  }

  async function submit() {
    if (!mileage) {
      setError("Please enter the vehicle mileage.");
      return;
    }
    if (!agreed) {
      setError("Please confirm the declaration before submitting.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/vehicles/inspections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicle_booking_id: bookingId,
        vehicle_id: vehicleId || null,
        kind,
        driver_names: driverNames.trim() || null,
        mileage: parseInt(mileage, 10),
        damage_panels: isCollection ? damagePanels : [],
        inventory: isCollection ? inventory : {},
        washed: isCollection ? null : washed,
        fuel_full: isCollection ? null : fuelFull,
        damage_reported: isCollection ? null : damageReported,
        condition_notes: notes.trim() || null,
        declaration_agreed: agreed,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Could not save the inspection.");
      setSaving(false);
      return;
    }
    toast.success(`${inspectionKindLabel(kind)} recorded.`);
    router.push(`/bookings/vehicles/${bookingId}`);
    router.refresh();
  }

  const photos = files.filter((f) => f.kind === "damage_photo");
  const licenses = files.filter((f) => f.kind === "license");

  return (
    <div className="border border-ink bg-white">
      <SectionBar title={kind === "collection" ? "Collection inspection" : "Return inspection"} />
      <div className="space-y-5 p-6">
        {/* Vehicle + driver + mileage */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Vehicle</Label>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="h-10 w-full"
            >
              <option value="">— select —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mileage">Mileage (km) *</Label>
            <Input
              id="mileage"
              type="number"
              min={0}
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="drivers">Driver(s) present</Label>
            <Input
              id="drivers"
              value={driverNames}
              onChange={(e) => setDriverNames(e.target.value)}
            />
          </div>
        </div>

        {isCollection ? (
          <>
            {/* Walk-around damage map */}
            <div className="space-y-2 border border-rule bg-bone p-4">
              <Label>Walk-around — tick any panel that HAS damage</Label>
              <p className="text-xs text-muted-foreground">
                Anything you don&apos;t mark is treated as undamaged at collection.
              </p>
              <div className="grid grid-cols-1 gap-1.5 pt-1 sm:grid-cols-2">
                {DAMAGE_PANELS.map((p) => (
                  <label
                    key={p.key}
                    className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-bone"
                  >
                    <input
                      type="checkbox"
                      checked={damagePanels.includes(p.key)}
                      onChange={() => togglePanel(p.key)}
                      className="rounded border-input"
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Inventory */}
            <div className="space-y-2 border border-rule bg-bone p-4">
              <Label>Inventory — tick what&apos;s present in the vehicle</Label>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1">
                {INVENTORY_ITEMS.map((i) => (
                  <label key={i.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!inventory[i.key]}
                      onChange={(e) =>
                        setInventory((prev) => ({ ...prev, [i.key]: e.target.checked }))
                      }
                      className="rounded border-input"
                    />
                    {i.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Licences */}
            <FileSection
              label="Driver licence copies"
              accept="image/*,application/pdf"
              files={licenses}
              uploading={uploading}
              onUpload={(l) => uploadFiles(l, "license")}
              onRemove={removeFile}
            />
          </>
        ) : (
          <div className="space-y-2 border border-rule bg-bone p-4">
            <Label>Return condition</Label>
            <div className="flex flex-col gap-2 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={washed} onChange={(e) => setWashed(e.target.checked)} className="rounded border-input" />
                Washed inside &amp; out (receipt provided)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={fuelFull} onChange={(e) => setFuelFull(e.target.checked)} className="rounded border-input" />
                Returned full of the correct fuel
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={damageReported} onChange={(e) => setDamageReported(e.target.checked)} className="rounded border-input" />
                All damage / faults reported to the coordinator
              </label>
            </div>
          </div>
        )}

        {/* Damage photos (both kinds) */}
        <FileSection
          label="Damage / condition photos"
          accept="image/*"
          files={photos}
          uploading={uploading}
          onUpload={(l) => uploadFiles(l, "damage_photo")}
          onRemove={removeFile}
        />

        {/* Notes */}
        <div className="space-y-2">
          <Label htmlFor="notes">Condition notes</Label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="flex w-full"
          />
        </div>

        {/* Declaration */}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 rounded border-input"
          />
          I confirm this inspection is accurate and I agree to the FFSA Vehicle
          Usage Policy &amp; indemnity.
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-3 pt-1">
          <Button onClick={submit} disabled={saving || uploading}>
            {saving ? "Saving…" : `Record ${isCollection ? "collection" : "return"}`}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function FileSection({
  label,
  accept,
  files,
  uploading,
  onUpload,
  onRemove,
}: {
  label: string;
  accept: string;
  files: UploadedFile[];
  uploading: boolean;
  onUpload: (list: FileList | null) => void;
  onRemove: (f: UploadedFile) => void;
}) {
  return (
    <div className="space-y-2 border border-rule bg-bone p-4">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <label className="inline-flex cursor-pointer items-center gap-1.5 border border-ink px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone">
          <Upload className="h-3.5 w-3.5" />
          {uploading ? "Uploading…" : "Add files"}
          <input
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={(e) => {
              onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">None uploaded yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              {f.kind === "license" ? (
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              {f.signed_url ? (
                <a
                  href={f.signed_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-foreground hover:text-ink"
                >
                  {f.file_name ?? "file"}
                </a>
              ) : (
                <span className="truncate">{f.file_name ?? "file"}</span>
              )}
              <button
                type="button"
                onClick={() => onRemove(f)}
                className="ml-auto text-muted-foreground hover:text-destructive"
                aria-label="Remove file"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
