import { redirect } from "next/navigation";
import { Masthead } from "@/components/ffsa";
import { isHiddenFromNav } from "@/config/modules";

export default function MyMissionPage() {
  // Unbuilt placeholder — out of the menu, so send direct visits home.
  if (isHiddenFromNav("my-mission")) redirect("/home");
  return (
    <div className="ffsa-screen">
      <Masthead context="Outreach &amp; impact" title="My mission" />

      {/* Still unbuilt. Said plainly and in the system's own voice rather
          than dressed up as a card — the old version used dark-theme
          classes (text-white on a light page) and a rounded panel, both of
          which the redesign removed. */}
      <div className="border-b border-rule px-5 py-12 md:px-8 md:py-16">
        <div className="max-w-xl">
          <div className="mono-label mb-3">Not built yet</div>
          <h2 className="font-display text-[34px] font-black uppercase leading-[0.95] text-ink md:text-[44px]">
            Your outreach history
            <br />
            will live here
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
            Trips you have been on, and the ministry figures you contributed to
            — salvations, healings, gospel seeds, bibles distributed. Nothing is
            being counted for you yet.
          </p>
        </div>
      </div>
    </div>
  );
}
