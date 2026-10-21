"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
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
import { Plus } from "lucide-react";

type Program = {
  id: string;
  name: string;
  code: string;
};

// Radix Select can't hold an empty value, so "no school" gets a stand-in.
const NO_SCHOOL = "__none__";

export function CreateTeamForm({ programs }: { programs: Program[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [teamName, setTeamName] = useState("");
  const [programId, setProgramId] = useState("");
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [peopleCount, setPeopleCount] = useState("");
  const [totalBudget, setTotalBudget] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/finance/outreach/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program_id: programId || null,
          team_name: teamName,
          location: location || null,
          country: country || null,
          start_date: startDate || null,
          end_date: endDate || null,
          people_count: peopleCount ? Number(peopleCount) : 0,
          total_budget_zar: totalBudget ? Number(totalBudget) : 0,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create team");
        return;
      }

      setOpen(false);
      setTeamName("");
      setProgramId("");
      setLocation("");
      setCountry("");
      setStartDate("");
      setEndDate("");
      setPeopleCount("");
      setTotalBudget("");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Team
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Outreach Team</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Team Name *</Label>
              <Input
                required
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Burundi Team A"
              />
            </div>
            <div className="col-span-2">
              <Label>School / Program</Label>
              <Select
                value={programId || NO_SCHOOL}
                onValueChange={(v) => setProgramId(v === NO_SCHOOL ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a school..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SCHOOL}>No school (independent outreach)</SelectItem>
                  {programs.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Location</Label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Bujumbura"
              />
            </div>
            <div>
              <Label>Country</Label>
              <Input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. Burundi"
              />
            </div>
            <div>
              <Label>Start Date</Label>
              <DateInput
                value={startDate}
                onChange={(v) => setStartDate(v)}
              />
            </div>
            <div>
              <Label>End Date</Label>
              <DateInput
                value={endDate}
                onChange={(v) => setEndDate(v)}
              />
            </div>
            <div>
              <Label>People Count</Label>
              <Input
                type="number"
                min="0"
                value={peopleCount}
                onChange={(e) => setPeopleCount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Total Budget (ZAR)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={totalBudget}
                onChange={(e) => setTotalBudget(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !teamName.trim()}>
              {loading ? "Creating..." : "Create Team"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
