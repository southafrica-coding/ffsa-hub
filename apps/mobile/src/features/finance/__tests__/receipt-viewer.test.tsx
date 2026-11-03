import { fireEvent, render, screen } from "@testing-library/react-native";

import ReceiptViewerScreen from "../screens/ReceiptViewerScreen";
import { strings } from "../strings";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock("expo-file-system", () => ({ Paths: { document: { uri: "file:///docs/" } } }));
jest.mock("../components/ZoomableImage", () => {
  const { Image } = jest.requireActual("react-native");
  return { ZoomableImage: ({ uri, label }: { uri: string; label: string }) => <Image testID="zoomable" source={{ uri }} accessibilityLabel={label} /> };
});

const SIGNED = "https://test-project.supabase.co/storage/v1/object/sign/outreach-receipts/t/e/1_a.jpg?token=abc";

beforeEach(() => mockBack.mockReset());

describe("Receipt viewer", () => {
  it("shows a signed receipt from this project, labelled for screen readers", async () => {
    await render(<ReceiptViewerScreen uri={SIGNED} title="a.jpg" />);
    expect(screen.getByTestId("zoomable").props.source).toEqual({ uri: SIGNED });
    expect(screen.getByLabelText(`${strings.viewer.title}: a.jpg`)).toBeTruthy();
  });

  it("shows a photo still waiting on this phone", async () => {
    await render(<ReceiptViewerScreen uri="file:///docs/finance-outbox/p.jpg" />);
    expect(screen.getByTestId("zoomable")).toBeTruthy();
  });

  it("refuses an image from anywhere else (e.g. a crafted link)", async () => {
    await render(<ReceiptViewerScreen uri="https://evil.example/x.jpg" title="x" />);
    expect(screen.queryByTestId("zoomable")).toBeNull();
    expect(screen.getByText(strings.viewer.loadFailed)).toBeTruthy();
  });

  it("closes", async () => {
    await render(<ReceiptViewerScreen uri={SIGNED} />);
    await fireEvent.press(screen.getByRole("button", { name: strings.common.close }));
    expect(mockBack).toHaveBeenCalled();
  });
});
