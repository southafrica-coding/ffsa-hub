"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import {
  createVenue,
  updateVenue,
  createMinistry,
  updateMinistry,
  slugify,
  type Venue,
  type Ministry,
} from "@/services/bookings";
import { SectionBar } from "@/components/ffsa";

function CheckToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-input"
      />
      {label}
    </label>
  );
}

function VenueRow({ venue }: { venue: Venue }) {
  const supabase = createClient();
  const router = useRouter();
  const [d, setD] = useState({
    name: venue.name,
    building: venue.building ?? "",
    capacity: venue.capacity?.toString() ?? "",
    color: venue.color,
    is_active: venue.is_active,
    requires_approval: venue.requires_approval,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!d.name.trim()) return toast.error("Venue name is required.");
    setSaving(true);
    const { error } = await updateVenue(supabase, venue.id, {
      name: d.name.trim(),
      building: d.building.trim() || null,
      capacity: d.capacity ? parseInt(d.capacity, 10) : null,
      color: d.color,
      is_active: d.is_active,
      requires_approval: d.requires_approval,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Venue saved.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-b py-3 last:border-b-0">
      <input
        type="color"
        value={d.color}
        onChange={(e) => setD({ ...d, color: e.target.value })}
        className="h-9 w-9 shrink-0 cursor-pointer rounded border border-input bg-background"
        aria-label="Calendar colour"
      />
      <Input
        value={d.name}
        onChange={(e) => setD({ ...d, name: e.target.value })}
        className="h-9 w-44"
        placeholder="Name"
      />
      <Input
        value={d.building}
        onChange={(e) => setD({ ...d, building: e.target.value })}
        className="h-9 w-36"
        placeholder="Building"
      />
      <Input
        value={d.capacity}
        onChange={(e) => setD({ ...d, capacity: e.target.value })}
        className="h-9 w-20"
        placeholder="Cap."
        type="number"
      />
      <CheckToggle
        checked={d.requires_approval}
        onChange={(v) => setD({ ...d, requires_approval: v })}
        label="Needs approval"
      />
      <CheckToggle
        checked={d.is_active}
        onChange={(v) => setD({ ...d, is_active: v })}
        label="Active"
      />
      <Button size="sm" variant="outline" onClick={save} disabled={saving} className="ml-auto">
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

function MinistryRow({ ministry }: { ministry: Ministry }) {
  const supabase = createClient();
  const router = useRouter();
  const [d, setD] = useState({
    name: ministry.name,
    color: ministry.color,
    is_active: ministry.is_active,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!d.name.trim()) return toast.error("Ministry name is required.");
    setSaving(true);
    const { error } = await updateMinistry(supabase, ministry.id, {
      name: d.name.trim(),
      color: d.color,
      is_active: d.is_active,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Ministry saved.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-b py-3 last:border-b-0">
      <input
        type="color"
        value={d.color}
        onChange={(e) => setD({ ...d, color: e.target.value })}
        className="h-9 w-9 shrink-0 cursor-pointer rounded border border-input bg-background"
        aria-label="Chip colour"
      />
      <Input
        value={d.name}
        onChange={(e) => setD({ ...d, name: e.target.value })}
        className="h-9 w-56"
        placeholder="Name"
      />
      <CheckToggle
        checked={d.is_active}
        onChange={(v) => setD({ ...d, is_active: v })}
        label="Active"
      />
      <Button size="sm" variant="outline" onClick={save} disabled={saving} className="ml-auto">
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

export function VenueAdmin({
  venues,
  ministries,
}: {
  venues: Venue[];
  ministries: Ministry[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const [newVenue, setNewVenue] = useState({ name: "", building: "", color: "#0ea5e9" });
  const [newMinistry, setNewMinistry] = useState({ name: "", color: "#6366f1" });
  const [addingV, setAddingV] = useState(false);
  const [addingM, setAddingM] = useState(false);

  async function addVenue() {
    if (!newVenue.name.trim()) return toast.error("Venue name is required.");
    setAddingV(true);
    const { error } = await createVenue(supabase, {
      name: newVenue.name.trim(),
      slug: slugify(newVenue.name),
      building: newVenue.building.trim() || null,
      color: newVenue.color,
      sort_order: (venues.length ? venues[venues.length - 1].sort_order : 0) + 10,
    });
    setAddingV(false);
    if (error) return toast.error(error.message);
    toast.success("Venue added.");
    setNewVenue({ name: "", building: "", color: "#0ea5e9" });
    router.refresh();
  }

  async function addMinistry() {
    if (!newMinistry.name.trim()) return toast.error("Ministry name is required.");
    setAddingM(true);
    const { error } = await createMinistry(supabase, {
      name: newMinistry.name.trim(),
      slug: slugify(newMinistry.name),
      color: newMinistry.color,
      sort_order: (ministries.length ? ministries[ministries.length - 1].sort_order : 0) + 10,
    });
    setAddingM(false);
    if (error) return toast.error(error.message);
    toast.success("Ministry added.");
    setNewMinistry({ name: "", color: "#6366f1" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Venues */}
      <div className="border border-ink bg-white">
        <SectionBar title="Venues" />
        <div className="p-6">
          <div>
            {venues.map((v) => (
              <VenueRow key={v.id} venue={v} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <input
              type="color"
              value={newVenue.color}
              onChange={(e) => setNewVenue({ ...newVenue, color: e.target.value })}
              className="h-9 w-9 shrink-0 cursor-pointer rounded border border-input bg-background"
              aria-label="Calendar colour"
            />
            <div className="space-y-1">
              <Label className="text-xs">New venue</Label>
              <Input
                value={newVenue.name}
                onChange={(e) => setNewVenue({ ...newVenue, name: e.target.value })}
                className="h-9 w-44"
                placeholder="Name"
              />
            </div>
            <Input
              value={newVenue.building}
              onChange={(e) => setNewVenue({ ...newVenue, building: e.target.value })}
              className="h-9 w-36"
              placeholder="Building"
            />
            <Button size="sm" onClick={addVenue} disabled={addingV} className="gap-1">
              <Plus className="h-4 w-4" />
              {addingV ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      </div>

      {/* Ministries */}
      <div className="border border-ink bg-white">
        <SectionBar title="Ministries" />
        <div className="p-6">
          <div>
            {ministries.map((m) => (
              <MinistryRow key={m.id} ministry={m} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <input
              type="color"
              value={newMinistry.color}
              onChange={(e) => setNewMinistry({ ...newMinistry, color: e.target.value })}
              className="h-9 w-9 shrink-0 cursor-pointer rounded border border-input bg-background"
              aria-label="Chip colour"
            />
            <div className="space-y-1">
              <Label className="text-xs">New ministry</Label>
              <Input
                value={newMinistry.name}
                onChange={(e) => setNewMinistry({ ...newMinistry, name: e.target.value })}
                className="h-9 w-56"
                placeholder="Name"
              />
            </div>
            <Button size="sm" onClick={addMinistry} disabled={addingM} className="gap-1">
              <Plus className="h-4 w-4" />
              {addingM ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
