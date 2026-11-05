// The vehicle-check queue's failure UI: one state per item in words, a
// count, Retry / Remove (Remove asks first, neither shown mid-send) and the
// notice when the saved list couldn't be read.

import { fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";

import { outboxStrings } from "@/lib/outbox/strings";

import { QueueList } from "../components/QueueList";
import type { BookingsOutbox } from "../outbox/runner";
import { newPhotoItems, type PhotoItem } from "../outbox/state";
import { strings } from "../strings";
import { fakeOutbox } from "../__fixtures__/screen-mocks";

const META = { userId: "u1", bookingId: "b1", bookingName: "Airport run", inspectionKind: "collection" as const };
const photo = (over: Partial<PhotoItem> = {}): PhotoItem => ({
  ...newPhotoItems(META, "damage_photo", [{ localUri: "file:///p.jpg", fileName: "p.jpg", mimeType: "image/jpeg" }], 1, () => "p1")[0],
  ...over,
});

const asOutbox = (f: ReturnType<typeof fakeOutbox>) => f as unknown as BookingsOutbox;

describe("QueueList", () => {
  it("empty: renders nothing", async () => {
    await render(<QueueList items={[]} outbox={asOutbox(fakeOutbox())} online />);
    expect(screen.queryByTestId("bookings-queue")).toBeNull();
  });

  it("offline: waiting for signal, with a count", async () => {
    await render(<QueueList items={[photo()]} outbox={asOutbox(fakeOutbox())} online={false} />);
    expect(screen.getByText(outboxStrings.state.offline)).toBeTruthy();
    expect(screen.getByText("1 waiting")).toBeTruthy();
  });

  it("sending: says so and offers neither Retry nor Remove", async () => {
    await render(<QueueList items={[photo({ status: "sending" })]} outbox={asOutbox(fakeOutbox())} online />);
    expect(screen.getByText(outboxStrings.state.sending)).toBeTruthy();
    expect(screen.queryByText(strings.queue.retry)).toBeNull();
    expect(screen.queryByText(strings.queue.remove)).toBeNull();
  });

  it("needs you: reason + next step + last tried; Retry retries", async () => {
    const outbox = fakeOutbox();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const tried = new Date();
    tried.setHours(9, 5, 0, 0);
    await render(<QueueList items={[photo({ status: "failed", lastError: "No access.", lastTriedAt: tried.getTime() })]} outbox={asOutbox(outbox)} online />);
    expect(screen.getByText(outboxStrings.state.needsYou)).toBeTruthy();
    expect(screen.getByText(`No access. ${outboxStrings.next.needsYou}`)).toBeTruthy();
    expect(screen.getByText("Last tried 09:05")).toBeTruthy();
    expect(screen.getByText("1 needs you")).toBeTruthy();

    fireEvent.press(screen.getByText(strings.queue.retry));
    expect(outbox.retry).toHaveBeenCalledWith("p1");
    alert.mockClear();
  });

  it("Remove asks first", async () => {
    const outbox = fakeOutbox();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<QueueList items={[photo({ status: "failed", lastError: "No access." })]} outbox={asOutbox(outbox)} online />);
    fireEvent.press(screen.getByText(strings.queue.remove));
    expect(outbox.discard).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(strings.queue.removeTitle, strings.queue.removeBody, expect.any(Array));
    alert.mockClear();
  });

  it("the saved list couldn't be read: the notice shows even with nothing left to list", async () => {
    const outbox = fakeOutbox();
    outbox.getProblem = () => "corrupt";
    await render(<QueueList items={[]} outbox={asOutbox(outbox)} online />);
    expect(await screen.findByText(outboxStrings.problem.corrupt)).toBeTruthy();
    fireEvent.press(screen.getByText(outboxStrings.problem.dismiss));
    expect(outbox.dismissProblem).toHaveBeenCalled();
  });
});
