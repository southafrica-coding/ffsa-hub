// ============================================================
// Ticket Purchase Terms & Consent Agreement — shared source of truth
// ============================================================
// The agreement every ticket buyer must accept at checkout. It covers
// the order, payment, refunds, conduct, health, POPIA data processing,
// media release, liability, and — importantly — a dedicated section for
// tickets bought for anyone under 18 (guardian authority + consents).
//
// This is a versioned constant, not a DB row: ticket buyers are
// anonymous, so acceptance is recorded on the order itself (migration
// 157: orders.consent_version + consent_accepted_at) rather than in the
// account-scoped consent_agreements/consent_records tables (migration
// 034, which hold the single-current POPIA privacy doc for users).
//
// When the text changes materially, bump TICKET_CONSENT_VERSION so new
// orders record the new version while old orders keep the one they saw.
//
// Used by:
//   - /legal/ticket-terms          — renders TICKET_CONSENT_MARKDOWN
//   - every storefront checkout     — required acceptance checkbox
//   - /api/events/[id]/checkout     — enforces acceptance + records version
// ============================================================

// Bump on material change. Format: tickets-v<major>.<minor>-<YYYY-MM-DD>.
export const TICKET_CONSENT_VERSION = "tickets-v1.0-2026-08-04";

// Public route where the full agreement is shown (opened in a new tab
// from the checkbox on each storefront).
export const TICKET_CONSENT_URL = "/legal/ticket-terms";

// The short label rendered next to the required checkbox at checkout.
// Kept in one place so all storefronts read identically.
export const TICKET_CONSENT_CHECKBOX_LABEL =
  "I have read and agree to the Ticket Purchase Terms & Consent Agreement, including the media, health, data-protection (POPIA) and liability terms. Where I am buying for anyone under 18, I confirm I am their parent or legal guardian (or am authorised to act for them) and I accept these terms — including the medical and media consents — on their behalf.";

export const TICKET_CONSENT_TITLE =
  "Ticket Purchase Terms & Consent Agreement";

