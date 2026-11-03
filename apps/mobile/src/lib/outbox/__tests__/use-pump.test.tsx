import { act, render } from "@testing-library/react-native";
import { AppState, Text } from "react-native";

import { isOnlineState, useOutboxPump, type Pumpable } from "../use-pump";

type NetListener = (s: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void;
const mockNet: { listener: NetListener | null } = { listener: null };
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: (fn: NetListener) => {
      mockNet.listener = fn;
      return () => {
        mockNet.listener = null;
      };
    },
  },
}));

function fake(next: number | null = null): { [K in keyof Pumpable]: jest.Mock } {
  return {
    init: jest.fn(async () => {}),
    process: jest.fn(async () => {}),
    wake: jest.fn(async () => {}),
    nextWake: jest.fn(async () => next),
  };
}

function Probe({ outbox, items }: { outbox: Pumpable; items: unknown }) {
  const online = useOutboxPump(outbox, items);
  return <Text>{online ? "online" : "offline"}</Text>;
}

const net = (isConnected: boolean | null, isInternetReachable: boolean | null = isConnected) =>
  act(() => mockNet.listener?.({ isConnected, isInternetReachable }));

describe("useOutboxPump", () => {
  it("unknown connectivity counts as online", () => {
    expect(isOnlineState({ isConnected: null, isInternetReachable: null })).toBe(true);
    expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
  });

  it("sends on mount, and wakes only when connectivity comes back", async () => {
    const o = fake();
    const screen = await render(<Probe outbox={o} items={[]} />);
    await act(async () => {});
    expect(o.init).toHaveBeenCalled();
    expect(o.process).toHaveBeenCalled();

    await net(true);
    expect(o.wake).toHaveBeenCalledTimes(1);
    // Another "still online" report (wifi → mobile data) is not a reconnect.
    await net(true);
    expect(o.wake).toHaveBeenCalledTimes(1);
    await net(false);
    expect(screen.getByText("offline")).toBeTruthy();
    await net(true);
    expect(o.wake).toHaveBeenCalledTimes(2);
    screen.unmount();
  });

  it("arms one timer for the next retry and re-arms when the queue changes", async () => {
    jest.useFakeTimers();
    try {
      const o = fake(Date.now() + 10_000);
      const screen = await render(<Probe outbox={o} items={["a"]} />);
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          jest.advanceTimersByTime(0);
        });
      }
      expect(o.nextWake).toHaveBeenCalled();
      o.process.mockClear();
      await act(async () => {
        jest.advanceTimersByTime(9_000);
      });
      expect(o.process).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(1_100);
      });
      expect(o.process).toHaveBeenCalledTimes(1);
      await screen.rerender(<Probe outbox={o} items={["a", "b"]} />);
      await act(async () => {});
      expect(o.nextWake).toHaveBeenCalledTimes(2);
      screen.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
  // Last: spying on jest-expo's AppState mock leaves it unusable for later tests.
  it("wakes when the app comes back to the front", async () => {
    const o = fake();
    const spy = jest.spyOn(AppState, "addEventListener");
    const screen = await render(<Probe outbox={o} items={[]} />);
    const handlers = spy.mock.calls.filter((c) => c[0] === "change").map((c) => c[1] as (s: string) => void);
    expect(handlers.length).toBeGreaterThan(0);
    act(() => handlers.forEach((h) => h("background")));
    expect(o.wake).not.toHaveBeenCalled();
    act(() => handlers.forEach((h) => h("active")));
    expect(o.wake).toHaveBeenCalledTimes(1);
    screen.unmount();
    // Not mockRestore: jest-expo's AppState is itself a mock, and restoring wipes it.
    spy.mockClear();
  });

});
