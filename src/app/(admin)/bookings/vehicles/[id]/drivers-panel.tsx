"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionBar } from "@/components/ffsa";
import {
  DriverLicenseField,
  uploadDriverLicense,
  type LicenseValue,
} from "../driver-license-field";

const TEST_LABEL: Record<string, string> = {
  not_required: "No test needed",
  pending: "Test pending",
  passed: "Test passed",
  failed: "Test failed",
};

export type DriverPanelRow = {
  id: string | null;
  /** Set when the driver is a Hub user — their licence lives on their profile. */
  user_id?: string | null;
  name: string;
  phone: string;
  has_sa_license: boolean;
  is_first_time: boolean;
  driving_test_status: string;
  license: LicenseValue;
  /** Staged file for a driver that doesn't exist server-side yet. */
  stagedLicense?: File | null;
};

/**
 * Drivers on a booking: read-only summary, plus in-place editing for the
 * requester and vehicle managers. Drivers and licences can be added at any
 * time — including after the booking is approved.
 */
export function DriversPanel({
  bookingId,
  initialDrivers,
  canEdit,
  canRecordTest = false,
}: {
  bookingId: string;
  initialDrivers: DriverPanelRow[];
  canEdit: boolean;
  /** Vehicle managers only: recording a pass is what lifts the approval block. */
  canRecordTest?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<DriverPanelRow[]>(initialDrivers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setRow(i: number, patch: Partial<DriverPanelRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function startEditing() {
    setRows(initialDrivers);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const clean = rows
      .map((r) => ({ ...r, name: r.name.trim(), phone: r.phone.trim() }))
      .filter((r) => r.name);
    if (clean.length === 0 && rows.some((r) => !r.name.trim())) {
      setError("Every driver needs a name.");
      return;
    }
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/vehicles/bookings/${bookingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        drivers: clean.map((r) => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          has_sa_license: r.has_sa_license,
          is_first_time: r.is_first_time,
        })),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Could not save the drivers.");
      setSaving(false);
      return;
    }

    // Newly added drivers only get an id once saved, so their staged licence
    // uploads now. The API returns drivers in the order they were sent.
    const saved: { id: string }[] = json.drivers ?? [];
    const failed: string[] = [];
    await Promise.all(
      clean.map(async (r, i) => {
        if (!r.stagedLicense) return;
        const target = saved[i];
        if (!target) {
          failed.push(r.name);
          return;
        }
        const result = await uploadDriverLicense(target.id, r.stagedLicense);
        if ("error" in result) failed.push(r.name);
      })
    );

    setSaving(false);
    setEditing(false);
    if (failed.length > 0) {
      toast.warning(`Drivers saved, but the licence for ${failed.join(", ")} did not upload.`);
    } else {
      toast.success("Drivers updated.");
    }
    router.refresh();
  }

  /**
   * Record a driving-test result. For a Hub user it writes to their PROFILE,
   * so passing here clears them for every future booking too — not just this
   * one.
   */
  async function recordTest(driverId: string, result: "passed" | "failed") {
    const res = await fetch(`/api/vehicles/drivers/${driverId}/driving-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Could not record the driving test.");
      return;
    }
    toast.success(
      result === "passed"
        ? json.appliedToProfile
          ? "Driving test passed — saved to their profile."
          : "Driving test passed."
        : "Driving test marked as not passed."
    );
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="border border-ink bg-white">
        <SectionBar title="Drivers" meta={`${initialDrivers.length}`} />
        <div className="space-y-3 p-6">
          {initialDrivers.length === 0 ? (
            <p className="text-sm text-[color:var(--text-secondary)]">
              No drivers listed yet.
            </p>
          ) : (
            <div className="space-y-2">
              {initialDrivers.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule pb-2 text-sm last:border-b-0 last:pb-0"
                >
                  <span className="font-medium">{d.name}</span>
                  {d.phone && (
                    <span className="text-[color:var(--text-secondary)]">{d.phone}</span>
                  )}
                  <span
                    className={
                      d.has_sa_license ? "text-xs text-grass-text" : "text-xs text-destructive"
                    }
                  >
                    {d.has_sa_license ? "SA licence ✓" : "No licence on file"}
                  </span>
                  <span className="text-xs text-[color:var(--text-tertiary)]">
                    {TEST_LABEL[d.driving_test_status] ?? d.driving_test_status}
                  </span>
                  {d.license?.signed_url ? (
                    <a
                      href={d.license.signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline underline-offset-2"
                    >
                      {d.license.file_name ?? "View licence"}
                    </a>
                  ) : (
                    <span className="text-xs text-[color:var(--text-tertiary)]">
                      No licence photo
                    </span>
                  )}
                  {canRecordTest && d.id && d.driving_test_status === "pending" && (
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => recordTest(d.id as string, "passed")}
                        className="text-xs underline underline-offset-2 hover:text-grass-text"
                      >
                        Mark test passed
                      </button>
                      <button
                        type="button"
                        onClick={() => recordTest(d.id as string, "failed")}
                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
                      >
                        Not passed
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {canEdit && (
            <Button type="button" size="sm" variant="outline" onClick={startEditing}>
              {initialDrivers.length === 0 ? "Add drivers" : "Add / edit drivers"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Drivers" meta={`${rows.length}`} />
      <div className="space-y-3 p-6">
        <p className="text-xs text-muted-foreground">
          A licence photo is optional. Drivers already saved take their licence
          straight away; a driver you add here uploads their licence when you save.
        </p>
        {rows.map((d, i) => (
          <div key={d.id ?? `new-${i}`} className="space-y-1.5 border-b border-rule pb-3 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={d.name}
                onChange={(e) => setRow(i, { name: e.target.value })}
                placeholder="Name & surname"
                className="h-9 w-48"
              />
              <Input
                value={d.phone}
                onChange={(e) => setRow(i, { phone: e.target.value })}
                placeholder="WhatsApp number"
                className="h-9 w-40"
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={d.has_sa_license}
                  onChange={(e) => setRow(i, { has_sa_license: e.target.checked })}
                  className="rounded border-input"
                />
                SA licence
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={d.is_first_time}
                  onChange={(e) => setRow(i, { is_first_time: e.target.checked })}
                  className="rounded border-input"
                />
                First time / international
              </label>
              <button
                type="button"
                onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Remove driver"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <DriverLicenseField
              driverId={d.id}
              value={d.license}
              staged={d.stagedLicense ?? null}
              disabled={saving}
              onStage={(file) => setRow(i, { stagedLicense: file })}
              onChange={(value) => setRow(i, { license: value })}
            />
          </div>
        ))}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1 text-muted-foreground"
          onClick={() =>
            setRows((p) => [
              ...p,
              {
                id: null,
                name: "",
                phone: "",
                has_sa_license: false,
                is_first_time: false,
                driving_test_status: "not_required",
                license: null,
                stagedLicense: null,
              },
            ])
          }
        >
          <Plus className="h-4 w-4" />
          Add driver
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-3 pt-1">
          <Button type="button" size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save drivers"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
