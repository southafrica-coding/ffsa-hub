import { describe, expect, it } from "vitest";
import { fetchGraderCandidates } from "./grader-candidates";

type Row = Record<string, unknown>;

function client(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const chain = {
        select() {
          return chain;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return chain;
        },
        in(column: string, values: unknown[]) {
          filters.push([column, values]);
          return chain;
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
          let rows = tables[table] ?? [];
          for (const [column, value] of filters) {
            rows = rows.filter((row) =>
              Array.isArray(value) ? (value as unknown[]).includes(row[column]) : row[column] === value
            );
          }
          return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

const PROGRAM = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("fetchGraderCandidates", () => {
  it("returns staff attached to this school and leaves students and other schools out", async () => {
    const { data, error } = await fetchGraderCandidates(
      client({
        program_leaders: [{ user_id: "staff-1", program_id: PROGRAM }],
        user_roles: [
          { user_id: "staff-1", scope_type: null, scope_id: null, roles: { name: "staff" } },
          { user_id: "student-1", scope_type: "program", scope_id: PROGRAM, roles: { name: "student" } },
          { user_id: "tutor-1", scope_type: null, scope_id: null, roles: { name: "staff" } },
          { user_id: "other-school", scope_type: "program", scope_id: OTHER, roles: { name: "staff" } },
        ],
        user_permissions: [
          { user_id: "student-1", scope_type: "program", scope_id: PROGRAM },
          { user_id: "tutor-1", scope_type: "program", scope_id: PROGRAM },
        ],
        users: [
          { id: "staff-1", first_name: "Ada", last_name: "Lovelace", preferred_name: null, is_active: true },
          { id: "student-1", first_name: "Stu", last_name: "Dent", preferred_name: null, is_active: true },
          { id: "tutor-1", first_name: "Grace", last_name: "Hopper", preferred_name: "Amazing", is_active: true, email: "grace@example.com" },
          { id: "other-school", first_name: "Out", last_name: "Side", preferred_name: null, is_active: true },
        ],
      }),
      PROGRAM
    );
    expect(error).toBeNull();
    expect(data.map((person) => person.id)).toEqual(["staff-1", "tutor-1"]);
    expect(data[1]).toEqual({
      id: "tutor-1",
      first_name: "Grace",
      last_name: "Hopper",
      preferred_name: "Amazing",
    });
    expect(data[1]).not.toHaveProperty("email");
  });
});
