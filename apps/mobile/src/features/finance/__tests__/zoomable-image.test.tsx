import { fireEvent, render, screen } from "@testing-library/react-native";

import { ZoomableImage, clampScale } from "../components/ZoomableImage";
import { strings } from "../strings";

// Reanimated's own Jest mock doesn't load under this SDK's worklets build, so
// these are minimal stand-ins: shared values are plain objects, gestures are
// inert. Real pinch/pan/double-tap needs a device (see the PR's manual checks).
const mockShared: { value: number }[] = [];
jest.mock("react-native-reanimated", () => {
  const { View } = jest.requireActual("react-native");
  // The rest of the shared stand-in (FadeIn and friends for the kit), with this test's shared values on top.
  return {
    ...jest.requireActual("../../../../test/reanimated-mock"),
    __esModule: true,
    default: { View },
    useSharedValue: (v: number) => {
      const s = { value: v };
      mockShared.push(s);
      return s;
    },
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => true,
    withTiming: (v: number) => v,
  };
});
jest.mock("react-native-gesture-handler", () => {
  const { View } = jest.requireActual("react-native");
  const gesture = () => ({});
  return {
    GestureHandlerRootView: View,
    GestureDetector: ({ children }: { children: unknown }) => children,
    usePinchGesture: gesture,
    usePanGesture: gesture,
    useTapGesture: gesture,
    useSimultaneousGestures: gesture,
  };
});

beforeEach(() => {
  mockShared.length = 0;
});

describe("ZoomableImage", () => {
  it("keeps zoom between 1x and 5x", () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(2.5)).toBe(2.5);
    expect(clampScale(12)).toBe(5);
  });

  it("renders the receipt with a label and a gesture hint", async () => {
    await render(<ZoomableImage uri="https://example.test/r.jpg" label="Receipt: a.jpg" />);
    const img = screen.getByLabelText("Receipt: a.jpg");
    expect(img.props.accessibilityHint).toBe(strings.viewer.hint);
  });

  it("zoom buttons work for anyone who can't pinch, within the limits", async () => {
    await render(<ZoomableImage uri="https://example.test/r.jpg" label="Receipt" />);
    const scale = () => mockShared[0].value;
    await fireEvent.press(screen.getByRole("button", { name: strings.viewer.zoomIn }));
    expect(scale()).toBe(1.5);
    for (let i = 0; i < 6; i++) await fireEvent.press(screen.getByRole("button", { name: strings.viewer.zoomIn }));
    expect(scale()).toBe(5);
    for (let i = 0; i < 8; i++) await fireEvent.press(screen.getByRole("button", { name: strings.viewer.zoomOut }));
    expect(scale()).toBe(1);
  });

  it("says so if the image can't load", async () => {
    await render(<ZoomableImage uri="https://example.test/broken.jpg" label="Receipt" />);
    await fireEvent(screen.getByTestId("receipt-image"), "error");
    expect(screen.getByText(strings.viewer.loadFailed)).toBeTruthy();
  });
});
