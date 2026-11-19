import { Platform } from "react-native";

import { keyboardBehavior } from "../KeyboardAvoidingView";

// SDK 58 draws Android edge to edge, so the window no longer shrinks for the
// keyboard: a KeyboardAvoidingView needs a behaviour on Android as well, or
// the keyboard covers the form. Jest has no keyboard, so this pins the choice.
// (Lint makes every screen use the kit's KeyboardAvoidingView.)
describe("kit KeyboardAvoidingView", () => {
  afterEach(() => jest.restoreAllMocks());

  it("pads on iOS", () => {
    jest.replaceProperty(Platform, "OS", "ios");
    expect(keyboardBehavior()).toBe("padding");
  });

  it("shrinks on Android, never leaving the keyboard over the form", () => {
    jest.replaceProperty(Platform, "OS", "android");
    expect(keyboardBehavior()).toBe("height");
  });
});
