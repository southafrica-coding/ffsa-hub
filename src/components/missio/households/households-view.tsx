"use client";

import { useState } from "react";
import type { Household } from "@/lib/missio/households";
import { houseTitle } from "../house-churches/format";
import { useMissioLoad } from "../house-churches/load";
import { HouseStatus } from "../house-churches/status";
import { PersonCardDialog } from "../person-card";
import shell from "../shell.module.css";
import profile from "../person-profile.module.css";
import { householdsClient, type HouseholdsClient } from "./client";
import { initialsOf } from "./household-card";
import styles from "./households.module.css";

/** "2 adults · 2 kids · House 5". */
export function householdLine(household: Household): string {
  const adults = household.adults.length;
  const kids = household.children.length;
  const parts = [`${adults} ${adults === 1 ? "adult" : "adults"}`];
  if (kids > 0) parts.push(`${kids} ${kids === 1 ? "kid" : "kids"}`);
  const houses = [...new Map(household.adults.flatMap((adult) => adult.houses).map((house) => [house.id, house])).values()];
  parts.push(houses.length > 0 ? houses.map((house) => houseTitle(house)).join(", ") : "not in a house yet");
  return parts.join(" · ");
}

/** Board M14a, People → Households. Opens the main contact's card. */
export function HouseholdsView({ client = householdsClient, filter = "" }: { client?: HouseholdsClient; filter?: string }) {
  const { state, retry } = useMissioLoad(() => client.list(), [client]);
  const [open, setOpen] = useState<{ personId: string; name: string } | null>(null);
  const needle = filter.trim().toLowerCase();
  const rows =
    state.phase === "ready"
      ? state.data.filter(
          (household) =>
            !needle ||
            household.title.toLowerCase().includes(needle) ||
            household.adults.some((adult) => adult.name.toLowerCase().includes(needle)) ||
            household.children.some((child) => child.firstName.toLowerCase().includes(needle))
        )
      : [];

  return (
    <div data-testid="households-view">
      {state.phase === "loading" ? <p className={shell.state}>Loading households…</p> : null}
      {state.phase === "error" ? <HouseStatus error={state.error} fallback="Households didn’t load." onRetry={retry} /> : null}
      {state.phase === "ready" && state.data.length === 0 ? (
        <p className={profile.quiet}>No households yet. Open someone’s profile and add their spouse or children.</p>
      ) : null}
      {state.phase === "ready" && state.data.length > 0 && rows.length === 0 ? <p className={profile.quiet}>No household matches.</p> : null}
      <ul className={styles.list}>
        {rows.map((household) => {
          const main = household.adults.find((adult) => adult.main) ?? household.adults[0];
          const faces = [
            ...household.adults.map((adult) => ({ key: adult.memberId, name: adult.name, child: false })),
            ...household.children.map((child) => ({ key: child.memberId, name: `${child.firstName} ${child.lastName ?? ""}`, child: true })),
          ].slice(0, 4);
          return (
            <li key={household.id}>
              <button
                type="button"
                className={styles.family}
                disabled={!main?.personId}
                onClick={() => main?.personId && setOpen({ personId: main.personId, name: main.name })}
              >
                <span className={styles.stack} aria-hidden="true">
                  {faces.map((face) => (
                    <span key={face.key} className={`${styles.avatar} ${face.child ? styles.avatarChild : ""}`}>
                      {initialsOf(face.name)}
                    </span>
                  ))}
                </span>
                <span className={styles.who}>
                  <b>{household.title}</b>
                  <span className={profile.rowMeta}>{householdLine(household)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {open ? <PersonCardDialog personId={open.personId} name={open.name} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
