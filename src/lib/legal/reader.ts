// Legal → Documents — sending one scan to Claude. Server-only.
//
// Same approach as the Slack receipt reader (src/lib/slack/outreach/receipts.ts):
// Claude reads a COPY. The stored original is never re-encoded or changed.
// The caller must already have read the legal_files row AS THE USER
// (RLS) before passing its bytes here.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import sharp from "sharp";
import { ScanReadingSchema, type ScanReading } from "./reading";

const MODEL = "claude-opus-5-5";
/** Claude takes images up to 5 MB; leave room for base64. */
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
/** A request is capped at 32 MB; base64 adds a third. */
export const MAX_READABLE_PDF_BYTES = 22 * 1024 * 1024;

let client: Anthropic | null = null;
function claude(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ReadError("Reading scans isn't set up (ANTHROPIC_API_KEY is missing).");
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** A failure with a message fit to show the person who pressed Read. */
export class ReadError extends Error {}

type Block = Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam;

async function readableCopy(bytes: Buffer, mime: string): Promise<Block> {
  if (mime === "application/pdf") {
    if (bytes.length > MAX_READABLE_PDF_BYTES) {
      throw new ReadError("This PDF is too large to read in one go (over 22 MB). Scan it in smaller parts.");
    }
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } };
  }
  if ((mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") && bytes.length <= MAX_IMAGE_BYTES) {
    return { type: "image", source: { type: "base64", media_type: mime, data: bytes.toString("base64") } };
  }
  // Big photos are shrunk; other types converted. Scans need detail, so
  // keep the long side at 2400 px.
  try {
    const jpeg = await sharp(bytes)
      .rotate()
      .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } };
  } catch {
    throw new ReadError(
      mime === "image/heic"
        ? "iPhone HEIC photos can't be read here. Scan to PDF or JPG instead."
        : "This image couldn't be opened."
    );
  }
}

export async function readScan(bytes: Buffer, mime: string, prompt: string): Promise<ScanReading> {
  const block = await readableCopy(bytes, mime);
  let res;
  try {
    res = await claude().messages.parse({
      model: MODEL,
      // 16k keeps a non-streaming call inside the SDK's 10-minute limit;
      // the prompt caps the transcription at 8 pages to fit.
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(ScanReadingSchema) },
      messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new ReadError("Too many scans are being read right now. Try again in a minute.");
    if (e instanceof Anthropic.BadRequestError) throw new ReadError("This scan couldn't be sent for reading.");
    if (e instanceof Anthropic.APIError) throw new ReadError(`The reader is unavailable (${e.status ?? "network"}). Try again later.`);
    throw e;
  }
  if (res.stop_reason === "refusal") throw new ReadError("The reader declined this scan. Fill the details in by hand.");
  if (res.stop_reason === "max_tokens") throw new ReadError("This scan has too much text to read in one go. Scan it in smaller parts.");
  if (!res.parsed_output) throw new ReadError("The reader gave no answer. Try again.");
  return res.parsed_output;
}
