import { describe, expect, it } from "vitest";
import { departmentHasSongwriting } from "./has-songwriting";

function client(opts: { nations?: number | null; trainings?: number | null; error?: "nations" | "trainings" }) {
  const calls: string[] = [];
  const from = (table: string) => {
    calls.push(table);
    const count = table === "pw_nations" ? (opts.nations ?? 0) : (opts.trainings ?? 0);
    const failed = opts.error === "nations" && table === "pw_nations" || opts.error === "trainings" && table === "pw_songwriting_trainings";
    const q = {
      select: () => q,
      then: (resolve: (value: unknown) => void) =>
        resolve({ count, error: failed ? { message: "nope" } : null }),
    };
    return q;
  };
  return { from, calls };
}

describe("departmentHasSongwriting", () => {
  it("is true when Prayer & Worship has a nation or only trainings", async () => {
    const nations = client({ nations: 13 });
    expect(await departmentHasSongwriting(nations, "prayer_and_worship")).toBe(true);
    expect(nations.calls).toEqual(["pw_nations"]);
    const trainings = client({ nations: 0, trainings: 2 });
    expect(await departmentHasSongwriting(trainings, "prayer_and_worship")).toBe(true);
    expect(trainings.calls).toEqual(["pw_nations", "pw_songwriting_trainings"]);
  });

  it("is false for another department, empty data, a read error, or no client", async () => {
    expect(await departmentHasSongwriting(client({ nations: 13 }), "operations")).toBe(false);
    expect(await departmentHasSongwriting(client({ nations: 0, trainings: 0 }), "prayer_and_worship")).toBe(false);
    expect(await departmentHasSongwriting(client({ nations: 3, error: "nations" }), "prayer_and_worship")).toBe(false);
    expect(await departmentHasSongwriting({ kind: "session" }, "prayer_and_worship")).toBe(false);
  });
});
