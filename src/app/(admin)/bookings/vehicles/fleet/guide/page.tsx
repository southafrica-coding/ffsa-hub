import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireFleet, loadFleet } from "@/lib/fleet/load";
import { getFleetGuideProgress } from "@/services/fleet";
import { Masthead, SectionBar } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import { GUIDE, changeDate, guidePage, guideText, guideTokens, lastUpdated, stepKey, type GuideBlock, type GuideTokens } from "@/lib/fleet/guide";
import { guideHref, guidePageHref } from "./links";
import { Tutorial, type TutorialStep } from "./tutorial";

// Guide (SPEC 8): rendered from src/lib/fleet/content/guide-hub.json with the {tokens}
// filled from live settings. Tutorial ticks are kept per person.
export default async function FleetGuidePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const supabase = await createClient();
  const { user, access } = await requireFleet(supabase);
  const [{ page: pageId }, { F }, progress] = await Promise.all([searchParams, loadFleet(supabase), getFleetGuideProgress(supabase, user.id)]);
  const tk = guideTokens(F);
  const { page, prev, next } = guidePage(pageId);
  const done = ((progress.data ?? []) as { step: string }[]).map((r) => r.step);
  const kmVehicles = F.vehicles.map((v) => ({ id: v.id, name: v.name, reg: v.reg, odometer: v.odometer, odometerDate: v.odometerDate }));
  const T = (s: string) => guideText(s, tk);
  const updated = lastUpdated();

  return (
    <>
      <Masthead context="Fleet · Guide" title="Guide" />
      <div className="max-w-3xl">
        <p className="px-5 pt-5 text-[14px] text-[#55524A] md:px-8">How to use Fleet, and how to hand it over to a new vehicle co-ordinator.</p>

        <nav aria-label="Guide sections" className="flex flex-wrap gap-1.5 px-5 py-4 md:px-8">
          {GUIDE.pages.map((p) => (
            <Link
              key={p.id}
              href={guidePageHref(p.id)}
              aria-current={p.id === page.id ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em]",
                p.id === page.id ? "border-ink bg-ink text-white" : "border-rule-strong text-[#55524A] hover:border-ink hover:text-ink"
              )}
            >
              {p.title}
            </Link>
          ))}
        </nav>

        <section aria-labelledby="guide-title">
          <SectionBar title={page.title} />
          <h2 id="guide-title" className="sr-only">
            {page.title}
          </h2>
          <div className="px-5 py-5 md:px-8">
            {page.intro && <p className="mb-4 text-[15px] leading-relaxed">{T(page.intro)}</p>}
            {page.blocks.map((b, i) => (
              <Block
                key={i}
                block={b}
                tk={tk}
                steps={(steps) => (
                  <Tutorial
                    steps={steps.map(([title, text, link, act, actLabel]): TutorialStep => ({
                      key: stepKey(title),
                      title: T(title),
                      text: T(text),
                      href: guideHref(link, tk),
                      action: act && access.canManage ? { id: act, label: actLabel || "Do it" } : null,
                    }))}
                    done={done}
                    kmVehicles={kmVehicles}
                    today={F.today}
                  />
                )}
              />
            ))}
          </div>
        </section>

        <div className="flex flex-wrap justify-between gap-2 border-t border-rule px-5 py-4 md:px-8">
          {prev ? (
            <Link href={guidePageHref(prev.id)} className="inline-flex min-h-11 items-center border border-ink bg-white px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone">
              ← {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={guidePageHref(next.id)} className="inline-flex min-h-11 items-center border border-ink bg-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622] hover:text-white">
              {next.title} →
            </Link>
          )}
        </div>
        {updated && (
          <p className="px-5 pb-8 text-[12px] text-[#55524A] md:px-8">
            Last updated {updated}. The guide changes with the app: see{" "}
            <Link href={guidePageHref("changes")} className="underline">
              What’s new
            </Link>
            .
          </p>
        )}
      </div>
    </>
  );
}

function Block({
  block,
  tk,
  steps,
}: {
  block: GuideBlock;
  tk: GuideTokens;
  steps: (s: Extract<GuideBlock, { steps: unknown }>["steps"]) => React.ReactNode;
}) {
  const T = (s: string) => guideText(s, tk);
  if ("h" in block) return <h3 className="mb-2 mt-6 text-[20px] leading-tight first:mt-0">{T(block.h)}</h3>;
  if ("p" in block) return <p className="mb-3 text-[15px] leading-relaxed">{T(block.p)}</p>;
  if ("ul" in block)
    return (
      <ul className="mb-3 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed marker:text-[#7C786C]">
        {block.ul.map((x, i) => (
          <li key={i}>{T(x)}</li>
        ))}
      </ul>
    );
  if ("steps" in block) return <>{steps(block.steps)}</>;
  if ("changes" in block)
    return (
      <ul className="divide-y divide-rule border-y border-rule">
        {GUIDE.changes.map(([d, t], i) => (
          <li key={i} className="py-2.5 text-[15px] leading-relaxed">
            <strong>{changeDate(d)}:</strong> {T(t)}
          </li>
        ))}
      </ul>
    );
  return null;
}
