"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Globe, Plus, Trash2, Search } from "lucide-react";

type CountryTier = {
  id: string;
  country_name: string;
  tier: string;
};

const TIER_COLORS: Record<string, "default" | "secondary" | "destructive"> = {
  A: "default",
  B: "secondary",
  C: "destructive",
};

export function CountryTiersDialog({
  initialTiers,
}: {
  initialTiers: CountryTier[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tiers, setTiers] = useState<CountryTier[]>(initialTiers);
  const [search, setSearch] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [newTier, setNewTier] = useState("A");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setTiers(initialTiers);
  }, [initialTiers]);

  const filtered = tiers.filter((t) =>
    t.country_name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleAdd() {
    if (!newCountry.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/finance/school-fees/country-tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country_name: newCountry.trim(),
          tier: newTier,
        }),
      });
      if (res.ok) {
        const { data } = await res.json();
        setTiers((prev) => [...prev, data].sort((a, b) =>
          a.country_name.localeCompare(b.country_name)
        ));
        setNewCountry("");
        toast.success(`Added ${newCountry.trim()} as Tier ${newTier}`);
        router.refresh();
      } else {
        const { error } = await res.json();
        toast.error(error || "Failed to add country");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setAdding(false);
    }
  }

  async function handleTierChange(country: CountryTier, tier: string) {
    const res = await fetch("/api/finance/school-fees/country-tiers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country_name: country.country_name, tier }),
    });
    if (res.ok) {
      setTiers((prev) =>
        prev.map((t) =>
          t.id === country.id ? { ...t, tier } : t
        )
      );
      toast.success(`${country.country_name} updated to Tier ${tier}`);
      router.refresh();
    } else {
      toast.error("Failed to update tier");
    }
  }

  async function handleDelete(country: CountryTier) {
    if (!confirm(`Remove ${country.country_name}?`)) return;
    const res = await fetch(
      `/api/finance/school-fees/country-tiers?id=${country.id}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      setTiers((prev) => prev.filter((t) => t.id !== country.id));
      toast.success(`Removed ${country.country_name}`);
      router.refresh();
    } else {
      toast.error("Failed to delete");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Globe className="mr-2 h-4 w-4" />
          Country Tiers ({tiers.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Country Pricing Tiers</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Tier A = full price · Tier B = reduced · Tier C = heavily reduced
        </p>

        {/* Add new country */}
        <div className="flex gap-2">
          <Input
            placeholder="Country name..."
            value={newCountry}
            onChange={(e) => setNewCountry(e.target.value)}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <Select value={newTier} onValueChange={setNewTier}>
            <SelectTrigger className="w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="A">Tier A</SelectItem>
              <SelectItem value="B">Tier B</SelectItem>
              <SelectItem value="C">Tier C</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handleAdd} disabled={adding || !newCountry.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search countries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Country list */}
        <div className="space-y-1 max-h-[400px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {search ? "No countries match your search" : "No countries added yet"}
            </p>
          ) : (
            filtered.map((country) => (
              <div
                key={country.id}
                className="flex items-center justify-between px-2 py-1.5 hover:bg-bone"
              >
                <span className="text-sm">{country.country_name}</span>
                <div className="flex items-center gap-2">
                  <Select
                    value={country.tier}
                    onValueChange={(v) => handleTierChange(country, v)}
                  >
                    <SelectTrigger className="h-7 w-[80px] text-xs">
                      <Badge
                        variant={TIER_COLORS[country.tier] ?? "secondary"}
                        className="text-xs"
                      >
                        Tier {country.tier}
                      </Badge>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">Tier A</SelectItem>
                      <SelectItem value="B">Tier B</SelectItem>
                      <SelectItem value="C">Tier C</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => handleDelete(country)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
