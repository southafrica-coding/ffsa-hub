"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ChevronsUpDown } from "lucide-react";
import { COUNTRIES, splitPhone } from "@/lib/profile/options";

/**
 * Phone input with a searchable country-code dropdown and a digits field.
 *
 * The bound value is the canonical concatenation: `"+27 71 234 5678"`.
 * Internally we track dial + number separately so re-rendering the
 * stored value (e.g. when the form pre-fills) puts the country code
 * back in the dropdown rather than dumping `+27...` into the digits.
 *
 * The country dropdown is a Popover + Command combobox so you can type to
 * find a country by name, ISO code, or dialing code (e.g. "germ", "za", "27").
 */
export function PhoneInput({
  id,
  value,
  onChange,
  placeholder,
  required,
  defaultDial = "+27",
}: {
  id?: string;
  value: string;
  onChange: (combined: string) => void;
  placeholder?: string;
  required?: boolean;
  defaultDial?: string;
}) {
  // Derive dial + number from the parent-controlled value so the field
  // stays in sync if the parent overrides it. Memoize per-value so we
  // don't re-parse on unrelated re-renders.
  const parsed = useMemo(
    () => (value ? splitPhone(value) : { dial: defaultDial, number: "" }),
    [value, defaultDial]
  );

  const [dial, setDial] = useState(parsed.dial);
  const [number, setNumber] = useState(parsed.number);
  const [open, setOpen] = useState(false);

  // If the parent value diverges from our internal state (e.g. user
  // pasted into another form field and came back), reconcile.
  if (parsed.dial !== dial || parsed.number !== number) {
    if (!value && number !== "") {
      // parent cleared us
      setDial(defaultDial);
      setNumber("");
    }
  }

  // Each country as its own searchable row. The search key covers name, ISO
  // and dial code so cmdk filters on all three (type "germ", "za", or "27").
  const searchableCountries = useMemo(
    () =>
      COUNTRIES.map((c) => ({
        ...c,
        searchKey: `${c.name} ${c.iso} ${c.dial}`.toLowerCase(),
      })),
    []
  );

  // The country shown on the trigger, derived from the current dial. Several
  // countries can share a dial (e.g. +1); showing the first is fine — the
  // stored value only encodes the dial, matching the previous behavior.
  const activeCountry = useMemo(
    () => COUNTRIES.find((c) => c.dial === dial),
    [dial]
  );

  function emit(nextDial: string, nextNumber: string) {
    const trimmed = nextNumber.trim();
    if (!trimmed) {
      onChange("");
      return;
    }
    onChange(`${nextDial} ${trimmed}`);
  }

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Country code"
            className="h-10 w-[132px] shrink-0 justify-between px-2 font-normal"
          >
            <span className="truncate text-sm">
              {activeCountry ? `${activeCountry.flag} ${activeCountry.dial}` : dial}
            </span>
            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search country…" />
            <CommandList>
              <CommandEmpty>No country found.</CommandEmpty>
              <CommandGroup>
                {searchableCountries.map((c) => (
                  <CommandItem
                    key={c.iso}
                    value={c.searchKey}
                    onSelect={() => {
                      setDial(c.dial);
                      emit(c.dial, number);
                      setOpen(false);
                    }}
                  >
                    <span className="mr-2">{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {c.dial}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        placeholder={placeholder ?? "71 234 5678"}
        value={number}
        required={required}
        onChange={(e) => {
          setNumber(e.target.value);
          emit(dial, e.target.value);
        }}
        className="flex-1"
      />
    </div>
  );
}
