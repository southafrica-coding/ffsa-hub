// Small pure pieces: the photo size planner, the viewer's URL guard, the
// camera-permission decision and the offline-copy timestamp.

jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-image-manipulator", () => ({ ImageManipulator: {}, SaveFormat: { JPEG: "jpeg" } }));
jest.mock("expo-file-system", () => ({ File: class {}, Directory: class {}, Paths: { document: { uri: "file:///docs/" } } }));

import { formatSavedAt } from "../cache";
import { permissionStep } from "../capture";
import { RECEIPT_JPEG_QUALITY, RECEIPT_MAX_EDGE, planReceiptResize, plannedSize, safeFileName } from "../image-plan";
import { isAllowedReceiptUri } from "../viewer-uri";

describe("planReceiptResize", () => {
  it("shrinks a 12 MP landscape photo to 1600px wide", () => {
    expect(planReceiptResize(4032, 3024)).toEqual({ resize: { width: RECEIPT_MAX_EDGE }, compress: RECEIPT_JPEG_QUALITY });
    expect(plannedSize(4032, 3024)).toEqual({ width: 1600, height: 1200 });
  });

  it("fixes the long edge of a portrait photo", () => {
    expect(planReceiptResize(3024, 4032)).toEqual({ resize: { height: 1600 }, compress: 0.7 });
    expect(plannedSize(3000, 8000)).toEqual({ width: 600, height: 1600 });
  });

  it("never upscales a small image, but still re-encodes it", () => {
    expect(planReceiptResize(800, 1200)).toEqual({ resize: null, compress: 0.7 });
    expect(planReceiptResize(1600, 1600)).toEqual({ resize: null, compress: 0.7 });
  });

  it("doesn't guess when the picker reports no size", () => {
    expect(planReceiptResize(0, 0).resize).toBeNull();
    expect(planReceiptResize(Number.NaN, 4000).resize).toBeNull();
  });

  it("aims at roughly a 1600px long edge, JPEG 0.7", () => {
    expect(RECEIPT_MAX_EDGE).toBe(1600);
    expect(RECEIPT_JPEG_QUALITY).toBe(0.7);
  });
});

describe("safeFileName", () => {
  it("keeps names storage-safe and always .jpg", () => {
    expect(safeFileName("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(safeFileName("receipt.jpeg")).toBe("receipt.jpeg");
    expect(safeFileName("../../etc/pass wd.png")).toBe("pass_wd.jpg");
    expect(safeFileName("Shoprite slip (1).jpg")).toBe("Shoprite_slip_1_.jpg");
    expect(safeFileName(null)).toBe("receipt.jpg");
    expect(safeFileName(".hidden")).toBe("receipt.jpg");
  });
});

describe("isAllowedReceiptUri", () => {
  const opts = { supabaseUrl: "https://test-project.supabase.co", documentDir: "file:///data/app/files/" };

  it("allows a signed receipt URL on this project", () => {
    expect(isAllowedReceiptUri("https://test-project.supabase.co/storage/v1/object/sign/outreach-receipts/t/e/1_a.jpg?token=x", opts)).toBe(true);
  });

  it("allows a photo in the app's own files", () => {
    expect(isAllowedReceiptUri("file:///data/app/files/finance-outbox/abc.jpg", opts)).toBe(true);
  });

  it.each([
    undefined,
    "https://evil.example/storage/v1/object/sign/outreach-receipts/x.jpg",
    "http://test-project.supabase.co/storage/v1/object/sign/outreach-receipts/x.jpg",
    "https://test-project.supabase.co/storage/v1/object/sign/avatars/x.jpg",
    "file:///etc/hosts",
    "file:///data/app/files/../../secret.jpg",
    "javascript:alert(1)",
  ])("refuses %p", (uri) => expect(isAllowedReceiptUri(uri, opts)).toBe(false));
});

describe("permissionStep (camera, just in time)", () => {
  it("launches when granted, asks (after the rationale) when it can, else points to Settings", () => {
    expect(permissionStep({ granted: true, canAskAgain: true })).toBe("launch");
    expect(permissionStep({ granted: false, canAskAgain: true })).toBe("ask");
    expect(permissionStep({ granted: false, canAskAgain: false })).toBe("settings");
  });
});

describe("formatSavedAt", () => {
  it("shows the time today, the date otherwise", () => {
    const now = new Date(2026, 10, 3, 15, 0).getTime();
    expect(formatSavedAt(new Date(2026, 10, 3, 9, 5).getTime(), now)).toBe("09:05");
    expect(formatSavedAt(new Date(2026, 10, 1, 18, 30).getTime(), now)).toBe("2026-11-01 18:30");
  });
});
