import { describe, expect, it } from "vitest";
import { cleanNote, isIsoDate, isUuid, ownStoragePath, rpcErrorResponse, sniffUploadType } from "./api";

describe("visa API helpers", () => {
  it("checks dates and ids", () => {
    expect(isIsoDate("2027-02-28")).toBe(true);
    expect(isIsoDate("2027-02-30")).toBe(false);
    expect(isIsoDate("27-02-28")).toBe(false);
    expect(isUuid("c0000000-0000-0000-0000-000000000001")).toBe(true);
    expect(isUuid("../../etc")).toBe(false);
  });

  it("maps database errors without leaking server detail", async () => {
    expect(rpcErrorResponse({ code: "42501" }).status).toBe(403);
    expect(rpcErrorResponse({ code: "P0002", message: "Document not found" }).status).toBe(404);
    const rule = rpcErrorResponse({ code: "P0001", message: "Still missing: passport" });
    expect(rule.status).toBe(409);
    expect(await rule.json()).toEqual({ error: "Still missing: passport" });
    const other = rpcErrorResponse({ code: "23505", message: "duplicate key value violates visa_cases_pkey" });
    expect(other.status).toBe(500);
    expect(await other.json()).toEqual({ error: "Something went wrong" });
  });

  it("cleans notes", () => {
    expect(cleanNote("  hi  ")).toBe("hi");
    expect(cleanNote("   ")).toBeNull();
    expect(cleanNote(5)).toBeNull();
    expect(cleanNote("x".repeat(5000))?.length).toBe(2000);
  });

  it("knows a file by its first bytes", () => {
    const b = (...x: number[]) => new Uint8Array(x);
    const t = (s: string) => new TextEncoder().encode(s);
    expect(sniffUploadType(t("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffUploadType(b(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffUploadType(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffUploadType(t("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffUploadType(t("\0\0\0\x18ftypheic"))).toBe("image/heic");
    expect(sniffUploadType(t("MZ\x90\0"))).toBeNull();
    expect(sniffUploadType(t("<html>"))).toBeNull();
    expect(sniffUploadType(b())).toBeNull();
  });

  it("only accepts a row's own file path", () => {
    const id = "d0000000-0000-0000-0000-000000000001";
    const case_id = "c0000000-0000-0000-0000-000000000001";
    expect(ownStoragePath({ id, case_id, storage_path: `${case_id}/${id}.pdf` })).toBe(`${case_id}/${id}.pdf`);
    expect(ownStoragePath({ id, case_id, storage_path: null })).toBeNull();
    expect(ownStoragePath({ id, case_id, storage_path: `c0000000-0000-0000-0000-000000000002/${id}.pdf` })).toBeNull();
    expect(ownStoragePath({ id, case_id, storage_path: `${case_id}/${id}.pdf/../x` })).toBeNull();
  });
});
