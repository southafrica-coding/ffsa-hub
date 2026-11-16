# App store accounts plan: native FFSAHUB app

Prepared 2026-11-01 (Africa/Johannesburg). **Nothing has been created, submitted or paid.** No store account may be created or paid for without Sample Person 1's explicit OK. Everything below was read from official pages this session unless marked "not verified".

**Update 2026-11-01 (22:11 SAST), Sample Person 1's calls:** (1) the organisation website to use is **https://ffsouthafrica.com**; (2) the **Apple Account Holder will probably be Sample Person 2 or Sample Person 1, not final**. Sections 0, 1 (website line), 6.2 and 7 are rewritten for this. Implication in one line: the website's domain (ffsouthafrica.com) is not the domain of the enrolling entity's email (accounts@example.com) and the site presents the SA organisation, not FF SA USA, Inc. Apple's published rule does not make that a hard blocker, but it is a **moderate, fixable risk**; see 6.2.

## 0. The facts Sample Person 1 gave

| Field | Value |
|---|---|
| Legal name | FF SA USA, INC (the US Xero org is named "FF SA USA, Inc", which agrees) |
| Type | Religious organization (independent), per the D&B record |
| Address | 75-5851 Kuakini Hwy, Kailua Kona, Hawaii, US 96740-2199 |
| D-U-N-S | 12-600-9050 (already exists, so no 5-business-day D&B wait) |
| Account email | accounts@example.com |
| Organisation website (Sample Person 1's call, 1 Nov) | https://ffsouthafrica.com |
| Apple Account Holder | **Not final: probably Sample Person 2 or Sample Person 1.** Must have legal authority to bind FF SA USA, Inc (section 1) |
| Pilot group | Still TBD |

## 1. Apple Developer Program (organization)

Source: https://developer.apple.com/programs/enroll/ and https://developer.apple.com/help/account/membership/program-enrollment/

**Who must do it:** the person who becomes the *Account Holder*. Apple requires that person to have the **legal authority to bind the organization**: owner/founder, executive team member, senior project lead, or an employee with legal authority granted by a senior employee. If they are not the owner/founder, Apple asks for a **reference who can confirm** that authority. Sample Person 1 needs to say who that is for FF SA USA, Inc (his own role in the Inc is not recorded anywhere I can see). Only that person can sign the agreement and pay.

**What is needed (Apple's list):**
1. An **Apple Account with two-factor authentication on**. First and last name must be the Account Holder's **legal name** (no alias or company name, or approval is delayed). Apple recommends an organization email address.
2. **Legal entity status:** must be a legal entity that can contract with Apple. No DBAs, trade names or branches. **The legal entity name is shown as the seller name on the App Store** ("Seller: FF SA USA, Inc").
3. **D-U-N-S number** that matches the legal name and address Apple sees in the D&B record exactly. Lookup: https://developer.apple.com/enroll/duns-lookup/ (Sample Person 1 should look the number up there *before* enrolling and check name and address character by character).
4. **Phone and email:** the work email must be **associated with the organization's domain name**.
5. **Website:** publicly available and functional, **domain associated with the organization**. Social pages, thin pages and registrar parking pages are refused. **Our entry: https://ffsouthafrica.com** (Sample Person 1's call); see 6.2 for the entity-association risk.
6. Apple may **phone** the number given to confirm enrollment and authority (confirmed by the enrollment guide and third-party how-tos; Apple publishes no call schedule).

**Steps (Sample Person 1 or the Account Holder):**
1. Create (or pick) the Apple Account, legal name, 2FA on a phone the Account Holder keeps.
2. Look up the D-U-N-S on Apple's lookup tool; fix any D&B mismatch at D&B first (free; Apple says to allow up to 2 business days for D&B changes to reach Apple).
3. developer.apple.com/programs/enroll, choose **Company/Organization**, enter legal name, D-U-N-S, address, website, phone.
4. **Tick the fee waiver request** if going the nonprofit route (section 3). Do this at enrollment; it is simpler than after paying.
5. Answer Apple's verification call/email; supply the authority reference if asked.
6. Accept the Apple Developer Program License Agreement; pay (or waiver outcome).
7. Confirmation email; Apple says to contact them if there is none within 24 hours of payment (include the Enrollment ID).
Then: App Store Connect > add users (App Manager / Developer roles) for whoever builds and submits; create the app record (bundle ID suggestion in plan.md: `com.ffsahub.app`, unverified availability).

**Timeline:** Apple publishes **no** review time for organizations. Plan on days to a couple of weeks (my estimate, not Apple's). D-U-N-S issues: only if a new number is needed (not the case) is it up to 5 business days + 2.

**Cost:** **US$99 per membership year** (Apple's page; local currency may be shown at checkout). Renewal yearly. Waiver possible (below).

## 2. Google Play Console (organization)

Sources: https://support.google.com/googleplay/android-developer/answer/6112435 (get started), .../13634885 (account type), .../13628312 (required information), .../10788890 (Play Console Requirements policy), .../14151465 (testing).

**Who must do it:** a person **18 or older** with a **Google Account**; they become the account owner and can invite others. Google may ask for a **government ID and a credit card, both in the owner's legal name**; if invalid the fee is not refunded. There is no "legal authority" test on the page like Apple's, but the owner signs the Developer Distribution Agreement for the organization.

**What is needed:** developer name (public, changeable), **D-U-N-S**, organization name and address (**taken from the Google Payments profile linked at sign-up**, so the payments profile must carry exactly the D&B legal name and address), organization phone, **organization website**, contact name/email/phone (private), developer email and phone (**shown publicly on Google Play**). Policy 2.2: for an organization the account details must be **up to date and consistent with the Dun & Bradstreet profile**. Contact and developer email/phone are verified with one-time codes and must stay operational for the life of the account. Google will display the **legal name, legal address, developer email and developer phone** on the store listing.

**Steps:**
1. Sign in with the Google Account that will own it (a Workspace or Gmail account tied to accounts@example.com, or a named person; see section 6).
2. Play Console sign-up, accept the Developer Distribution Agreement, **pay US$25 once** (Visa/Mastercard/Amex; **no prepaid cards**).
3. Choose **Organization**; create/link the Google Payments profile with the exact D&B name and address; enter the D-U-N-S and confirm the details Google shows back.
4. Enter contact and developer details; verify the email and phone with codes.
5. Upload identity and organization documents when asked (the Subsplash guide, third party and not verified against Google, lists acceptable organization documents: IRS letter such as CP 575, Form 990/8871/8872, state registration or incorporation certificate, SEC filing, or a business credit report; and an ID document).
6. Wait for the verification email to the account owner.
Before the first release you also need: privacy policy URL, Data safety form, demo login for reviewers, and (policy 3.4) your **app package name registered** in Play Console.

**Timeline:** Google publishes no organization-verification time. Allow days to weeks (my estimate). Production-access review for personal accounts "usually seven days or less", n/a below.

**Testing requirement (closed test with 12 testers for 14 days):** applies to **personal accounts created after 13 Nov 2023** (Google's page title and text say "new personal developer accounts"). **Organization accounts are not subject to it** per that page; the "Get started" guide also lists testing and Android-device verification as "Personal accounts only". So an *organization* account can publish without the 12 x 14 days gate. Caveat: the page does not say "exempt" in so many words for organizations, so confirm in Play Console after sign-up; and if Sample Person 1 ends up with a personal account by mistake, the gate applies (and cannot be switched later without a new account). Internal testing needs no requirement at all (up to a small trusted group; instant availability).

## 3. Apple nonprofit fee waiver: does FF SA USA, Inc qualify?

Source: https://developer.apple.com/help/account/membership/fee-waivers/ (same text at https://developer.apple.com/support/fee-waiver/).

Apple's four requirements:
1. Be a legal entity **"with a status as a nonprofit organization"** (footnote 1 defines this; **the footnote text did not come through when I fetched the page**, so the exact definition is not verified. In practice for a US entity Apple has asked for proof of tax-exempt status).
2. Not an individual, sole proprietor or single-person business.
3. **Not have signed the Paid Applications Agreement** (paid apps / in-app purchases).
4. **Not otherwise sell digital goods or services through any of your apps.**
Request: tick the option at enrollment (or later, before expiry, as Account Holder). Apple reviews and may ask for documents. The Account Holder must **re-confirm eligibility at each renewal**; if it stops applying, the US$99 fee returns. No refunds on a fee already paid, so ask **before paying**.

**Does a US religious organization without a 501(c)(3) letter qualify?** Not decided by the page. What I can say from sources: under US tax law a **church or religious organization is automatically treated as 501(c)(3)-exempt and need not apply to the IRS** (Candid/IRS wording quoted in a Candid developer page, https://developer.candid.org/reference/accept-donations-with-apple-pay), so "no letter" is not itself disqualifying in law, but Apple's reviewer may still want a document. Have ready: the **Hawaii nonprofit corporation records** (DCCA certificate/articles), the **EIN letter (IRS CP 575)**, any IRS determination letter, and the D&B religious-organization classification. **Honest answer: probably eligible, not guaranteed; ask via the fee-waiver tick box and see.** Budget the US$99 as the fallback.
Watch-outs that could void the waiver: selling anything digital in-app, signing the Paid Applications Agreement, or later adding in-app ticket or fee purchases through Apple's system (plan.md section K: keep purchase on the website for the pilot). Also no donation collection in-app unless Apple approves the org as a nonprofit (guideline 3.2.1/3.2.2, from plan.md, not re-fetched).

## 4. Expo / EAS account setup

Source: https://expo.dev/pricing (fetched today).
- Sign up at https://expo.dev/signup. Create an **Expo organization** (e.g. "ffsa") rather than a personal account, so the project and **app credentials (certificates, keystore) are owned by the org**, not one person. Members are unlimited on every plan; two-factor auth is available on every plan.
- **Free: $0** per month: 15 Android + 15 iOS builds per month, low-priority queue (waits of 90+ minutes at peak), 45-minute build timeout, submit to stores, OTA updates to 1,000 monthly active users. Enough for development and a small pilot.
- **Starter: US$19/month** (+ usage): US$45 build credit, high-priority queue, 3,000 MAUs.
- Production US$199/month, not needed.
- Extra builds beyond the plan: Android US$1, iOS US$2 (medium worker). Usage-based.
- Needed from the stores for EAS: Apple Developer membership (EAS manages certificates/profiles using an App Store Connect API key), Google Play service-account key for EAS Submit.
- Who: whoever builds the app (Sample Person 1 or a delegate). No payment needed to start (Free plan). Do not create it until Sample Person 1 says.

## 5. Cost summary

| Item | When | Cost |
|---|---|---|
| Apple Developer Program | yearly | **US$99** (US$0 if the nonprofit waiver is granted) |
| Google Play Console | once | **US$25** |
| EAS | monthly | **US$0** (Free) or **US$19** (Starter, US$228/yr) |
| D-U-N-S | n/a | already held, free |
| Year-one total | | **US$25 to US$352** (US$25 + 0 or 99 + 0 or 228); realistic pilot case with Free EAS: **US$25 (waiver) to US$124** |
| Tax/banking forms, Apple Paid Applications Agreement, Google merchant bank details | only for paid apps or in-app purchases | **not needed for a free app** |

## 6. Mismatches and risks to flag to Sample Person 1

1. **US Inc in Hawaii vs a South African hub and users.**
   - **Seller name:** Apple shows "FF SA USA, Inc" as the seller. Google shows the **legal name and the Hawaii legal address publicly**, plus the developer email and phone. South African users will see a US seller, not "Fire & Fragrance SA NPC" (the SA entity, which is the name on the SA Xero org). Decide if that is acceptable. Alternative: enroll the SA NPC instead, which needs its own D-U-N-S and documents and is slower. Sample Person 1 chose the Inc.
   - **Privacy policy / data controller:** the Hub holds South African people's personal data (including passport, visa, health insurance fields). The app's privacy policy, Apple privacy labels and Google Data safety form must name who is responsible (the Inc as publisher; the SA NPC likely runs the data). Needs Sample Person 1's/legal's decision before submission; the privacy policy must be public and linked in the app and store listing.
   - **Countries:** for the pilot choose **South Africa** (add the United States only if needed). **Do not enable the EU**: distributing in the EU triggers extra trader/DSA disclosures on both stores (my knowledge, not re-verified), which would publish contact details. Apple also has "unlisted app distribution" (plan.md links it) for a private pilot, and TestFlight (internal testers must be App Store Connect users, external up to 10,000 after a light review). Google internal/closed testing tracks handle the Android pilot.
   - **Tax/banking:** none for a free app. Do not sign Apple's Paid Applications Agreement (it would also kill the fee waiver) and do not add payouts.
2. **Email domain vs website (rewritten 1 Nov: website = ffsouthafrica.com).**
   - **What Apple actually says** (https://developer.apple.com/programs/enroll/, read this session): *"Phone and Email. Your work email address needs to associated with your organization's domain name."* and *"Website. Your organization's website must be publicly available and functional, and its domain name must be associated with your organization. Links to social media webpages or websites that contain minimal content or display a message from a domain registrar won't be accepted."* Apple's help page (https://developer.apple.com/help/account/membership/program-enrollment/) says the **legal entity name** is what shows as the App Store seller and that DBAs, trade names and branches are not accepted.
   - **Is "the website should be associated with the enrolling entity, FF SA USA, Inc" a real risk? Moderate, not a hard rule.** Apple's wording is only "associated with your organization". It does not say the site must be owned by, or branded as, the enrolling legal entity, and it names no exact test. What Apple verifiably checks (per its pages) is the D-U-N-S record (legal name, address, phone) and that the email domain and website domain relate to the organization. So the realistic failure mode is a **delay or a request for clarification**, not an automatic refusal. I did not find Apple text that guarantees approval either way, so treat it as unverified in practice.
   - **Where our setup is weak:**
     - `ffsouthafrica.com` is live and titled "HOME | Fire & Fragrance", mentions the NPC (box fetch, 1 Nov), so it reads as the **South African NPC's** site, while the enrolling entity is the Hawaii-based **FF SA USA, Inc**. A reviewer comparing the D&B legal name with the website sees a different-looking organisation.
     - The Account email on file is `accounts@example.com`, a **different domain** from the website. Apple wants the work email on the organisation's domain; email on one domain and website on another is the likeliest thing to be questioned.
   - **Mitigations (cheapest first):**
     1. Use an address **on ffsouthafrica.com** as the Apple Account / contact email (the staff Hub logins already live on that domain, so a mailbox is easy), so email domain = website domain. Needs Sample Person 1's OK because it changes the "Account email" fact above; I have not changed it.
     2. Make ffsouthafrica.com clearly name **FF SA USA, Inc** (e.g. a footer or "Legal" / "About" line: legal name, the Kailua Kona address, and that the Inc operates the FFSAHUB app with the SA NPC), so the site demonstrably belongs to or acts for the enrolling entity.
     3. Check the **D&B record lists the website** (and which one). If D&B lists fireandfragrance.com, either update D&B to add ffsouthafrica.com or accept the mismatch knowingly. Not visible to me.
     4. Fallback if Apple pushes back: switch the enrolment website to https://www.fireandfragrance.com (live; mentions Hawaii and South Africa; has a privacy policy) which matches the existing `accounts@example.com` email.
   - Google asks that organisation details be consistent with the D&B profile (policy 2.2, section 2 above), so the same checks apply there.
   - The Hub itself, **ffsahub.com, is a login wall** (title "FFSA Hub"); Apple will not accept it as "the organization's website".
   - Also confirm the mailbox exists and who reads it, because codes and verification mail go there.
3. **Shared mailbox as the account identity.** A role mailbox like role@example.com is fine as the Apple Account / Google Account login only if the Account Holder controls it and the 2FA phone is a person's. Apple wants the Account Holder's **legal first and last name** on the Apple Account; the name can differ from the email local part. Keep a second person as an admin in both consoles so the account is not stranded.
4. **Apple 2FA phone and the D&B phone:** Apple may call the organization phone; make sure the number on the D&B record is answered by someone who knows about the enrollment.
5. **Hawaii vs SA time/phone:** a verification call to a US number from Apple during US hours (Hawaii is UTC-10, 12 hours behind Johannesburg). Plan who picks up.

## 7. Steps only Sample Person 1 (or the legal Account Holder) can do

1. Decide who the Account Holder is. **Sample Person 1 says probably Sample Person 2 or Sample Person 1, not final.** Whoever it is must have legal authority to bind FF SA USA, Inc (owner/founder, executive team member, senior project lead, or an employee with authority granted by a senior employee) and, if not the owner/founder, name a reference who can confirm it. Their **legal first and last name** goes on the Apple Account, with 2FA on their own phone. Sample Person 2 is not known to be an officer of the Inc and Sample Person 1's role in the Inc is not recorded anywhere I can see, so check this before choosing.
2. Confirm the D&B record's exact legal name, address and website (and fix at D&B if needed). Decide the 6.2 mitigations: an @ffsouthafrica.com contact email, and a visible FF SA USA, Inc legal line on ffsouthafrica.com.
3. Create the Apple Account (legal name, 2FA), enroll, tick the fee-waiver box, pay if needed.
4. Create the Google Account/owner, pay US$25, complete ID and organization verification.
5. Own the phone verification call(s) and the one-time code emails.
6. Decide the privacy policy publisher/controller and the countries (SA only recommended).
7. Say who is in the pilot (still TBD) so testers can be added (Apple: App Store Connect users or TestFlight email invites; Google: tester email list).
8. Say when to create the Expo organization (no payment needed on Free).

## 8. Not verified

Apple footnote 1 definition of "nonprofit"; whether Google formally exempts organization accounts in one sentence (page is titled for personal accounts); acceptable Google organization documents (third-party list); Apple/Google review durations (not published); whether `com.ffsahub.app` is free; EU trader rules; D&B record contents.

## Sources
https://developer.apple.com/programs/enroll/ · https://developer.apple.com/help/account/membership/program-enrollment/ · https://developer.apple.com/help/account/membership/fee-waivers/ · https://developer.apple.com/support/fee-waiver/ · https://developer.apple.com/help/account/membership/programs-overview/ · https://support.google.com/googleplay/android-developer/answer/6112435 · https://support.google.com/googleplay/android-developer/answer/13634885 · https://support.google.com/googleplay/android-developer/answer/13628312 · https://support.google.com/googleplay/android-developer/answer/10788890 · https://support.google.com/googleplay/android-developer/answer/14151465 · https://expo.dev/pricing · https://developer.candid.org/reference/accept-donations-with-apple-pay · https://support.subsplash.com/en/articles/10492766-verifying-your-google-play-console (third party)
