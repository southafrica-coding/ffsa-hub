"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { createVehicle, updateVehicle, type Vehicle } from "@/services/vehicles";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function VehicleRow({ vehicle }: { vehicle: Vehicle }) {
  const supabase = createClient();
  const router = useRouter();
  const [d, setD] = useState({
    name: vehicle.name,
    vehicle_type: vehicle.vehicle_type,
    fuel_type: vehicle.fuel_type ?? "",
    seats: vehicle.seats?.toString() ?? "",
    registration_plate: vehicle.registration_plate ?? "",
    status: vehicle.status,
    color: vehicle.color,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!d.name.trim()) return toast.error("Vehicle name is required.");
    setSaving(true);
    const { error } = await updateVehicle(supabase, vehicle.id, {
      name: d.name.trim(),
      vehicle_type: d.vehicle_type,
      fuel_type: d.fuel_type ? (d.fuel_type as "diesel" | "petrol") : null,
      seats: d.seats ? parseInt(d.seats, 10) : null,
      registration_plate: d.registration_plate.trim() || null,
      status: d.status,
      color: d.color,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Vehicle saved.");
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
        className="h-9 w-40"
        placeholder="Name"
      />
      <select
        value={d.vehicle_type}
        onChange={(e) => setD({ ...d, vehicle_type: e.target.value as "van" | "car" })}
        className={SELECT_CLASS}
        aria-label="Type"
      >
        <option value="van">Van</option>
        <option value="car">Car</option>
      </select>
      <select
        value={d.fuel_type}
        onChange={(e) => setD({ ...d, fuel_type: e.target.value })}
        className={SELECT_CLASS}
        aria-label="Fuel"
      >
        <option value="">Fuel…</option>
        <option value="diesel">Diesel</option>
        <option value="petrol">Petrol</option>
      </select>
      <Input
        value={d.seats}
        onChange={(e) => setD({ ...d, seats: e.target.value })}
        className="h-9 w-16"
        placeholder="Seats"
        type="number"
      />
      <Input
        value={d.registration_plate}
        onChange={(e) => setD({ ...d, registration_plate: e.target.value })}
        className="h-9 w-32"
        placeholder="Plate"
      />
      <select
        value={d.status}
        onChange={(e) => setD({ ...d, status: e.target.value as Vehicle["status"] })}
        className={SELECT_CLASS}
        aria-label="Status"
      >
        <option value="active">Active</option>
        <option value="maintenance">Maintenance</option>
        <option value="retired">Retired</option>
      </select>
      <Button size="sm" variant="outline" onClick={save} disabled={saving} className="ml-auto">
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

export function FleetAdmin({ vehicles }: { vehicles: Vehicle[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [n, setN] = useState({
    name: "",
    vehicle_type: "van" as "van" | "car",
    fuel_type: "",
    seats: "",
    registration_plate: "",
    color: "#0ea5e9",
  });
  const [adding, setAdding] = useState(false);

  async function add() {
    if (!n.name.trim()) return toast.error("Vehicle name is required.");
    setAdding(true);
    const { error } = await createVehicle(supabase, {
      name: n.name.trim(),
      vehicle_type: n.vehicle_type,
      make_model: n.name.trim(),
      fuel_type: n.fuel_type ? (n.fuel_type as "diesel" | "petrol") : null,
      seats: n.seats ? parseInt(n.seats, 10) : null,
      registration_plate: n.registration_plate.trim() || null,
      color: n.color,
      sort_order: (vehicles.length ? vehicles[vehicles.length - 1].sort_order : 0) + 10,
    });
    setAdding(false);
    if (error) return toast.error(error.message);
    toast.success("Vehicle added.");
    setN({ name: "", vehicle_type: "van", fuel_type: "", seats: "", registration_plate: "", color: "#0ea5e9" });
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="text-sm font-semibold mb-2">Vehicles</h2>
        <div>
          {vehicles.map((v) => (
            <VehicleRow key={v.id} vehicle={v} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <input
            type="color"
            value={n.color}
            onChange={(e) => setN({ ...n, color: e.target.value })}
            className="h-9 w-9 shrink-0 cursor-pointer rounded border border-input bg-background"
            aria-label="Calendar colour"
          />
          <div className="space-y-1">
            <Label className="text-xs">New vehicle</Label>
            <Input
              value={n.name}
              onChange={(e) => setN({ ...n, name: e.target.value })}
              className="h-9 w-40"
              placeholder="Name"
            />
          </div>
          <select
            value={n.vehicle_type}
            onChange={(e) => setN({ ...n, vehicle_type: e.target.value as "van" | "car" })}
            className={SELECT_CLASS}
            aria-label="Type"
          >
            <option value="van">Van</option>
            <option value="car">Car</option>
          </select>
          <select
            value={n.fuel_type}
            onChange={(e) => setN({ ...n, fuel_type: e.target.value })}
            className={SELECT_CLASS}
            aria-label="Fuel"
          >
            <option value="">Fuel…</option>
            <option value="diesel">Diesel</option>
            <option value="petrol">Petrol</option>
          </select>
          <Input
            value={n.seats}
            onChange={(e) => setN({ ...n, seats: e.target.value })}
            className="h-9 w-16"
            placeholder="Seats"
            type="number"
          />
          <Input
            value={n.registration_plate}
            onChange={(e) => setN({ ...n, registration_plate: e.target.value })}
            className="h-9 w-32"
            placeholder="Plate"
          />
          <Button size="sm" onClick={add} disabled={adding} className="gap-1">
            <Plus className="h-4 w-4" />
            {adding ? "Adding…" : "Add"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
