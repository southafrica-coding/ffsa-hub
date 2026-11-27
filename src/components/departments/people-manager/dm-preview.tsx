import Link from "next/link";
import pw from "@/components/song-library/pw.module.css";
import { pmPaths } from "./client";
import pm from "./pm.module.css";
import { SectionBar } from "./ui";

/**
 * What the leave Slack DMs say, in a generic Hub layout (not Slack's own
 * look). Example names only. Nothing is sent from here; the buttons are
 * pictures of buttons.
 */
export function DmPreview({ slug, departmentName }: { slug: string; departmentName: string }) {
  const paths = pmPaths(slug);
  const fake = (label: string, kind: "primary" | "plain" | "ghost" | "decline" = "plain") => (
    <span
      className={[pw.btn, kind === "primary" ? pw.primary : "", kind === "ghost" ? pw.ghost : "", kind === "decline" ? pm.declineBtn : ""]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      {label}
    </span>
  );
  return (
    <>
      <div className={pm.mocklabel}>Preview of the Slack DMs. Generic layout, not Slack&apos;s own look. Example names; nothing is sent.</div>

      <SectionBar title="To a leader" meta="asking for a decision" />
      <div className={pm.dmhead}>
        <span className={pm.botav}>FF</span>
        <div>
          <div className={pm.dmheadK}>FFSA Hub Activity</div>
          <div className={pm.dmheadS}>Direct message to each {departmentName} leader</div>
        </div>
      </div>
      <div className={pm.dmwrap}>
        <div className={pm.daysep}>Today</div>
        <div className={pm.dm}>
          <span className={pm.botav}>FF</span>
          <div className={pm.dmBody}>
            <div className={pm.dmNm}>
              FFSA Hub Activity<span className={pm.dmTm}>08:14</span>
            </div>
            <div className={`${pm.bubble} ${pm.bubbleYellow}`}>
              <div className={pm.bubbleH}>Sam Example asked for sick leave</div>
              <div className={pm.bubbleP}>
                Thu 26 Nov – Tue 1 Dec · <b>4 weekdays</b>
              </div>
              <div className={pm.ctx}>
                <div>
                  <span className={pm.ctxL}>Used</span>
                  <span className={pm.ctxOver}>Sick: 7 of 5 guideline days used (+2 over)</span>
                </div>
                <div>
                  <span className={pm.ctxL}>Notes</span>
                  <span>Flu, doctor&apos;s note to follow. Alex has the Thursday noon set.</span>
                </div>
                <div>
                  <span className={pm.ctxL}>Covering</span>
                  <span>Alex Sample</span>
                </div>
                <div>
                  <span className={pm.ctxL}>Also away</span>
                  <span>Jo Placeholder, away 30 Nov – 4 Dec · Lee Demo, unavailable Tue 1 Dec</span>
                </div>
                <div>
                  <span className={pm.ctxL}>Dept</span>
                  <span>{departmentName} · with Sam, 3 of 7 away or unavailable on Tue 1 Dec</span>
                </div>
              </div>
              <div className={pm.dmBtns}>
                {fake("Approve", "primary")}
                {fake("Decline", "decline")}
              </div>
              <div className={pm.dmBtns} style={{ marginTop: 6 }}>
                {fake("Approve with a note", "ghost")}
                <Link className={`${pw.btn} ${pw.ghost}`} href={paths.home}>
                  Open in Hub
                </Link>
              </div>
              <div className={pm.why}>
                You get this because you lead {departmentName}. The other leaders got it too, and the first decision counts.
              </div>
            </div>
          </div>
        </div>
      </div>

      <SectionBar title="After tapping Decline" meta="a note is required" />
      <div className={pm.modal}>
        <div className={pm.modalH}>
          <span>Decline Sam&apos;s request</span>
          <span aria-hidden="true">×</span>
        </div>
        <div className={pm.modalB}>
          <div className={pw.label}>Note to Sam</div>
          <div className={pm.fakeInput}>Let&apos;s talk first. Can you call me today?</div>
          <p className={pm.why}>Sam sees this in their DM and in the Hub.</p>
        </div>
        <div className={pm.modalF}>
          {fake("Back")}
          {fake("Decline request", "primary")}
        </div>
      </div>

      <SectionBar title="After a decision" meta="message updates" />
      <div className={pm.dmwrap} style={{ paddingTop: 4 }}>
        <div className={pm.dm}>
          <span className={pm.botav}>FF</span>
          <div className={pm.dmBody}>
            <div className={`${pm.bubble} ${pm.bubbleGreen}`}>
              <div className={pm.bubbleH}>✓ Approved by you · 08:21</div>
              <div className={pm.bubbleP}>Sam Example · Sick · Thu 26 Nov – Tue 1 Dec · 4 weekdays</div>
              <div className={pm.why}>The buttons are gone so it can&apos;t be decided twice. The other leaders&apos; copies say the same.</div>
            </div>
          </div>
        </div>
      </div>

      <SectionBar title="To the person who asked" meta="after the decision" />
      <div className={pm.dmwrap}>
        <div className={pm.daysep}>Approved</div>
        <div className={pm.dm}>
          <span className={pm.botav}>FF</span>
          <div className={pm.dmBody}>
            <div className={pm.dmNm}>
              FFSA Hub Activity<span className={pm.dmTm}>08:21</span>
            </div>
            <div className={`${pm.bubble} ${pm.bubbleGreen}`}>
              <div className={pm.bubbleH}>✓ Your sick leave is confirmed</div>
              <div className={pm.bubbleP}>Thu 26 Nov – Tue 1 Dec · 4 weekdays · approved by Robin Leader</div>
              <div className={pm.lnote}>
                <span className={pm.lnoteBy}>Note from Robin</span>
                Rest up. No need to rush back. Send the doctor&apos;s note when you can.
              </div>
              <div className={pm.remind}>
                <b>Before you go: get your job completely covered.</b>
                Alex Sample is down as covering. Hand over anything they need, like your sets, keys and messages, so nothing waits for you.
              </div>
              <div className={pm.dmBtns}>
                <Link className={pw.btn} href={paths.mine}>
                  View in Hub
                </Link>
              </div>
              <div className={pm.why}>Sick this year: 7 of 5 guideline days.</div>
            </div>
          </div>
        </div>
        <div className={pm.daysep}>Declined</div>
        <div className={pm.dm}>
          <span className={pm.botav}>FF</span>
          <div className={pm.dmBody}>
            <div className={pm.dmNm}>
              FFSA Hub Activity<span className={pm.dmTm}>Wed 28 Oct</span>
            </div>
            <div className={`${pm.bubble} ${pm.bubbleRed}`}>
              <div className={pm.bubbleH}>✕ Your study leave wasn&apos;t approved</div>
              <div className={pm.bubbleP}>Mon 9 – Fri 13 Nov · 5 weekdays · declined by Robin Leader</div>
              <div className={`${pm.lnote} ${pm.lnoteRed}`}>
                <span className={pm.lnoteBy}>Note from Robin</span>
                Outreach week, we need everyone on sets. Can we look at January for the course?
              </div>
              <div className={pm.dmBtns}>
                <Link className={`${pw.btn} ${pw.primary}`} href={paths.request}>
                  Request other dates
                </Link>
                <Link className={pw.btn} href={paths.mine}>
                  View in Hub
                </Link>
              </div>
              <div className={pm.why}>Nothing was taken off your study days.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