// Full agreement, rendered as markdown on /legal/ticket-terms.
export const TICKET_CONSENT_MARKDOWN = `# Ticket Purchase Terms & Consent Agreement

**Version:** tickets-v1.0 — 4 August 2026

By purchasing a ticket through FFSA Hub ("we", "us", "the Organiser") you ("you", "the Purchaser") agree to the following terms on behalf of yourself and every person for whom you buy a ticket ("Attendees"). If you are buying a ticket for a person under the age of 18 ("a Minor"), you additionally agree to the terms in **Section 10 (Minors)** and confirm you are that Minor's parent or legal guardian, or are authorised by them.

You must read and accept this agreement in full before your purchase can be completed. Ticking the acceptance box constitutes your electronic signature under the Electronic Communications and Transactions Act 25 of 2002.

## 1. The Ticket & Your Order

1.1 A ticket is a revocable licence to attend the specified event on the specified date, subject to these terms and any published event rules.

1.2 Tickets are valid only for the event, date, session and ticket tier shown at checkout. Your order confirmation and any QR code / ticket reference is your proof of purchase.

1.3 We may refuse admission or remove any Attendee who breaches these terms, the event code of conduct, or the lawful instructions of event staff, without refund.

1.4 You are responsible for keeping your ticket secure. We are not liable for lost, stolen, duplicated or screenshotted tickets, and admission may be refused where a ticket has already been scanned.

## 2. Payment

2.1 All prices are shown at checkout in the event's selling currency (ZAR unless otherwise stated) and include any applicable taxes and booking/service fees, which are non-refundable except where required by law.

2.2 Payment is processed by our third-party payment providers (e.g. PayFast, Stripe). We do not store your full card details. Your purchase is also subject to the payment provider's terms.

2.3 You confirm you are authorised to use the payment method presented and that all payment information is accurate.

## 3. Refunds, Cancellations & Changes

3.1 Except where stated otherwise for a specific event, or as required by the Consumer Protection Act 68 of 2008, tickets are non-refundable and non-exchangeable once purchased.

3.2 If **we** cancel or materially reschedule an event, you will be offered a refund of the ticket price (excluding non-refundable service fees where permitted) or, where available, a transfer to the rescheduled date. Refunds are made to the original payment method.

3.3 Refunds may take several business days to reflect depending on your payment provider and bank.

3.4 We may change the event programme, line-up, venue, timing or capacity for operational, safety or circumstances beyond our reasonable control; such changes are not automatically grounds for a refund.

3.5 Ticket resale for commercial gain or above face value is prohibited and may void the ticket.

## 4. Attendance, Safety & Conduct

4.1 Attendees must comply with all venue rules, safety instructions, and applicable laws.

4.2 We may conduct security checks and refuse entry to prohibited items or to any person who appears intoxicated, unwell in a way that poses a risk, or a danger to themselves or others.

4.3 Attendees participate in all activities voluntarily and at their own risk (see Section 8).

4.4 Disruptive, abusive, discriminatory, threatening or unlawful behaviour may result in removal without refund and, where appropriate, reporting to authorities.

## 5. Health & Medical

5.1 You confirm that each Attendee is medically fit to participate in the activities offered at the event.

5.2 You must disclose at checkout (or to event staff before the event) any medical condition, allergy, disability, dietary requirement or medication need relevant to safe participation.

5.3 You consent, in the event of a medical emergency and where you or a Minor's guardian cannot first be reached, to the Organiser arranging emergency first aid, ambulance transport and necessary emergency medical treatment for the Attendee. You accept responsibility for the resulting medical costs, save to the extent covered by insurance.

5.4 We are not medical providers and do not provide health insurance. Attendees are responsible for their own medical cover.

## 6. Data Protection & Privacy (POPIA)

6.1 We process the personal information you provide (including name, contact details, and any custom questions answered at checkout) to fulfil your order, administer the event, communicate with you, and comply with legal obligations. This is done in accordance with the Protection of Personal Information Act 4 of 2013 (POPIA).

6.2 Where you provide personal information about another Attendee (including a Minor), you confirm you are authorised to share it with us for these purposes.

6.3 Special personal information (such as health/medical details) is processed only to keep Attendees safe and is limited to staff who need it.

6.4 We retain personal information only as long as necessary for these purposes or as required by law, and we apply reasonable security safeguards.

6.5 You have the right to access, correct, or request deletion of your personal information, and to object to processing, subject to legal limits. Contact us using the details in Section 12.

6.6 We do not sell your personal information. We share it only with service providers (e.g. payment, email, ticketing infrastructure) under confidentiality obligations, or where required by law.

6.7 **Marketing:** we will only send you marketing communications where you have opted in. You may withdraw consent at any time via the unsubscribe link or by contacting us.

## 7. Photography, Film & Media Release

7.1 Events may be photographed, filmed, streamed or recorded. By attending, each Attendee may appear in such recordings.

7.2 You grant us a non-exclusive, royalty-free, perpetual licence to use, reproduce and publish images, video and audio in which an Attendee appears, for the Organiser's promotional, marketing, reporting and archival purposes, across print, digital and social media.

7.3 No fee is payable for this use. If an Attendee does not wish to be featured, you must notify event staff on arrival, and we will take reasonable steps to accommodate the request, though we cannot guarantee removal from wide/crowd shots or live streams.

7.4 For Minors, this media consent is subject to Section 10.4.

## 8. Assumption of Risk, Liability & Indemnity

8.1 Attendance and participation are voluntary and carry inherent risks. Each Attendee (or their guardian) assumes those ordinary risks.

8.2 To the maximum extent permitted by law, and save for liability that cannot lawfully be excluded (including for death or personal injury caused by our gross negligence, or any liability under the Consumer Protection Act), we are not liable for any indirect, incidental or consequential loss, or for loss of or damage to personal property.

8.3 You indemnify us against claims, losses and costs arising from an Attendee's breach of these terms or their unlawful, reckless or negligent conduct at the event.

8.4 Nothing in this agreement limits your rights under the Consumer Protection Act 68 of 2008 or any other law that cannot be excluded by agreement.

## 9. Force Majeure

We are not liable for failure to hold or complete an event due to events beyond our reasonable control, including natural disasters, severe weather, fire, epidemic/pandemic, government action, load-shedding/power failure, strikes, or acts of terrorism. In such cases, Section 3.2 applies where an event is cancelled.

## 10. Minors (Attendees under 18)

This section applies to every ticket purchased for a person under the age of 18.

10.1 **Guardian authority.** By purchasing a ticket for a Minor, you confirm that you are the Minor's parent or legal guardian, or that you have the express permission of that parent/guardian, and that you are entitled to give the consents in this agreement on the Minor's behalf.

10.2 **Acceptance on behalf of the Minor.** You accept all the terms of this agreement (including health, data, media, risk and conduct terms) on behalf of the Minor.

10.3 **Supervision.** You confirm you understand the event's supervision arrangements. Unless the event is expressly stated to provide supervised care for the age group concerned, a Minor must be accompanied and supervised by a responsible adult, and you remain responsible for the Minor's conduct and welfare.

10.4 **Media consent for Minors.** You consent to the Minor appearing in event photography, film and recordings and to their use as described in Section 7. You may withhold this consent for the Minor by notifying us in writing before the event or informing event staff on arrival, and we will take reasonable steps to honour it.

10.5 **Medical consent for Minors.** You authorise the Organiser and its staff, where you cannot first be reached in an emergency, to arrange first aid and necessary emergency medical treatment for the Minor as described in Section 5.3, and you accept responsibility for the resulting costs save to the extent covered by insurance.

10.6 **Medical & special-needs disclosure.** You confirm you have disclosed any medical condition, allergy, medication, disability or special requirement relevant to the Minor's safe participation.

10.7 **Collection / release.** Where an event releases Minors only to authorised persons, you agree to comply with the event's sign-in/sign-out and collection procedures.

10.8 **Data of Minors.** We process a Minor's personal information under POPIA with the consent of their competent person (parent/guardian) as given here, solely for the purposes in Section 6.

## 11. General

11.1 If any provision is found unenforceable, the remaining provisions continue in force.

11.2 This agreement is governed by the laws of the Republic of South Africa, and you consent to the jurisdiction of its courts.

11.3 We may update these terms from time to time; the version you accept at checkout applies to your purchase.

11.4 This agreement, together with your order confirmation and any event-specific terms, is the entire agreement between us regarding your ticket purchase.

## 12. Contact

For any question, data-protection request, or to withdraw a consent, contact us at **info@fireandfragrance.com**.
`;
