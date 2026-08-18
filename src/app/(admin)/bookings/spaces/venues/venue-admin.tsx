"use client";

// Venues, ministries, and the one rule that decides whether a space can be
// booked outright: `requires_approval`.
//
// That rule already worked — the API honours it and the booking form previews
// it — but it lived as an unlabelled tickbox in a cramped row, so nobody could
// tell at a glance which spaces were open and which were held. It is now a
// two-state control that names both states, with a count above the list.

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

/** A square colour well. The venue colour is data, so it stays; the shape does
 *  not — nothing in this system is rounded.
 *
 *  The swatch is a span, not the native control's own surface: globals.css
 *  forces every input to a white background with padding, which squeezed the
 *  colour down to a sliver. The real input sits transparent on top so the
 *  picker, keyboard focus and labelling all still work. */
function ColorWell({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <span
      className="relative inline-block h-9 w-9 shrink-0 border border-rule-strong"
      style={{ backgroundColor: value }}
    >
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label={label}
      />
    </span>
  );
}

/**
 * Two named states rather than one tickbox. "Needs approval" and "Instant
 * book" are both spelled out, because the consequence of the off state is the
 * thing an admin actually needs to see: the space books itself.
 */
function ApprovalControl({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center" role="group" aria-label="Booking rule">
      <button
        type="button"
        onClick={() => onChange(true)}
        className="chip bg-white"
        data-active={value ? "true" : undefined}
        aria-pressed={value}
      >
        Needs approval
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className="chip -ml-px bg-white"
        data-active={!value ? "true" : undefined}
        aria-pressed={!value}
      >
        Instant book
      </button>
    </div>
  );
}

function ActiveControl({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="chip bg-white"
      data-active={value ? "true" : undefined}
      aria-pressed={value}
    >
      {value ? "Active" : "Hidden"}
    </button>
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

  const dirty =
    d.name !== venue.name ||
    d.building !== (venue.building ?? "") ||
    d.capacity !== (venue.capacity?.toString() ?? "") ||
    d.color !== venue.color ||
    d.is_active !== venue.is_active ||
    d.requires_approval !== venue.requires_approval;

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
    toast.success(`${d.name.trim()} saved.`);
    router.refresh();
  }

  return (
    <div className="border-b border-rule px-5 py-4 last:border-b-0 md:px-6">
      <div className="flex flex-wrap items-end gap-2">
        <ColorWell
          value={d.color}
          onChange={(color) => setD({ ...d, color })}
          label={`${venue.name} calendar colour`}
        />
        <Input
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
          className="h-9 w-44"
          placeholder="Name"
          aria-label="Venue name"
        />
        <Input
          value={d.building}
          onChange={(e) => setD({ ...d, building: e.target.value })}
          className="h-9 w-36"
          placeholder="Building"
          aria-label="Building"
        />
        <Input
          value={d.capacity}
          onChange={(e) => setD({ ...d, capacity: e.target.value })}
          className="h-9 w-20"
          placeholder="Cap."
          type="number"
          aria-label="Capacity"
        />
        {/* Only offered once there is something to save — a row that always
            shows a live Save button reads as unsaved work that is not there. */}
        <Button
          size="sm"
          variant="outline"
          onClick={save}
          disabled={saving || !dirty}
          className="ml-auto"
        >
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="mono-label">Booking rule</span>
          <ApprovalControl
            value={d.requires_approval}
            onChange={(requires_approval) => setD({ ...d, requires_approval })}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="mono-label">Listing</span>
          <ActiveControl
            value={d.is_active}
            onChange={(is_active) => setD({ ...d, is_active })}
          />
        </div>
      </div>
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

  const dirty =
    d.name !== ministry.name ||
    d.color !== ministry.color ||
    d.is_active !== ministry.is_active;

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
    toast.success(`${d.name.trim()} saved.`);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-3.5 last:border-b-0 md:px-6">
      <ColorWell
        value={d.color}
        onChange={(color) => setD({ ...d, color })}
        label={`${ministry.name} chip colour`}
      />
      <Input
        value={d.name}
        onChange={(e) => setD({ ...d, name: e.target.value })}
        className="h-9 w-56"
        placeholder="Name"
        aria-label="Ministry name"
      />
      <ActiveControl
        value={d.is_active}
        onChange={(is_active) => setD({ ...d, is_active })}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={save}
        disabled={saving || !dirty}
        className="ml-auto"
      >
        {saving ? "Saving…" : dirty ? "Save" : "Saved"}
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

  // The headline an admin came here for: how much of the estate is held.
  const held = venues.filter((v) => v.requires_approval).length;

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
        <SectionBar
          title="Spaces"
          meta={
            venues.length === 0
              ? "None yet"
              : `${held} of ${venues.length} need approval`
          }
        />
        {/* Both states spelled out, including what each does about a clash —
            they differ, and an admin switching a space over should know which
            way. Wording checked against src/app/api/bookings/route.ts. */}
        <div className="border-b border-rule bg-bone px-5 py-3.5 text-[13px] text-[color:var(--text-secondary)] md:px-6">
          <p>
            <strong className="font-bold text-ink">Instant book</strong> — anyone with
            booking permission confirms it themselves, with no manager in the loop.
            Because nobody is there to catch a double-booking, a request that clashes
            is refused outright.
          </p>
          <p className="mt-1.5">
            <strong className="font-bold text-ink">Needs approval</strong> — the request
            is held as pending until a manager decides. A clash is shown to them as a
            warning rather than refused, so they can judge it. Managers still confirm
            their own bookings instantly.
          </p>
        </div>

        {venues.map((v) => (
          <VenueRow key={v.id} venue={v} />
        ))}

        <div className="flex flex-wrap items-end gap-2 border-t border-rule bg-bone px-5 py-4 md:px-6">
          <ColorWell
            value={newVenue.color}
            onChange={(color) => setNewVenue({ ...newVenue, color })}
            label="New venue calendar colour"
          />
          <div className="space-y-1">
            <Label className="text-xs">New space</Label>
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
          {/* New spaces inherit the column default (migration 097: false), so
              say so — a space added here is immediately self-service. */}
          <span className="mono-label ml-auto">New spaces are instant book</span>
        </div>
      </div>

      {/* Ministries */}
      <div className="border border-ink bg-white">
        <SectionBar title="Ministries" meta={`${ministries.length} total`} />

        {ministries.map((m) => (
          <MinistryRow key={m.id} ministry={m} />
        ))}

        <div className="flex flex-wrap items-end gap-2 border-t border-rule bg-bone px-5 py-4 md:px-6">
          <ColorWell
            value={newMinistry.color}
            onChange={(color) => setNewMinistry({ ...newMinistry, color })}
            label="New ministry chip colour"
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
  );
}
