import type { Metadata } from "next";
import { requireEvangelismPage } from "./access";
import { EvangelismHome } from "./home";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Evangelism" };

// Real evangelism screen. Do not put the placeholder redirect back.
// #499 still carries the old "not built yet" page and does not touch this
// file; a merge of that API must leave these routes in place.
export default async function EvangelismPage() {
  const user = await requireEvangelismPage();
  return (
    <div className="ffsa-screen">
      <EvangelismHome userId={user.id} />
    </div>
  );
}
