import { EMAIL_COLORS } from "../shell";
import { FFSA_TAGLINE } from "@/lib/brand/ffsa";

// Bespoke layout, shared tokens — the palette lives in EMAIL_COLORS so
// this template can never drift from the rest of the FFSA sends.
const C = EMAIL_COLORS;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function profileReminderEmailHtml({
  firstName,
  missingLabels,
  signInUrl,
}: {
  firstName?: string;
  missingLabels: string[];
  signInUrl: string;
}): string {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  const missingList = missingLabels.length
    ? `<ul style="margin:8px 0 24px 24px;padding:0;color:${C.TEXT_DIM};font-size:14px;line-height:1.7;">
        ${missingLabels.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}
      </ul>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Finish setting up your FFSA Hub profile</title>
</head>
<body style="margin:0;padding:0;background-color:${C.BG};font-family:'Roboto',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.BG};padding:48px 16px;">
    <tr>
      <td align="center">

        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:${C.CARD};border:1px solid ${C.BORDER};border-radius:14px;overflow:hidden;">

          <tr>
            <td style="height:3px;background:linear-gradient(90deg,transparent,${C.YELLOW},transparent);"></td>
          </tr>

          <tr>
            <td align="center" style="padding:40px 40px 32px;">
              <div style="font-size:28px;font-weight:900;letter-spacing:0.06em;color:${C.TEXT};font-family:Arial Black,Arial,sans-serif;line-height:1;">
                FIRE &amp; FRAGRANCE
              </div>
              <div style="margin-top:8px;display:flex;align-items:center;justify-content:center;gap:8px;">
                <span style="display:inline-block;width:20px;height:1px;background:${C.YELLOW};vertical-align:middle;"></span>
                <span style="font-size:9px;letter-spacing:0.3em;font-weight:700;color:${C.YELLOW};text-transform:uppercase;">HUB</span>
                <span style="display:inline-block;width:20px;height:1px;background:${C.YELLOW};vertical-align:middle;"></span>
              </div>
            </td>
          </tr>

          <tr>
            <td style="height:1px;background:${C.BORDER};"></td>
          </tr>

          <tr>
            <td style="padding:40px 40px 32px;">

              <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.25em;font-weight:700;color:${C.YELLOW};text-transform:uppercase;">
                Profile Incomplete
              </p>

              <h1 style="margin:0 0 20px;font-size:28px;font-weight:900;letter-spacing:0.03em;color:${C.TEXT};font-family:Arial Black,Arial,sans-serif;line-height:1.15;">
                Finish your<br/>profile
              </h1>

              <p style="margin:0 0 12px;font-size:15px;color:${C.TEXT_DIM};line-height:1.65;">
                ${greeting}
              </p>

              <p style="margin:0 0 12px;font-size:15px;color:${C.TEXT_DIM};line-height:1.65;">
                We noticed your <strong style="color:${C.TEXT};">FFSA Hub</strong> profile is missing a few details. Once those are filled in you'll have full access to the hub.
              </p>

              ${missingLabels.length ? `<p style="margin:16px 0 4px;font-size:14px;color:${C.TEXT};">Still needed:</p>${missingList}` : ""}

              <p style="margin:0 0 32px;font-size:15px;color:${C.TEXT_DIM};line-height:1.65;">
                Click below to sign in and complete your profile — it should only take a minute.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center" style="background:${C.YELLOW};border-radius:8px;box-shadow:0 4px 18px rgba(245,197,24,0.25);">
                    <a href="${signInUrl}"
                       style="display:inline-block;padding:14px 36px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${C.BG};text-decoration:none;font-family:Arial,sans-serif;">
                      Complete My Profile
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 4px;font-size:12px;color:${C.TEXT_DIMMER};line-height:1.6;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:11px;color:${C.TEXT_DIMMER};word-break:break-all;line-height:1.6;">
                <a href="${signInUrl}" style="color:${C.YELLOW};text-decoration:none;">${signInUrl}</a>
              </p>

            </td>
          </tr>

          <tr>
            <td style="height:1px;background:${C.BORDER};"></td>
          </tr>

          <tr>
            <td style="padding:24px 40px;" align="center">
              <p style="margin:0 0 4px;font-size:10px;letter-spacing:0.25em;color:${C.TEXT_FAINT};text-transform:uppercase;font-weight:700;">
                ${FFSA_TAGLINE}
              </p>
              <p style="margin:0;font-size:11px;color:${C.TEXT_FAINT};">
                Fire &amp; Fragrance South Africa &mdash; ffsahub.com
              </p>
            </td>
          </tr>

          <tr>
            <td style="height:2px;background:linear-gradient(90deg,transparent,${C.BORDER},transparent);"></td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}
