import type { Metadata } from "next";
import { requireEvangelismPage } from "./access";
import { EvangelismHome } from "./home";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Evangelism" };

export default async function EvangelismPage() {
  const user = await requireEvangelismPage();
  return (
    <div className="ffsa-screen">
      <EvangelismHome userId={user.id} />
    </div>
  );
}
