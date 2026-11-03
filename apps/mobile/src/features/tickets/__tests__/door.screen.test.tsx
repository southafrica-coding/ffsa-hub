import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { Alert, Linking } from "react-native";

import { ApiError } from "@/lib/api";

import type { DoorClient } from "../api";
import { queueKey } from "../offline-queue";
import { DoorScreen } from "../screens/DoorScreen";

let mockNet = { isConnected: true, isInternetReachable: true };
let mockPermission: { granted: boolean; canAskAgain: boolean } | null = { granted: true, canAskAgain: true };
const mockRequestPermission = jest.fn();
const mockCamera: { props: { onBarcodeScanned?: (r: { data: string; type: string }) => void; enableTorch?: boolean } | null } = {
  props: null,
};

jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("expo-network", () => ({ useNetworkState: () => mockNet }));
jest.mock("expo-keep-awake", () => ({ useKeepAwake: jest.fn() }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
jest.mock("expo-camera", () => {
  // jest.mock factories run before imports, so require() is the only way in.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
    CameraView: (props: object) => {
      mockCamera.props = props;
      return <View testID="camera" />;
    },
  };
});
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } },
}));

function makeDoor(over: Partial<Record<keyof DoorClient, jest.Mock>> = {}) {
  return {
    stats: over.stats ?? jest.fn(async () => ({ checkedIn: 12, total: 40 })),
    search: over.search ?? jest.fn(async () => []),
    checkIn: over.checkIn ?? jest.fn(async () => ({ result: "ok", ticketId: "t1", ticketTypeName: "General", buyerName: "Sarah Mokoena" })),
    undo: over.undo ?? jest.fn(async () => undefined),
  } as unknown as DoorClient & Record<keyof DoorClient, jest.Mock>;
}

async function typeCode(code: string) {
  await fireEvent.changeText(screen.getByLabelText("Ticket code"), code);
  await fireEvent.press(screen.getByRole("button", { name: "Check in" }));
}

