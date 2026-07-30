"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Delete a single DUPLICATE insurance policy row. Only rendered for rows the
// server has already deemed deletable (see deletablePolicyIds); the API
// re-checks the rule, so this is UI convenience, not the security boundary.
export function DeletePolicyButton({ policyId }: { policyId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onDelete() {
    if (!window.confirm("Delete this duplicate insurance record?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/profile/insurance-policies/${policyId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Couldn't delete this record. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 text-muted-foreground hover:text-destructive"
      disabled={loading}
      onClick={onDelete}
      aria-label="Delete duplicate insurance record"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
