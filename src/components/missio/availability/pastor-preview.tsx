"use client";

import { MissioApiError, type MissioClient } from "@/components/missio/api";
import { missioBody, missioDisplay } from "@/components/missio/fonts";
import { MissioFrame } from "@/components/missio/shell";
import type { MissioMe } from "@/components/missio/types-shim";
import { pastorGridFixture } from "@/lib/missio/availability/fixtures";
import { VolunteersBoard } from "./volunteers-board";

const pastor: MissioMe = {
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: ["pastor"] },
  currentOrg: "missio",
};

function previewClient(): MissioClient {
  return {
    getMe: async () => pastor,
    listPeople: async () => ({ rows: [], total: 0 }),
    searchContacts: async () => ({ matches: [] }),
    createPerson: async () => {
      throw new MissioApiError(500, "unused", null, "server_error");
    },
    updatePerson: async () => {},
  };
}

export function PastorAvailabilityPreview({ longName = false }: { longName?: boolean }) {
  return (
    <div className={`${missioBody.variable} ${missioDisplay.variable} ${missioBody.className}`}>
      <MissioFrame client={previewClient()} loadFfsaRoles={async () => []}>
        <VolunteersBoard initial={pastorGridFixture(longName)} live={false} />
      </MissioFrame>
    </div>
  );
}