beforeEach(async () => {
  mockNet = { isConnected: true, isInternetReachable: true };
  mockPermission = { granted: true, canAskAgain: true };
  mockCamera.props = null;
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe("Door", () => {
  it("keeps the screen awake and shows the live tally", async () => {
    const door = makeDoor();
    await render(<DoorScreen eventId="e1" eventTitle="Send Night" door={door} />);
    expect(useKeepAwake).toHaveBeenCalled();
    expect(await screen.findByLabelText("12 of 40 checked in")).toBeTruthy();
    expect(screen.getByText("Send Night")).toBeTruthy();
  });

  it("checked in: big confirmation, haptic, Undo reverses it", async () => {
    const door = makeDoor();
    await render(<DoorScreen eventId="e1" door={door} />);
    await typeCode("AbCdEfGhIjK");
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Checked in");
    expect(screen.getByText("Sarah Mokoena · General")).toBeTruthy();
    expect(door.checkIn).toHaveBeenCalledWith("AbCdEfGhIjK");
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");

    await fireEvent.press(screen.getByRole("button", { name: "Undo" }));
    expect(door.undo).toHaveBeenCalledWith("t1");
    expect(await screen.findByText("Check-in undone")).toBeTruthy();
  });

  it("Undo is only offered for a few seconds", async () => {
    jest.useFakeTimers();
    try {
      await render(<DoorScreen eventId="e1" door={makeDoor()} />);
      await typeCode("AbCdEfGhIjK");
      expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("already checked in: says so with the time, no Undo", async () => {
    const door = makeDoor({
      checkIn: jest.fn(async () => ({ result: "already_checked_in", ticketTypeName: "General", checkedInAt: "2026-11-03T16:05:00.000Z" })),
    });
    await render(<DoorScreen eventId="e1" door={door} />);
    await typeCode("AbCdEfGhIjK");
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent(/^Already checked in at \d\d:\d\d$/);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("warning");
  });

  it("wrong event: a clear reject", async () => {
    const door = makeDoor({ checkIn: jest.fn(async () => ({ result: "wrong_event" })) });
    await render(<DoorScreen eventId="e1" door={door} />);
    await typeCode("AbCdEfGhIjK");
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Not a ticket for this event");
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("error");
  });

  it("a typed code that can't be a ticket never reaches the server", async () => {
    const door = makeDoor();
    await render(<DoorScreen eventId="e1" door={door} />);
    await typeCode("no!");
    expect(await screen.findByText("That QR code isn't an FFSA ticket.")).toBeTruthy();
    expect(door.checkIn).not.toHaveBeenCalled();
  });

  it("server error: needs attention, not queued", async () => {
    const door = makeDoor({ checkIn: jest.fn(async () => Promise.reject(new ApiError("http", "Something went wrong on the server (500). Try again.", 500))) });
    await render(<DoorScreen eventId="e1" door={door} />);
    await typeCode("AbCdEfGhIjK");
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Needs attention");
    expect(screen.queryByTestId("queue-banner")).toBeNull();
  });

  it("offline: saved, clearly NOT confirmed, and sent when back online", async () => {
    mockNet = { isConnected: false, isInternetReachable: false };
    const door = makeDoor();
    const view = await render(<DoorScreen eventId="e1" door={door} />);
    expect(screen.getByTestId("offline-banner")).toBeTruthy();

    await typeCode("AbCdEfGhIjK");
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Saved, not yet confirmed");
    // Only the tally's label says "Checked in"; no verdict claims it.
    expect(screen.getAllByText("Checked in")).toHaveLength(1);
    expect(screen.getByTestId("queue-banner")).toHaveTextContent(/1 scan not yet confirmed/);
    expect(door.checkIn).not.toHaveBeenCalled();
    await waitFor(async () => expect(await AsyncStorage.getItem(queueKey("u1"))).toContain("AbCdEfGhIjK"));

    mockNet = { isConnected: true, isInternetReachable: true };
    await view.rerender(<DoorScreen eventId="e1" door={door} />);
    await waitFor(() => expect(door.checkIn).toHaveBeenCalledWith("AbCdEfGhIjK"));
    await waitFor(() => expect(screen.queryByTestId("queue-banner")).toBeNull());
  });

  it("a connection drop mid-request queues the scan instead of losing it", async () => {
    const door = makeDoor({ checkIn: jest.fn(async () => Promise.reject(new ApiError("network", "offline"))) });
    await render(<DoorScreen eventId="e1" door={door} />);
    await typeCode("AbCdEfGhIjK");
    expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Saved, not yet confirmed");
  });

  it("a queued scan the server later rejects is flagged for the door", async () => {
    await AsyncStorage.setItem(
      queueKey("u1"),
      JSON.stringify([
        { id: "q1", eventId: "e1", code: "AbCdEfGhIjK", queuedAt: "2026-11-03T09:00:00Z", attempts: 0, state: "pending", outcome: null, lastError: null },
      ]),
    );
    const door = makeDoor({ checkIn: jest.fn(async () => ({ result: "void" })) });
    await render(<DoorScreen eventId="e1" door={door} />);
    expect(await screen.findByTestId("rejected-banner")).toHaveTextContent(/1 offline scan was turned down/);
    await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByTestId("rejected-banner")).toBeNull();
  });

  it("a saved scan the server refuses to take (403) needs the person: Retry, or Remove after a confirm", async () => {
    await AsyncStorage.setItem(
      queueKey("u1"),
      JSON.stringify({
        version: 2,
        items: [{ id: "q1", eventId: "e1", code: "AbCdEfGhIjK", queuedAt: "2026-11-03T09:00:00Z", attempts: 0, state: "pending", outcome: null, lastError: null }],
      }),
    );
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const door = makeDoor({ checkIn: jest.fn(async () => Promise.reject(new ApiError("forbidden", "You don't have access to this.", 403))) });
    await render(<DoorScreen eventId="e1" door={door} />);
    const banner = await screen.findByTestId("failed-banner");
    expect(banner).toHaveTextContent(/1 saved scan needs you/);
    expect(banner).toHaveTextContent(/AbCdEfGhIjK \(You don't have access to this\.\)/);
    expect(screen.queryByTestId("queue-banner")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Remove" }));
    expect(alert).toHaveBeenCalledWith("Remove these scans?", expect.any(String), expect.any(Array));
    expect(screen.getByTestId("failed-banner")).toBeTruthy();

    door.checkIn.mockResolvedValueOnce({ result: "ok", ticketId: "t1", ticketTypeName: "General", buyerName: "" });
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(door.checkIn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("queue-banner")).toBeNull());
    expect(screen.queryByTestId("failed-banner")).toBeNull();
    alert.mockClear();
  });

  it("a damaged saved queue is kept aside and the door says so", async () => {
    await AsyncStorage.setItem(queueKey("u1"), "{half");
    await render(<DoorScreen eventId="e1" door={makeDoor()} />);
    expect(await screen.findByTestId("outbox-store-problem")).toBeTruthy();
    const keys = await AsyncStorage.getAllKeys();
    const copy = keys.find((k) => k.startsWith(`${queueKey("u1")}:quarantine:`));
    expect(copy).toBeTruthy();
    expect(await AsyncStorage.getItem(copy!)).toBe("{half");
    await fireEvent.press(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByTestId("outbox-store-problem")).toBeNull();
  });

  it("name search: one tap checks the guest in", async () => {
    const door = makeDoor({
      search: jest.fn(async () => [
        { ticketId: "t9", code: "GuestCode9", name: "Sarah Mokoena", ticketTypeName: "General", status: "valid", checkedInAt: null },
        { ticketId: "t8", code: "GuestCode8", name: "Sarah Botha", ticketTypeName: "General", status: "checked_in", checkedInAt: "2026-11-03T16:00:00Z" },
      ]),
    });
    await render(<DoorScreen eventId="e1" door={door} />);
    await fireEvent.changeText(screen.getByLabelText("Guest name"), "sarah");
    await fireEvent.press(await screen.findByRole("button", { name: "Check in Sarah Mokoena" }, { timeout: 2000 }));
    expect(door.checkIn).toHaveBeenCalledWith("GuestCode9");
    expect(screen.getByLabelText(/^Sarah Botha\. General\. In at \d\d:\d\d$/)).toBeTruthy();
  });

  it("name search: empty result", async () => {
    await render(<DoorScreen eventId="e1" door={makeDoor()} />);
    await fireEvent.changeText(screen.getByLabelText("Guest name"), "zz");
    expect(await screen.findByText("No guests match that name.", undefined, { timeout: 2000 })).toBeTruthy();
  });

  it("permission denied by the server (403 on the tally)", async () => {
    const door = makeDoor({ stats: jest.fn(async () => Promise.reject(new ApiError("forbidden", "no", 403))) });
    await render(<DoorScreen eventId="e1" door={door} />);
    expect(await screen.findByText("You can't run check-in")).toBeTruthy();
  });

  describe("camera scanner", () => {
    it("scans a QR, shows the verdict over the camera, and ignores the same code again", async () => {
      const door = makeDoor();
      await render(<DoorScreen eventId="e1" door={door} />);
      await fireEvent.press(screen.getByRole("button", { name: "Scan tickets" }));
      expect(screen.getByTestId("camera")).toBeTruthy();

      await act(async () => {
        mockCamera.props!.onBarcodeScanned!({ data: "AbCdEfGhIjK", type: "qr" });
      });
      expect(await screen.findByTestId("verdict-title")).toHaveTextContent("Checked in");
      // Paused while the result is up.
      expect(mockCamera.props!.onBarcodeScanned).toBeUndefined();

      await fireEvent.press(screen.getByRole("button", { name: "Scan next" }));
      await act(async () => {
        mockCamera.props!.onBarcodeScanned!({ data: "AbCdEfGhIjK", type: "qr" });
      });
      expect(door.checkIn).toHaveBeenCalledTimes(1);
    });

    it("toggles the torch", async () => {
      await render(<DoorScreen eventId="e1" door={makeDoor()} />);
      await fireEvent.press(screen.getByRole("button", { name: "Scan tickets" }));
      expect(mockCamera.props!.enableTorch).toBe(false);
      await fireEvent.press(screen.getByRole("button", { name: "Turn torch on" }));
      expect(mockCamera.props!.enableTorch).toBe(true);
      expect(screen.getByRole("button", { name: "Turn torch off" })).toBeTruthy();
    });

    it("asks just in time, with a reason", async () => {
      mockPermission = { granted: false, canAskAgain: true };
      await render(<DoorScreen eventId="e1" door={makeDoor()} />);
      await fireEvent.press(screen.getByRole("button", { name: "Scan tickets" }));
      expect(screen.getByText("Use the camera to scan tickets")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Allow camera" }));
      expect(mockRequestPermission).toHaveBeenCalled();
    });

    it("denied camera: points to Settings and offers the no-camera ways", async () => {
      mockPermission = { granted: false, canAskAgain: false };
      const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
      await render(<DoorScreen eventId="e1" door={makeDoor()} />);
      await fireEvent.press(screen.getByRole("button", { name: "Scan tickets" }));
      expect(screen.getByText("Camera is off for FFSA Hub")).toBeTruthy();
      await fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));
      expect(openSettings).toHaveBeenCalled();
      await fireEvent.press(screen.getByRole("button", { name: "Type a code" }));
      expect(screen.getByLabelText("Ticket code")).toBeTruthy();
    });
  });
});
