import { Suspense } from "react";
import type { Metadata } from "next";
import { PeopleDirectory } from "@/components/missio/people-directory";

export const metadata: Metadata = {
  title: { absolute: "People · Missio" },
};

export default function MissioPeoplePage() {
  return (
    <Suspense fallback={<p>Loading people…</p>}>
      <PeopleDirectory />
    </Suspense>
  );
}
