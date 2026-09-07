"use client";

import { useEffect, useState } from "react";
import type { VehiclePerson } from "@/services/vehicles";
import { countries } from "@/lib/countries";

/**
 * The Hub roster behind the renter and driver pickers.
 *
 * Fetched once per form and shared by every picker on it — a booking with
 * four drivers should not pull the roster four times.
 */
export function usePeople() {
  const [people, setPeople] = useState<VehiclePerson[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/vehicles/people");
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setPeople(json.people ?? []);
      } catch {
        /* the form still works by typing details in by hand */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { people, loaded };
}

/**
 * A profile's country as an ISO-2 code for the CountryPicker.
 *
 * Profiles store this inconsistently — `country` may hold a code, while
 * `nationality` holds a full country name (migration 115) — so accept both
 * rather than silently leaving the field blank for half the roster.
 */
export function toIso2(value: string | null): string {
  if (!value) return "";
  const v = value.trim();
  if (v.length === 2) return v.toUpperCase();
  const hit = countries.find((c) => c.name.toLowerCase() === v.toLowerCase());
  return hit?.iso2 ?? "";
}

/** A plain person <select>. Empty value means "not a Hub user". */
export function PersonSelect({
  id,
  value,
  onChange,
  people,
  placeholder = "Choose a person…",
  outsiderLabel,
  className,
}: {
  id?: string;
  value: string;
  onChange: (userId: string) => void;
  people: VehiclePerson[];
  placeholder?: string;
  /** When given, adds an explicit "not in the Hub" escape hatch. */
  outsiderLabel?: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? "h-10 w-full"}
    >
      <option value="">{outsiderLabel ?? placeholder}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
