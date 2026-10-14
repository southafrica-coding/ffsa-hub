"use client";

/**
 * The prayer room module shell.
 *
 * Frames 10a and 12a put the module's navigation in one mono tab strip under a
 * single masthead — WEEK, DAY, PEOPLE, then EVALUATORS when your hub profile
 * carries the permission. What was here before was `page-title` plus shadcn
 * tabs, and the module had no masthead at all.
 *
 * Each tab renders the chrome itself (see `chrome.tsx`) because the context
 * line, the actions and the filters all belong to the tab, not to the shell.
 * Only one is mounted at a time, so the one-masthead rule still holds.
 */

import { useState } from "react";
import ScheduleView from "./components/schedule-view";
import MySets from "./components/my-sets";
import ApplyForm from "./components/apply-form";
import People from "./components/people";
import EvaluatorsPortal from "./components/evaluators";
import AdminPanel from "./components/admin-panel";
import PracticeView from "./components/practice-view";
import PrayerRoomChrome, { type TabDef, type TabKey } from "./components/chrome";

interface Props {
  userId: string;
  userName: string;
  isStaff: boolean;
  isMember: boolean;
  /** Signed off for at least one seat — may put a set on the wall unasked. */
  inCatalogue: boolean;
  isEvaluator: boolean;
  canViewDirectory: boolean;
  pendingCount: number;
  /** Space Bookings waiting on a block-out decision (staff only). */
  bookingActions: number;
  /** ?tab= on the URL — the practice notifications link straight to PRACTICE. */
  initialTab?: TabKey;
}

export default function PrayerRoomClient({
  userId,
  userName,
  isStaff,
  isMember,
  inCatalogue,
  isEvaluator,
  canViewDirectory,
  pendingCount,
  bookingActions,
  initialTab,
}: Props) {
  const [tab, setTab] = useState<TabKey>(initialTab ?? "week");

  const showPeople = isMember || isStaff || canViewDirectory;
  const showEvaluators = isEvaluator || isStaff;

  const tabs: TabDef[] = [
    { key: "week", label: "Week" },
    { key: "day", label: "Day" },
    // Everyone sees the practice wall — names are on it for everyone. Who can
    // BOOK is the database's call (migration 224).
    { key: "practice", label: "Practice" },
    ...(showPeople ? [{ key: "people" as const, label: "People" }] : []),
    // The yellow mark is 12a's tell that this tab is not everyone's.
    ...(showEvaluators ? [{ key: "evaluators" as const, label: "Evaluators", mark: true }] : []),
    ...(isMember ? [{ key: "mine" as const, label: "My sets" }] : []),
    // Always present. A member who now plays drums needs the same form a new
    // person needs — there is no other way to be evaluated for a new seat.
    { key: "join" as const, label: "Join the room" },
    ...(isStaff
      ? [{ key: "manage" as const, label: bookingActions > 0 ? `Manage · ${bookingActions}` : "Manage", mark: bookingActions > 0 }]
      : []),
  ];

  const shared = { tabs, active: tab, onChange: setTab };

  return (
    <div className="ffsa-screen">
      {(tab === "week" || tab === "day") && (
        <ScheduleView
          userId={userId}
          isStaff={isStaff}
          isMember={isMember}
          inCatalogue={inCatalogue}
          tabs={tabs}
          active={tab}
          onTabChange={setTab}
        />
      )}

      {tab === "practice" && <PracticeView userId={userId} tabs={tabs} active={tab} onTabChange={setTab} />}

      {tab === "people" && showPeople && (
        <People {...shared} isEvaluator={isEvaluator} isStaff={isStaff} myName={userName} />
      )}

      {tab === "evaluators" && showEvaluators && <EvaluatorsPortal {...shared} userId={userId} myName={userName} />}

      {tab === "mine" && isMember && (
        <>
          <PrayerRoomChrome context="Your seats and the sets you lead" {...shared} />
          <div className="px-5 py-6 md:px-8 md:py-7">
            <MySets userId={userId} isStaff={isStaff} />
          </div>
        </>
      )}

      {tab === "join" && (
        <>
          <PrayerRoomChrome
            context={isMember ? "Ask to be evaluated for another seat" : "Join the prayer room team"}
            {...shared}
          />
          <div className="px-5 py-6 md:px-8 md:py-7">
            <ApplyForm isMember={isMember} />
          </div>
        </>
      )}

      {tab === "manage" && isStaff && (
        <>
          <PrayerRoomChrome
            context={`Applications, members and block-outs · ${pendingCount} waiting${
              bookingActions > 0 ? ` · ${bookingActions} room booking${bookingActions === 1 ? "" : "s"} to block out` : ""
            }`}
            {...shared}
          />
          <div className="px-5 py-6 md:px-8 md:py-7">
            <AdminPanel bookingActions={bookingActions} />
          </div>
        </>
      )}
    </div>
  );
}
