import { describe, it, expect } from "vitest";
import {
  buildApplicationUploadPath,
  isAcceptableUploadContentType,
  isValidApplicationUploadPath,
} from "@/lib/upload-paths";

const UUID = "3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b";
const APP = "0a1b2c3d-1111-4222-8333-444455556666";
const Q = "7e8f9a0b-1111-4222-8333-444455556666";

describe("isValidApplicationUploadPath", () => {
  it.each([
    `applications/${APP}/${Q}/${UUID}-passport_photo.jpg`,
    `applications/draft/${Q}/${UUID}-IMG_0042.HEIC`,
    `applications/${APP}/photo_upload/${UUID}-.png`,
    `applications/${APP}/${Q}/${UUID}-x.webp`,
    `applications/${APP}/${Q}/${UUID}-x.avif`,
  ])("accepts what the form produces: %s", (path) => {
    expect(isValidApplicationUploadPath(path)).toBe(true);
  });

  it.each([
    ["traversal", `applications/../${Q}/${UUID}-a.jpg`],
    ["traversal in the name", `applications/${APP}/${Q}/${UUID}-..%2fa.jpg`],
    ["leading slash", `/applications/${APP}/${Q}/${UUID}-a.jpg`],
    ["another folder", `avatars/${APP}/${Q}/${UUID}-a.jpg`],
    ["too few segments", `applications/${APP}/${UUID}-a.jpg`],
    ["too many segments", `applications/${APP}/${Q}/extra/${UUID}-a.jpg`],
    ["no uuid (could target an existing file)", `applications/${APP}/${Q}/photo.jpg`],
    ["not an image", `applications/${APP}/${Q}/${UUID}-a.html`],
    ["svg", `applications/${APP}/${Q}/${UUID}-a.svg`],
    ["double extension", `applications/${APP}/${Q}/${UUID}-a.jpg.html`],
    ["spaces", `applications/${APP}/${Q}/${UUID}-my photo.jpg`],
    ["backslash", `applications/${APP}\\${Q}/${UUID}-a.jpg`],
    ["empty", ""],
    ["an over-long id", `applications/${"a".repeat(65)}/${Q}/${UUID}-a.jpg`],
    ["an over-long name", `applications/${APP}/${Q}/${UUID}-${"c".repeat(65)}.jpg`],
  ])("rejects %s", (_label, path) => {
    expect(isValidApplicationUploadPath(path)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidApplicationUploadPath(undefined)).toBe(false);
    expect(isValidApplicationUploadPath(42)).toBe(false);
    expect(isValidApplicationUploadPath({})).toBe(false);
  });
});

describe("isAcceptableUploadContentType", () => {
  it("allows image types and an empty type, refuses everything else (incl. SVG)", () => {
    expect(isAcceptableUploadContentType("image/jpeg")).toBe(true);
    expect(isAcceptableUploadContentType("IMAGE/HEIC")).toBe(true);
    expect(isAcceptableUploadContentType(undefined)).toBe(true);
    expect(isAcceptableUploadContentType("")).toBe(true);
    expect(isAcceptableUploadContentType("image/svg+xml")).toBe(false);
    expect(isAcceptableUploadContentType("text/html")).toBe(false);
    expect(isAcceptableUploadContentType(["image/png"])).toBe(false);
  });
});

describe("buildApplicationUploadPath", () => {
  const build = (fileName: string, contentType: string, applicationId = APP) =>
    buildApplicationUploadPath({ applicationId, questionId: Q, uuid: UUID, fileName, contentType });

  it("always produces a path the route accepts", () => {
    for (const [name, type] of [
      ["passport photo.JPG", "image/jpeg"],
      ["scan.jfif", "image/jpeg"],
      ["IMG_0042", "image/heic"],
      ["weird.name.with.dots.png", "image/png"],
      ["../../etc/passwd", "image/jpeg"],
      ["ünïcødé.webp", "image/webp"],
      ["photo.heic", ""],
      ["x".repeat(300) + ".gif", "image/gif"],
    ]) {
      const path = build(name, type);
      expect(isValidApplicationUploadPath(path), path).toBe(true);
    }
    expect(isValidApplicationUploadPath(build("a.jpg", "image/jpeg", "draft"))).toBe(true);
  });

  it("takes the extension from the image type, not the file name", () => {
    expect(build("scan.jfif", "image/jpeg")).toBe(`applications/${APP}/${Q}/${UUID}-scan.jpg`);
    expect(build("IMG_0042", "image/heic")).toBe(`applications/${APP}/${Q}/${UUID}-IMG_0042.heic`);
  });
});
