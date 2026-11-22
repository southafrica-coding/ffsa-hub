import { notFound } from "next/navigation";
import { WeeklyFeedbackFill } from "@/components/missio/weekly/fill";
import { SundayResultsView } from "@/components/missio/weekly/results";
import { availabilityPreviewEnabled } from "@/lib/missio/availability/preview";
import { buildSundayResults } from "@/lib/missio/sunday-results";
import { FIXTURE_FILL, FIXTURE_HOUSES, FIXTURE_ROWS, FIXTURE_SUNDAY } from "@/lib/missio/weekly-fixtures";

export const dynamic = "force-dynamic";

// Screenshot route only (docs/hub-forms/f4): the real fill and results
// components on made-up fixtures, no database. Never served in
// production, even with MISSIO_SCREENSHOTS set (preview.ts).
export default async function WeeklyPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string; theme?: string }>;
}) {
  if (!availabilityPreviewEnabled()) notFound();
  const { screen, theme: rawTheme } = await searchParams;
  const theme = rawTheme === "dark" ? "dark" : "light";
  if (screen === "results") {
    return (
      <SundayResultsView
        results={buildSundayResults(FIXTURE_HOUSES, FIXTURE_ROWS, FIXTURE_SUNDAY)}
        nudge={{ enabled: false, endpoint: "/api/missio/feedback/nudge" }}
        navHref="/missio/house-churches/feedback"
        theme={theme}
      />
    );
  }
  return (
    <WeeklyFeedbackFill
      {...FIXTURE_FILL}
      endpoint="/api/serve/missio/feedback/preview"
      houseHref="/serve/missio/preview/weekly?screen=results"
      theme={theme}
      submit={undefined}
    />
  );
}
