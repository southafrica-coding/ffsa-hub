import type { Rock } from "@/lib/departments/ui-contract";
import { addIsoDays } from "@/lib/departments/quarter";

/** Open rocks in the given departments, overdue or due within `withinDays`. */
export function selectRocksDue(
  rocks: Rock[],
  departmentSlugs: Set<string>,
  today: string,
  withinDays = 14
): Rock[] {
  const horizon = addIsoDays(today, withinDays);
  return rocks
    .flatMap((rock) => {
      if (
        !departmentSlugs.has(rock.departmentSlug) ||
        rock.status === "done" ||
        rock.dueOn == null ||
        rock.dueOn > horizon
      ) {
        return [];
      }
      return [{ ...rock, dueOn: rock.dueOn }];
    })
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title));
}
