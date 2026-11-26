// ============================================================
// Test-only: a local stand-in for Supabase Storage's HTTP API.
// ============================================================
// Speaks just enough of /storage/v1 for the Store's PDF flow, so tests
// drive the REAL @supabase/supabase-js storage client over HTTP:
//
//   POST /object/upload/sign/:bucket/:path   createSignedUploadUrl
//   PUT  /object/upload/sign/:bucket/:path   uploadToSignedUrl (raw or multipart)
//   POST /object/:bucket/:path               upload (service role)
//   GET  /object/:bucket/:path               download
//   GET  /object/info/:bucket/:path          info
//   POST /object/sign/:bucket/:path          createSignedUrl
//   GET  /object/sign/:bucket/:path?token=   fetch a signed URL
//
// Objects live in a folder on disk (pass one under tmp/, never the repo).
// Each bucket can carry a size limit, like storage.buckets.file_size_limit.
// No auth beyond the signed tokens: it's for local tests only.
// ============================================================

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";

export type LocalStorage = {
  url: string; // base for createClient(url, key): http://127.0.0.1:<port>
  root: string;
  file: (bucket: string, key: string) => string;
  close: () => Promise<void>;
};

export async function startLocalStorage(root: string, limits: Record<string, number> = {}): Promise<LocalStorage> {
  mkdirSync(root, { recursive: true });
  const uploadTokens = new Map<string, string>(); // token → bucket/key (single use)
  const readTokens = new Map<string, string>();
  const file = (bucket: string, key: string) => {
    const p = path.resolve(root, bucket, key);
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error("path escapes root");
    return p;
  };

  async function bodyOf(req: http.IncomingMessage): Promise<{ bytes: Buffer; type: string }> {
    const type = String(req.headers["content-type"] ?? "application/octet-stream");
    if (type.startsWith("multipart/form-data")) {
      const r = new Request("http://local/x", { method: "PUT", headers: { "content-type": type }, body: Readable.toWeb(req) as ReadableStream, duplex: "half" } as RequestInit);
      const form = await r.formData();
      for (const [, v] of form.entries()) {
        if (typeof v !== "string") return { bytes: Buffer.from(await v.arrayBuffer()), type: v.type || "application/octet-stream" };
      }
      return { bytes: Buffer.alloc(0), type };
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return { bytes: Buffer.concat(chunks), type };
  }

  const server = http.createServer(async (req, res) => {
    const send = (code: number, body: unknown, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type });
      res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://local");
      const m = url.pathname.match(/^\/storage\/v1\/object\/(upload\/sign\/|info\/|sign\/|authenticated\/)?([^/]+)\/(.+)$/);
      if (!m) return send(404, { statusCode: "404", error: "not_found", message: "Unknown route" });
      const [, kind = "", bucket, rawKey] = m;
      const key = decodeURIComponent(rawKey);
      const id = `${bucket}/${key}`;

      const store = async (bytes: Buffer) => {
        const limit = limits[bucket];
        if (limit && bytes.length > limit) return send(413, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" });
        mkdirSync(path.dirname(file(bucket, key)), { recursive: true });
        writeFileSync(file(bucket, key), bytes);
        return send(200, { Key: id, Id: randomUUID() });
      };

      if (kind === "upload/sign/" && req.method === "POST") {
        const token = randomUUID();
        uploadTokens.set(token, id);
        return send(200, { url: `/object/upload/sign/${bucket}/${rawKey}?token=${token}` });
      }
      if (kind === "upload/sign/" && req.method === "PUT") {
        const token = url.searchParams.get("token") ?? "";
        if (uploadTokens.get(token) !== id) return send(400, { statusCode: "403", error: "invalid_token", message: "Invalid signature" });
        uploadTokens.delete(token);
        return store((await bodyOf(req)).bytes);
      }
      if (kind === "" && req.method === "POST") return store((await bodyOf(req)).bytes);
      if (kind === "info/" && req.method === "GET") {
        try {
          const st = statSync(file(bucket, key));
          return send(200, { id: randomUUID(), name: key, bucket_id: bucket, size: st.size, content_type: "application/octet-stream" });
        } catch {
          return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
        }
      }
      if (kind === "sign/" && req.method === "POST") {
        try {
          statSync(file(bucket, key));
        } catch {
          return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
        }
        const token = randomUUID();
        readTokens.set(token, id);
        return send(200, { signedURL: `/object/sign/${bucket}/${rawKey}?token=${token}` });
      }
      if (kind === "sign/" && req.method === "GET") {
        if (readTokens.get(url.searchParams.get("token") ?? "") !== id) return send(400, { message: "Invalid signature" });
        return send(200, readFileSync(file(bucket, key)), "application/octet-stream");
      }
      if ((kind === "" || kind === "authenticated/") && req.method === "GET") {
        try {
          return send(200, readFileSync(file(bucket, key)), "application/octet-stream");
        } catch {
          return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
        }
      }
      return send(405, { message: "Not supported" });
    } catch (e) {
      return send(500, { message: e instanceof Error ? e.message : "error" });
    }
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    root,
    file,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
