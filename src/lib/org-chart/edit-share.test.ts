import { describe, expect, it, afterEach } from "vitest";
import { DIRECTORY_HOME, directoryOpenTeam } from "./phone";
import {
  applyCanvasEdit,
  applyDirectoryEdit,
  publishOrgEdit,
  resetOrgEditShare,
  subscribeOrgEdit,
} from "./edit-share";

afterEach(() => resetOrgEditShare());

describe("applyDirectoryEdit", () => {
  it("opens the same team the desktop canvas is editing", () => {
    const next = applyDirectoryEdit(DIRECTORY_HOME, { edit: true, teamId: "media" });
    expect(next).toMatchObject({ screen: "team", id: "media", edit: true });
  });

  it("keeps the list in edit mode when no team is open", () => {
    const onTeam = applyDirectoryEdit(directoryOpenTeam(DIRECTORY_HOME, "media"), { edit: true, teamId: null });
    expect(onTeam).toMatchObject({ screen: "home", edit: true, id: "" });
  });

  it("leaves a team detail in place when editing stops", () => {
    const editing = applyDirectoryEdit(DIRECTORY_HOME, { edit: true, teamId: "media" });
    const done = applyDirectoryEdit(editing, { edit: false, teamId: null });
    expect(done).toMatchObject({ screen: "team", id: "media", edit: false });
  });
});

describe("applyCanvasEdit", () => {
  it("selects the team the phone directory is editing", () => {
    expect(applyCanvasEdit({ edit: false, sel: null }, { edit: true, teamId: "media" })).toEqual({
      edit: true,
      sel: "team:media",
    });
  });

  it("turns editing off without forgetting the selection", () => {
    expect(applyCanvasEdit({ edit: true, sel: "team:media" }, { edit: false, teamId: null })).toEqual({
      edit: false,
      sel: "team:media",
    });
  });
});

describe("publishOrgEdit", () => {
  it("tells a subscriber that joined late what is open now", () => {
    publishOrgEdit({ edit: true, teamId: "media" });
    const seen: string[] = [];
    subscribeOrgEdit((share) => seen.push(share.teamId ?? "none"));
    publishOrgEdit({ edit: true, teamId: "media" });
    expect(seen).toEqual(["media"]);
  });
});