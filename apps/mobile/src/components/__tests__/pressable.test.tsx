import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";

import { Pressable } from "../Pressable";

// NativeWind drops a function `style` on RN's Pressable on device; the kit
// Pressable must always hand RN a plain style object.
describe("kit Pressable", () => {
  it("hands React Native a plain style object, resolved from { pressed }", async () => {
    await render(
      <Pressable testID="p" style={({ pressed }) => ({ flexDirection: "row", flex: 1, opacity: pressed ? 0.5 : 1 })}>
        <Text>Row</Text>
      </Pressable>,
    );
    const el = screen.getByTestId("p");
    expect(typeof el.props.style).not.toBe("function");
    expect(StyleSheet.flatten(el.props.style)).toMatchObject({ flexDirection: "row", flex: 1, opacity: 1 });
  });

  it("resolves the pressed look", async () => {
    await render(<Pressable testID="p" testOnly_pressed style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })} />);
    expect(StyleSheet.flatten(screen.getByTestId("p").props.style).opacity).toBe(0.5);
  });

  it("passes plain object styles through and still calls onPress", async () => {
    const onPress = jest.fn();
    await render(<Pressable testID="p" accessibilityRole="button" onPress={onPress} style={{ flexDirection: "row" }} />);
    expect(StyleSheet.flatten(screen.getByTestId("p").props.style)).toMatchObject({ flexDirection: "row" });
    fireEvent.press(screen.getByTestId("p"));
    expect(onPress).toHaveBeenCalled();
  });
});
