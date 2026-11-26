# Suggested upgrades

Most useful first. Each one either saves the co-ordinator time or closes a gap the claude.ai version can't. None of them change the rules in SPEC section 6.

## Do with the move to the Hub

| # | Upgrade | Why | Effort |
|---|---|---|---|
| 1 | **Hub bookings replace manual trips** (SPEC 7.1) | Today trips and rentals are typed in twice: once in the Hub, once in the app. | Medium |
| 2 | **Km and fuel at handover** (SPEC 7.2) | The service and bumper-to-bumper warnings are only as good as the last km reading. Asking for it at every handover keeps them right with no extra work for the co-ordinator. | Small |
| 3 | **Renter notices with a one-tap switch** (SPEC 7.3) | Clashes are found today, but someone still has to phone the renter. | Medium |
| 4 | **Reminder in code, to the role** (`server/reminder.js`, Step 4) | Today it's a Claude scheduled task on Gideon's account and Gmail can't send from it. In the Hub it follows the Vehicle Co-ordinator role and uses the Hub's Slack app. | Small |
| 5 | **Drafts saved on the server** | An inspection in progress lives only on the phone it was started on. Saving drafts to the Hub lets it continue on another device and survives a lost phone. | Small |
| 6 | **One copy of each workshop visit** | A booked visit is stored twice (the record and `vehicle.followUp`), which can drift apart. Work out the next visit from the bookings instead. | Small |
| 7 | **Who changed what** | Add `updatedBy` and a short change log per vehicle, so a handover or a disagreement can be checked. | Small |

## Next

| # | Upgrade | Why | Effort |
|---|---|---|---|
| 8 | **Read photos and PDFs with Claude** | Photo of the odometer → km reading; photo of the licence disc → expiry date; workshop invoice PDF → the outcome form filled in (km, cost, invoice no., each job). Removes most typing. | Medium |
| 9 | **Works with a weak signal** | Install to the home screen (PWA) and queue saves until the phone is back online, for checks in a car park or workshop yard. | Medium |
| 10 | **Monthly report for leadership** | Checks done vs planned, issues found and fixed, workshop spend per vehicle, cost per km, co-ordinator hours vs the 5-hour budget. Built from data already collected. | Small |
| 11 | **Shared rules module with tests** | `weekly()`, `kmPlan()`, `clashList()` and the reminder are written twice today (app and `reminder.js`). One module, tested against SPEC section 10, stops them drifting. | Medium |
| 12 | **Nightly backup** | Export the vehicle data and files every night. | Small |

## Later, if wanted

- Drivers do the 2-minute pre-trip check themselves from a link in their booking.
- Licence disc renewals in the daily reminder 30 days ahead (they already show as alerts in the app).
- In-car guide in Afrikaans or Setswana as well as English.
- A monthly cost cap for Ask.
