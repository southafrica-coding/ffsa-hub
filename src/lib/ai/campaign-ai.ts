// AI-assisted polish + layout for campaign emails. Uses Anthropic Claude
// via the Messages API. The polish endpoint preserves meaning and
// approximate length; suggestLayout uses tool-use to force a valid
// CampaignBody structure.

import Anthropic from "@anthropic-ai/sdk";
import {
  type CampaignBlock,
  type CampaignBody,
  newBlockId,
} from "@/lib/campaigns/blocks";

const MODEL = "claude-sonnet-4-5-20250929";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    client = new Anthropic({ apiKey });
  }
  return client;
}

// ────────────────────────────────────────────────────────────
// Polish copy
// ────────────────────────────────────────────────────────────

const POLISH_SYSTEM_PROMPT = `You are a senior editorial copywriter for Fire & Fragrance South Africa, a Christian ministry running training schools, outreach campaigns, and donor-development programs.

You polish email copy to feel editorial: warm but confident, specific not generic, hospitable not pushy. Think Substack newsletters, charity:water annual reports, NYT magazine.

CRITICAL RULES:
- Preserve the meaning of every sentence — don't add new claims, don't drop facts.
- Preserve approximate length (within ~20%). Don't expand placeholder copy into something fictional.
- Preserve all <strong>, <em>, and <a> tags exactly. Don't add or remove them.
- Preserve <p> structure (paragraph breaks).
- Return ONLY the polished HTML inside the same paragraph structure. No preamble, no commentary, no markdown fences.
- If the input is empty or pure placeholder text (e.g. "Write your message..."), return it unchanged.`;

