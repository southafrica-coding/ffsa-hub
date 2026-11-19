// ListGroupItem: rows a FlatList renders, drawn so together they look like a
// ListGroup (border, 8pt corners on the ends, hairline between), light and dark.

import { render, screen } from "@testing-library/react-native";
import { FlatList, StyleSheet, Text } from "react-native";

import { colors, radius } from "@/theme/tokens";

import { ListGroupItem } from "..";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});

const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;
const style = (id: string) => flat(screen.getByTestId(id).props.style);

describe("ListGroupItem", () => {
  it.each(["light", "dark"] as const)("first, middle and last rows (%s)", async (scheme) => {
    mockScheme = scheme;
    const c = colors[scheme];
    await render(
      <FlatList
        data={["a", "b", "c"]}
        keyExtractor={(k) => k}
        renderItem={({ item, index }) => (
          <ListGroupItem index={index} count={3} testID={`row-${item}`}>
            <Text>{item}</Text>
          </ListGroupItem>
        )}
      />,
    );
    expect(style("row-a")).toMatchObject({
      borderTopWidth: 1,
      borderBottomWidth: 0,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderTopLeftRadius: radius.card,
      borderBottomLeftRadius: 0,
      borderColor: c.rule,
      backgroundColor: c.raised,
    });
    expect(style("row-b")).toMatchObject({ borderTopWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 0, borderBottomRightRadius: 0 });
    expect(style("row-c")).toMatchObject({ borderBottomWidth: 1, borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card });
    // A hairline above every row but the first, hidden from screen readers.
    const rules = screen.getAllByTestId("list-group-item-rule", { includeHiddenElements: true });
    expect(rules).toHaveLength(2);
    expect(flat(rules[0].props.style)).toMatchObject({ height: 1, backgroundColor: c.rule });
    expect(rules[0].props.accessibilityElementsHidden).toBe(true);
  });

  it("a single row is rounded top and bottom", async () => {
    mockScheme = "light";
    await render(
      <ListGroupItem index={0} count={1} testID="only">
        <Text>Only</Text>
      </ListGroupItem>,
    );
    expect(style("only")).toMatchObject({ borderTopWidth: 1, borderBottomWidth: 1, borderTopLeftRadius: radius.card, borderBottomRightRadius: radius.card });
    expect(screen.queryByTestId("list-group-item-rule", { includeHiddenElements: true })).toBeNull();
  });
});
