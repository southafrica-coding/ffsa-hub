import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const restrictedImports = ["error", {
  patterns: [
    {
      group: ["@/lib/*/internal", "@/lib/*/internal/**", "**/internal", "**/internal/**"],
      allowTypeImports: true,
      message: "Import department and service internals only from API routes, internal modules, or the viewer and access files that own them.",
    },
    {
      group: ["@/lib/supabase/admin", "@/lib/supabase/admin/**", "**/supabase/admin", "**/supabase/admin/**"],
      allowTypeImports: true,
      message: "createAdminClient is the service-role client. Import it only from an allowlisted server module.",
    },
    {
      group: ["@/lib/departments/internal/open", "@/lib/departments/internal/open/**", "**/internal/open", "**/internal/open/**"],
      allowTypeImports: true,
      message: "openDepartment returns the service-role client. Call it only from an API route.",
    },
  ],
}];

// Existing value importers of the service-role client, plus the viewer and
// access modules. API routes, internal directories, and tests are allowed
// by the globs below. Parentheses and brackets are escaped because ESLint
// treats files entries as globs.
const adminImportAllowlist = [
  "src/app/\\(admin\\)/bookings/vehicles/\\[id\\]/collect/page.tsx",
  "src/app/\\(admin\\)/bookings/vehicles/\\[id\\]/page.tsx",
  "src/app/\\(admin\\)/bookings/vehicles/\\[id\\]/return/page.tsx",
  "src/app/\\(admin\\)/consents/page.tsx",
  "src/app/\\(admin\\)/contacts/\\[id\\]/page.tsx",
  "src/app/\\(admin\\)/contacts/duplicates/page.tsx",
  "src/app/\\(admin\\)/contacts/event-followup/page.tsx",
  "src/app/\\(admin\\)/dashboard/page.tsx",
  "src/app/\\(admin\\)/finance/outreach/\\[teamId\\]/page.tsx",
  "src/app/\\(admin\\)/finance/outreach/groups/page.tsx",
  "src/app/\\(admin\\)/finance/outreach/page.tsx",
  "src/app/\\(admin\\)/finance/school-fees/\\[programId\\]/match-xero/page.tsx",
  "src/app/\\(admin\\)/finance/school-fees/\\[programId\\]/students/\\[enrollmentId\\]/page.tsx",
  "src/app/\\(admin\\)/finance/school-fees/\\[programId\\]/students/page.tsx",
  "src/app/\\(admin\\)/finance/school-fees/email-templates/page.tsx",
  "src/app/\\(admin\\)/ministry/\\[id\\]/page.tsx",
  "src/app/\\(admin\\)/ministry/\\(index\\)/page.tsx",
  "src/app/\\(admin\\)/ministry/staff/\\[userId\\]/page.tsx",
  "src/app/\\(admin\\)/org-chart/import/page.tsx",
  "src/app/\\(admin\\)/org-chart/page.tsx",
  "src/app/\\(admin\\)/prayer-room/\\(index\\)/page.tsx",
  "src/app/\\(admin\\)/roles/page.tsx",
  "src/app/\\(admin\\)/schools/\\[programId\\]/page.tsx",
  "src/app/\\(admin\\)/settings/page.tsx",
  "src/app/\\(admin\\)/settings/slack/page.tsx",
  "src/app/\\(admin\\)/staff-decisions/page.tsx",
  "src/app/\\(admin\\)/users/\\[id\\]/household-panel.tsx",
  "src/app/\\(admin\\)/users/\\[id\\]/page.tsx",
  "src/app/\\(admin\\)/users/\\(index\\)/page.tsx",
  "src/app/\\(auth\\)/join/\\[code\\]/page.tsx",
  "src/app/\\(auth\\)/setup/\\[token\\]/page.tsx",
  "src/app/\\(portal\\)/profile/page.tsx",
  "src/app/\\(public\\)/apply/\\[programId\\]/page.tsx",
  "src/app/\\(public\\)/apply/status/\\[token\\]/page.tsx",
  "src/app/\\(public\\)/e/\\[slug\\]/opengraph-image.tsx",
  "src/app/\\(public\\)/e/\\[slug\\]/page.tsx",
  "src/app/\\(public\\)/e/\\[slug\\]/thanks/page.tsx",
  "src/app/\\(public\\)/f/\\[slug\\]/opengraph-image.tsx",
  "src/app/\\(public\\)/f/\\[slug\\]/page.tsx",
  "src/app/\\(public\\)/fb/\\[slug\\]/opengraph-image.tsx",
  "src/app/\\(public\\)/fb/\\[slug\\]/page.tsx",
  "src/app/\\(public\\)/legal/consent/page.tsx",
  "src/app/\\(public\\)/preferences/page.tsx",
  "src/app/\\(public\\)/reference/\\[token\\]/page.tsx",
  "src/app/\\(public\\)/scan/\\[token\\]/page.tsx",
  "src/app/\\(public\\)/schedule/\\[token\\]/page.tsx",
  "src/app/\\(public\\)/subscribe/\\[slug\\]/page.tsx",
  "src/app/\\(public\\)/t/\\[tag\\]/page.tsx",
  "src/app/\\(public\\)/track-intent/\\[token\\]/page.tsx",
  "src/app/\\(public\\)/vr/\\[token\\]/page.tsx",
  "src/app/print/agreements/\\[recordId\\]/page.tsx",
  "src/components/finance/school-fees-panel.tsx",
  "src/components/profile-records.tsx",
  "src/lib/account-deletion/notify.ts",
  "src/lib/auth/account-state.ts",
  "src/lib/auth/event-access.ts",
  "src/lib/auth/send-setup-link.ts",
  "src/lib/cached-reads.ts",
  "src/lib/departments/access.ts",
  "src/lib/departments/viewer.ts",
  "src/lib/email/send-reference-invite.ts",
  "src/lib/email/send-reference-reminder.ts",
  "src/lib/email/send-transactional.ts",
  "src/lib/email/send-vehicle-request.ts",
  "src/lib/evangelism/http.ts",
  "src/lib/finance/donor-statements-server.ts",
  "src/lib/google/calendar.ts",
  "src/lib/outreach/cash-alerts.ts",
  "src/lib/prayer-room/booking-alerts.ts",
  "src/lib/push/notify.ts",
  "src/lib/push/send.ts",
  "src/lib/rate-limit.ts",
  "src/lib/schools/lms-storage.ts",
  "src/lib/services/access.ts",
  "src/lib/slack/assistant/run.ts",
  "src/lib/slack/assistant/tools.ts",
  "src/lib/slack/broadcast.ts",
  "src/lib/slack/daily-ticket-report.ts",
  "src/lib/slack/notify.ts",
  "src/lib/slack/outreach/receipts.ts",
  "src/lib/slack/routing.ts",
  "src/lib/ticketing/fulfillment.ts",
  "src/lib/ticketing/refund-email.ts",
  "src/lib/users/account-flags.ts",
  "src/lib/users/auth-signins.ts",
  "src/lib/users/security-events.ts",
  "src/lib/vehicles/driver-doc-route.ts",
  "src/lib/vehicles/requester-notify.ts",
  "src/lib/vehicles/slack-alerts.ts",
  "src/lib/workflows/enroll-on-label.ts",
  "src/services/household-link.ts",
  "src/services/insurance-alerts.ts",
  "src/services/notifications.ts",
  "src/services/okrs.ts",
  "src/services/order-refunds.ts",
  "src/services/schools.ts",
  "src/services/vehicle-decisions.ts",
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-imports": restrictedImports,
    },
  },
  {
    files: [
      "src/app/api/**",
      "src/lib/departments/internal/**",
      "src/lib/services/internal/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      ...adminImportAllowlist,
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "src/types/database.ts", "apps/**"],
  },
];

export default eslintConfig;