export async function polishBlockText(input: {
  html: string;
  context?: string; // optional surrounding context (subject, eyebrow, etc.)
}): Promise<{ polished: string }> {
  const trimmed = (input.html ?? "").trim();
  if (!trimmed) return { polished: input.html };

  const contextLine = input.context
    ? `\nFor context, the surrounding email is about: ${input.context}\n`
    : "";

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: POLISH_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${contextLine}Polish this HTML, returning only the new HTML:\n\n${trimmed}`,
      },
    ],
  });

  const textBlock = res.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { polished: input.html };
  }
  // Strip any stray markdown fences just in case.
  const polished = textBlock.text
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return { polished: polished || input.html };
}

// ────────────────────────────────────────────────────────────
// Suggest layout
// ────────────────────────────────────────────────────────────

const SUGGEST_SYSTEM_PROMPT = `You are a senior email designer for Fire & Fragrance South Africa, an editorial-style nonprofit. You compose marketing emails using a fixed set of block types and produce magazine-quality layouts.

Available block types:
- eyebrow: small uppercase label. Field: text.
- heading: confident headline. Fields: text. Optional: eyebrow (small label above).
- text: paragraph(s) of body copy. Field: text (HTML — use <p>...</p> for each paragraph, <strong>/<em>/<a> as needed). Optional: dropCap (boolean, first-letter accent — use sparingly, only on the first paragraph of a long-form story).
- quote: pull-quote. Field: text. Optional: attribution.
- divider: section break. Optional: style ("rule" | "dots" | "space"). Default "rule".
- spacer: vertical rhythm only. Optional: size ("sm" | "md" | "lg" | "xl"). Default "md".
- image: in-line photo. Fields: url (use "" if no image yet), alt. Optional: caption, fullBleed.
- image-text: side-by-side photo + copy. Fields: url, alt, text. Optional: heading, layout ("image-left" | "image-right"). Default layout "image-left".
- cta: feature card on brand color. Fields: heading, text, buttonText, buttonUrl.
- button: standalone link. Fields: text, url. Optional: style ("filled" | "outline" | "link"). Default "filled".

YOUR JOB: take the current campaign content and rewrite it as a more compelling editorial layout. You may:
- Add eyebrows to introduce sections
- Pull the strongest sentence out as a quote block
- Break a long paragraph into shorter beats
- Add image placeholders where visuals would help (use url: "")
- Convert a closing link into a CTA card if the action is important
- Add spacers and dividers for editorial rhythm

DO NOT:
- Invent new facts or change the meaning of any sentence
- Fabricate quotes that weren't in the source — if no quote exists, only create a quote block by pulling EXACTLY a sentence from the source
- Add more than 1-2 image placeholders unless the source already had images
- Make the email more than ~50% longer than the source

Use the submit_layout tool to return your proposed block list.`;

type ToolBlock = {
  type: string;
  text?: string;
  eyebrow?: string;
  heading?: string;
  attribution?: string;
  url?: string;
  alt?: string;
  caption?: string;
  buttonText?: string;
  buttonUrl?: string;
  style?: string;
  size?: string;
  layout?: string;
  dropCap?: boolean;
  fullBleed?: boolean;
};

function blockSummary(block: CampaignBlock): string {
  switch (block.type) {
    case "eyebrow":
      return `[eyebrow] ${block.text}`;
    case "heading":
      return block.eyebrow
        ? `[heading, eyebrow="${block.eyebrow}"] ${block.text}`
        : `[heading] ${block.text}`;
    case "text":
      return `[text${block.dropCap ? ", dropCap" : ""}] ${block.text}`;
    case "button":
      return `[button${block.style ? `, style=${block.style}` : ""}] ${block.text} → ${block.url}`;
    case "image":
      return `[image${block.fullBleed ? ", fullBleed" : ""}] alt="${block.alt}"${block.caption ? `, caption="${block.caption}"` : ""}, url="${block.url}"`;
    case "divider":
      return `[divider${block.style ? `, style=${block.style}` : ""}]`;
    case "quote":
      return `[quote${block.attribution ? `, attribution="${block.attribution}"` : ""}] ${block.text}`;
    case "spacer":
      return `[spacer${block.size ? `, size=${block.size}` : ""}]`;
    case "image-text":
      return `[image-text${block.layout ? `, layout=${block.layout}` : ""}] heading="${block.heading ?? ""}", text="${block.text}"`;
    case "cta":
      return `[cta] heading="${block.heading}", text="${block.text}", button="${block.buttonText}" → ${block.buttonUrl}`;
    case "columns":
      return `[columns] ${block.cells.length} cells`;
    case "social":
      return `[social] ${block.links?.length ?? "brand"} links`;
    case "section":
      return `[section ${block.layout}] ${block.columns.length} columns`;
    default:
      return "[block]";
  }
}

function validateBlock(raw: ToolBlock): CampaignBlock | null {
  const id = newBlockId();
  switch (raw.type) {
    case "eyebrow":
      if (typeof raw.text !== "string") return null;
      return { id, type: "eyebrow", text: raw.text };
    case "heading":
      if (typeof raw.text !== "string") return null;
      return {
        id,
        type: "heading",
        text: raw.text,
        eyebrow: typeof raw.eyebrow === "string" ? raw.eyebrow : undefined,
      };
    case "text":
      if (typeof raw.text !== "string") return null;
      return {
        id,
        type: "text",
        text: raw.text,
        dropCap: raw.dropCap === true ? true : undefined,
      };
    case "button":
      if (typeof raw.text !== "string" || typeof raw.url !== "string") return null;
      return {
        id,
        type: "button",
        text: raw.text,
        url: raw.url,
        style:
          raw.style === "outline" || raw.style === "link"
            ? raw.style
            : "filled",
      };
    case "image":
      if (typeof raw.url !== "string" || typeof raw.alt !== "string") return null;
      return {
        id,
        type: "image",
        url: raw.url,
        alt: raw.alt,
        caption: typeof raw.caption === "string" ? raw.caption : undefined,
        fullBleed: raw.fullBleed === true ? true : undefined,
      };
    case "divider":
      return {
        id,
        type: "divider",
        style:
          raw.style === "dots" || raw.style === "space" ? raw.style : "rule",
      };
    case "quote":
      if (typeof raw.text !== "string") return null;
      return {
        id,
        type: "quote",
        text: raw.text,
        attribution:
          typeof raw.attribution === "string" ? raw.attribution : undefined,
      };
    case "spacer":
      return {
        id,
        type: "spacer",
        size:
          raw.size === "sm" || raw.size === "lg" || raw.size === "xl"
            ? raw.size
            : "md",
      };
    case "image-text":
      if (typeof raw.url !== "string" || typeof raw.text !== "string") return null;
      return {
        id,
        type: "image-text",
        url: raw.url,
        alt: typeof raw.alt === "string" ? raw.alt : "",
        heading: typeof raw.heading === "string" ? raw.heading : undefined,
        text: raw.text,
        layout: raw.layout === "image-right" ? "image-right" : "image-left",
      };
    case "cta":
      if (
        typeof raw.heading !== "string" ||
        typeof raw.text !== "string" ||
        typeof raw.buttonText !== "string" ||
        typeof raw.buttonUrl !== "string"
      ) {
        return null;
      }
      return {
        id,
        type: "cta",
        heading: raw.heading,
        text: raw.text,
        buttonText: raw.buttonText,
        buttonUrl: raw.buttonUrl,
      };
    default:
      return null;
  }
}

export async function suggestLayout(input: {
  body: CampaignBody;
  subject?: string;
}): Promise<{ body: CampaignBody; warnings: string[] }> {
  const warnings: string[] = [];
  const currentSummary = input.body.blocks.map(blockSummary).join("\n");
  const subject = input.subject?.trim() || "(no subject)";

  const userPrompt = `Current campaign:
Subject: ${subject}

Current blocks:
${currentSummary}

Rewrite this as a stronger editorial layout using the submit_layout tool.`;

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SUGGEST_SYSTEM_PROMPT,
    tools: [
      {
        name: "submit_layout",
        description: "Submit the proposed editorial block list",
        input_schema: {
          type: "object" as const,
          properties: {
            blocks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: [
                      "eyebrow",
                      "heading",
                      "text",
                      "quote",
                      "divider",
                      "spacer",
                      "image",
                      "image-text",
                      "cta",
                      "button",
                    ],
                  },
                  text: { type: "string" },
                  eyebrow: { type: "string" },
                  heading: { type: "string" },
                  attribution: { type: "string" },
                  url: { type: "string" },
                  alt: { type: "string" },
                  caption: { type: "string" },
                  buttonText: { type: "string" },
                  buttonUrl: { type: "string" },
                  style: { type: "string" },
                  size: { type: "string" },
                  layout: { type: "string" },
                  dropCap: { type: "boolean" },
                  fullBleed: { type: "boolean" },
                },
                required: ["type"],
              },
            },
          },
          required: ["blocks"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_layout" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = res.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not produce a layout");
  }
  const toolInput = toolUse.input as { blocks?: ToolBlock[] };
  if (!toolInput || !Array.isArray(toolInput.blocks)) {
    throw new Error("Model returned an invalid layout shape");
  }

  const blocks: CampaignBlock[] = [];
  for (const raw of toolInput.blocks) {
    const valid = validateBlock(raw);
    if (valid) {
      blocks.push(valid);
    } else {
      warnings.push(`Skipped invalid ${raw.type ?? "unknown"} block`);
    }
  }

  if (blocks.length === 0) {
    throw new Error("Model returned no valid blocks");
  }

  return {
    body: { version: 1, blocks },
    warnings,
  };
}
