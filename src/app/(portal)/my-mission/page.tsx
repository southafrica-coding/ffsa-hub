import { Globe } from "lucide-react";
import { Masthead, ComingSoon } from "@/components/ffsa";

export default function MyMissionPage() {
  return (
    <div className="ffsa-screen">
      <Masthead context="Outreach & impact" title="My Mission" />
      <div className="space-y-6 px-5 py-6 md:px-8">
        <ComingSoon icon={<Globe className="h-9 w-9" />}>
          Your mission view is under development. You will be able to see your
          outreach trip history and the ministry statistics you have contributed
          — salvations, healings, gospel seeds, bibles distributed, and more.
        </ComingSoon>
      </div>
    </div>
  );
}
