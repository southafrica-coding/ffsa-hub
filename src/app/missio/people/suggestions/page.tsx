import type { Metadata } from "next";
import { FamilySuggestionsList } from "@/components/missio/households/couple-suggestions";

export const metadata: Metadata = {
  title: { absolute: "Family suggestions · Missio" },
};

export default function MissioFamilySuggestionsPage() {
  return <FamilySuggestionsList />;
}
