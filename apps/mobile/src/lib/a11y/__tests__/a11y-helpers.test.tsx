import { render, renderHook, act, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Platform, Pressable, Text, View } from "react-native";

import { announce, announcement } from "../announce";
import { AA, contrastRatio, formatRatio, luminance, meetsAA } from "../contrast";
import { useReduceMotion, useScreenReader } from "../settings";
import { effectiveTarget, hitSlopFor, minTarget } from "../target";
import { auditTappables } from "../testing";

describe("contrast", () => {
  it("matches the WCAG reference values", () => {
    expect(luminance("#FFFFFF")).toBeCloseTo(1);
    expect(luminance("#000000")).toBe(0);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });

  it("checks AA for text, large text and UI parts", () => {
    expect(AA).toEqual({ text: 4.5, large: 3, ui: 3 });
    expect(meetsAA("#767676", "#FFFFFF")).toBe(true);
    expect(meetsAA("#777777", "#FFFFFF")).toBe(false);
    expect(meetsAA("#949494", "#FFFFFF", "ui")).toBe(true);
  });

  it("formats ratios without rounding a fail up to a pass", () => {
    expect(formatRatio(4.499)).toBe("4.49:1");
    expect(formatRatio(21)).toBe("21.00:1");
  });

  it("rejects anything that isn't #RRGGBB", () => {
    expect(() => luminance("red")).toThrow(/#RRGGBB/);
  });
});

describe("announce", () => {
  const plain = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  const queued = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
  afterEach(() => {
    plain.mockClear();
    queued.mockClear();
  });

  it("queues behind VoiceOver on iOS", () => {
    Platform.OS = "ios";
    announce("Receipt saved");
    expect(queued).toHaveBeenCalledWith("Receipt saved", { queue: true });
    expect(plain).not.toHaveBeenCalled();
  });

  it("uses the plain announcement on Android", () => {
    Platform.OS = "android";
    announce("  Checked in  ");
    expect(plain).toHaveBeenCalledWith("Checked in");
    Platform.OS = "ios";
  });

  it("says nothing for an empty message", () => {
    announce("");
    announce(null);
    announce("   ");
    expect(plain).not.toHaveBeenCalled();
    expect(queued).not.toHaveBeenCalled();
  });

  it("joins the parts that exist into sentences", () => {
    expect(announcement("Checked in.", undefined, "Jo Smith", false, "")).toBe("Checked in. Jo Smith");
  });
});

describe("settings hooks", () => {
  it("reads reduce motion and follows changes", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    let emit: (v: boolean) => void = () => {};
    const remove = jest.fn();
    const add = jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((_e: string, h: (v: boolean) => void) => {
      emit = h;
      return { remove };
    }) as never);
    const { result, unmount } = await renderHook(() => useReduceMotion());
    expect(result.current).toBe(true);
    await act(async () => emit(false));
    expect(result.current).toBe(false);
    await unmount();
    expect(remove).toHaveBeenCalled();
    add.mockRestore();
  });

  it("reads the screen reader state", async () => {
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
    const { result } = await renderHook(() => useScreenReader());
    expect(result.current).toBe(true);
  });
});

describe("touch targets", () => {
  it("pads a small control out to 48dp", () => {
    expect(hitSlopFor(24)).toEqual({ top: 12, bottom: 12, left: 12, right: 12 });
    expect(hitSlopFor(40, 48)).toEqual({ top: 0, bottom: 0, left: 4, right: 4 });
    expect(hitSlopFor(60)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(effectiveTarget(24, hitSlopFor(24), "x")).toBe(48);
    expect(effectiveTarget(40, 4, "y")).toBe(48);
    expect(effectiveTarget(40, undefined, "y")).toBe(40);
    expect(minTarget).toEqual({ minHeight: 48, minWidth: 48 });
  });
});

describe("auditTappables", () => {
  it("passes labelled buttons and buttons with text", async () => {
    await render(
      <View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => {}} />
        <Pressable accessibilityRole="button" onPress={() => {}}>
          <Text>Save</Text>
        </Pressable>
      </View>,
    );
    expect(auditTappables(screen.container as never)).toEqual([]);
  });

  it("flags an icon-only pressable with no label, and one with no role", async () => {
    await render(
      <View>
        <Pressable testID="icon" accessibilityRole="button" onPress={() => {}}>
          <View />
        </Pressable>
        <Pressable testID="norole" onPress={() => {}}>
          <Text>Open</Text>
        </Pressable>
      </View>,
    );
    expect(auditTappables(screen.container as never)).toEqual([
      expect.objectContaining({ testID: "icon", problem: "no label or text" }),
      expect.objectContaining({ testID: "norole", problem: "no role" }),
    ]);
  });
});
