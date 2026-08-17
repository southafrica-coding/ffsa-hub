-- ============================================================
-- FFSA Hub — Migration 164: Consent "kind" + Child Protection Policy + NDA
-- ------------------------------------------------------------
-- Joining the Hub now requires agreeing to THREE policies, by audience:
--   • Privacy & Data Processing Agreement — everyone (already seeded, m034)
--   • Child Protection Policy             — everyone (NEW here)
--   • Non-Disclosure Agreement (POPI)     — staff only (NEW here)
--
-- The original consent schema (m034) supported exactly ONE global current
-- agreement. This adds a `kind` discriminator so each policy has its own
-- current version, and seeds the two new documents verbatim (formatting
-- cleaned; page headers/footers and blank form/signature fields removed).
--
-- Audience scoping (who must sign which) lives in application code
-- (REQUIRED_CONSENTS in src/services/consent.ts), not the DB.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Discriminator + one-current-per-kind
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.consent_agreements
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'privacy';

DROP INDEX IF EXISTS public.consent_agreements_only_one_current;

CREATE UNIQUE INDEX IF NOT EXISTS consent_agreements_one_current_per_kind
  ON public.consent_agreements (kind) WHERE is_current = true;

-- ────────────────────────────────────────────────────────────
-- 2. Seed — Child Protection Policy (kind = 'child_protection')
--    Verbatim from "Fire & Fragrance — Policy Against Child Abuse"
--    (Approved March 2026). Sections 1–9 + Appendix (Signs, Grooming)
--    + the Declaration. Blank Incident Report form and flow-chart image
--    omitted. The consent checkbox affirms the Declaration.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.consent_agreements (version, kind, title, body_markdown, is_current)
VALUES (
  'child-v1.0-2026-03',
  'child_protection',
  'Fire & Fragrance — Policy Against Child Abuse',
$body$# Fire & Fragrance — Policy Against Child Abuse

**Approved March 2026**

## 1. Policy Intent

1.1. The heart of this policy is to protect and guard the well-being of children, to protect adults from false accusations, and to protect the organization's integrity.

1.2. We are committed to upholding and implementing these values:

1.2.1. We believe that all children have value, worth, and dignity as they are made in the image of God. Thus, we believe that all children should be treated with respect and cared for in ways that honor God, including speech, conduct, and communication platforms, including social media.

1.2.2. We believe that all children have a right to protection from abuse, irrespective of race, social background, age, gender, disability, religion, nationality, or beliefs.

1.2.3. We believe that preventative measures should be taken to not only protect children from abuse, but also to protect anyone involved with Fire & Fragrance.

1.2.4. We believe that children have the right to speak and be heard in Fire & Fragrance community life.

1.2.5. We believe that effective child protection starts earlier than responding to complaints or concerns of child abuse. Preventive work is a vital part of child protection; every effort should be made to prevent children from being abused or neglected.

1.2.6. Fire & Fragrance affirms that the primary responsibility and authority for the children's well-being and protection belongs to the parents. We believe that we, as a community, should do all we can to help and encourage the parents in this task. We recognize that because of their day-to-day contact with children, school staff, volunteers, and health care providers are well-placed to observe the outward signs of abuse. Schools and programs will therefore:

1.2.6.1. Establish and maintain an environment where children feel secure, are encouraged to talk, and are listened to.

1.2.6.2. Ensure children know there are adults in our community they can approach if they are worried, scared, or hurt.

1.2.6.3. Provide an appropriate reporting structure to the proper Fire & Fragrance leaders and local authorities if abuse is suspected, observed, or known.

1.2.7. With this commitment to the protection and welfare of our children, we have instituted this Policy Against Abuse, as well as a behavioral protocol and specific guidelines for how to respond to reported or suspected abuse.

## 2. Definition of terms used in this document

2.1. 'Abuse', as defined in South Africa's Children's Act 38 of 2005, in relation to a child, means any form of harm or ill-treatment deliberately inflicted on a child, and includes -

2.2. 'Child', as defined in Children's Act 38 of 2005, is any person under the age of 18.

2.2.1. Assaulting a child or inflicting any other form of deliberate injury to a child;

2.2.2. Sexually abusing a child or allowing a child to be sexually abused;

2.2.3. Bullying by another child;

2.2.4. A labour practice that exploits a child; or

2.2.5. Exposing or subjecting a child to behavior that may harm the child psychologically or emotionally

2.3. 'Sexual Abuse', as defined in Children's Act 38 of 2005, in relation to a child, means-

2.3.1. Sexually molesting or assaulting a child or allowing a child to be sexually molested or assaulted;

2.3.2. Encouraging, inducing or forcing a child to be used for the sexual gratification of another person;

2.3.3. Using a child in or deliberately exposing a child to sexual activities or pornography; or

2.3.4. Procuring or allowing a child to be procured for commercial sexual exploitation or in any way participating or assisting in the commercial sexual exploitation of a child

2.4. 'Care-Giver', as defined in Children's Act 38 of 2005, in relation to a child, means- any person other than a parent or guardian, who factually cares for a child and includes –

2.4.1. (a) ………. (omissions for the sake of applicability);

2.4.2. (b) A person who cares for a child with the implied or express consent of a parent or guardian of the child;

2.4.3. (c) – (g) ………. (omissions for the sake of applicability)

2.5. 'Care', in relation to a child, includes, where appropriate-

2.5.1. (a) Within available means, providing the child with-

2.5.1.1. (i) A suitable place to live;

2.5.1.2. (ii) Living conditions that are conducive to the child's health, well-being, and development; and

2.5.1.3. (iii) The necessary financial support;

2.5.2. (b) Safeguarding and promoting the well-being of the child;

2.5.3. (c) Protecting the child from maltreatment, abuse, neglect, degradation, discrimination, exploitation and any other physical emotional or moral harm or hazards;

2.5.4. (d) Respecting, protecting, promoting and securing the fulfillment of, and guarding against any infringement of, the child's rights set out in the Bill of Rights and the principles set out in Chapter 2 of this Act;

2.5.5. (e) Guiding, directing and securing the child's education and upbringing, including religious and cultural education and upbringing, in a manner appropriate to the child's age, maturity and stage of development;

2.5.6. (f) Guiding, advising and assisting the child in decisions to be taken by the child in a manner appropriate to the child's age, maturity and stage of development;

2.5.7. (g) Guiding the behaviour of the child in a humane manner;

2.5.8. (h) Maintaining a sound relationship with the child;

2.5.9. (i) Accommodating any special needs that the child may have; and

2.5.10. (j) Generally, ensuring that the best interest of the child is the paramount concern in all matters affecting the child;

2.6. Fire & Fragrance will be referred to in this document as "F&F"

2.7. The Child Protection Team will be referred to as "CPT"

## 3. Fire & Fragrance Child Interaction Policy

3.1. Failure to follow protocol can lead to removal from the ministry/school and even dismissal from F&F. The appropriate authorities will also be notified in accordance with the applicable laws relating to the protection of children in the respective nation where the instance occurred. In certain situations, F&F may be required by law to determine the suitability of persons working with or caring for children from time to time, to make sure that children in our community are duly protected.

3.2. The policies found in this document apply to any project/location/team/program under the responsibility of F&F and any person functioning under F&F leadership, whether staff, student, or volunteer.

3.3. What is Appropriate Affection and Interaction with children and youth? - Love and affection are part of F&F. There are many ways to demonstrate affection while maintaining positive and safe boundaries with children and youth. It is important that there is an agreed upon standard of positive and safe boundaries with young people due to the vast cultural and familial differences represented in each F&F community. Everyone's "normal" is different. Some positive and appropriate forms of affection are listed below. This is considered "normal" amongst F&F community:

3.3.1. Brief hugs

3.3.2. Pats on the shoulder or back

3.3.3. Handshakes

3.3.4. "High-fives"

3.3.5. Verbal praise

3.3.6. Holding hands during prayer

3.3.7. Pats on the head when culturally appropriate (For example, this gesture should typically be avoided in some Asian communities)

3.4. The following forms of affection are considered inappropriate with children and youth:

3.4.1. Inappropriate or lengthy embraces, touches, or physical contact

3.4.2. Kisses on the mouth to a child that is not related to you

3.4.3. Holding children over three years old on the lap

3.4.4. Touching bottoms, chests, or genital areas other than for appropriate diapering or toileting of infants and toddlers

3.4.5. Showing affection in isolated areas such as bedrooms, closets, staff-only areas, or other private rooms

3.4.6. Occupying a bed with a child or youth

3.4.7. Any type of massage given by a child or youth to an adult

3.4.8. Any type of massage given by an adult to a child or youth

3.4.9. Snapping bras or giving wedgies or similar touch to underwear, whether or not it is covered by other clothing

3.4.10. Comments or compliments (spoken, written, or electronic) that relate to physique or body development. Examples would be, "You sure are developing," or "You look really hot in those jeans."

3.4.11. Private meals with individual children or youth without parents' permission or consent

3.4.12. Giving gifts or money to individual children or youth without parents' permission or consent

## 4. Expected Behavioral Protocols

4.1. Everyone at F&F must sign a statement acknowledging that they have read this policy, have not abused a child, will commit themselves to the policy, and understand that action will be taken in cases of inappropriate behavior.

4.2. No one should inappropriately touch a child or expose them to inappropriate materials such as pornographic materials and literature.

4.3. An adult will not be alone (in a place where they cannot be seen by others) with a child without the parent's permission. Nor will they maintain a (private) relationship through social media without the parents' consent. Always ask the parents' permission before taking a child away from their parents' sight. Make sure they know where you are with their child.

4.4. Adults will always be responsible for their own behavior and cannot blame the child, even if the child 'provokes' or acts in a 'seductive' way.

4.5. When children need to be supervised, F&F requires at least two leaders/supervisors in any situation. No one should be expected to supervise more children than he or she feels capable of handling.

4.6. F&F communication about children will reflect images that preserve their value, dignity, self-worth, and are decent and respectful, not seeking to exploit their situation.

4.7. F&F staff will hold each other accountable to the policies in this document. If you notice inappropriate behavior between an adult and a minor, you should approach the adult and remind them of F&F's policies. If you are repeatedly reminding the same adult of F&F's policies, you should report this individual to the CPT for the CPT to determine if further training is needed.

4.8. Required Training

4.8.1. Any staff or volunteers who regularly work with children (reading programs, preschool, etc.) must complete a 1-hour training led by members of the CPT before beginning their work with children.

4.8.2. Any staff who lead ministries directly involved with children will be required to complete an online specialized training for preventing abuse.

4.8.3. Any staff, students, or volunteers who only occasionally work with children or will briefly work with children on an outreach must complete a short training led by members of the CPT.

4.8.4. Additional training may be required for those directly involved with children at the recommendation of the CPT in order to stay up to date on policies.

## 5. Protocol for Reporting Suspected Abuse

5.1. F&F has a policy and protocol for receiving reports of suspected abuse. Please follow this protocol if you suspect any kind of neglect or abuse of a minor.

5.2. Please note, you are required by F&F to report child abuse when you have reason to believe that child abuse or neglect has occurred or that there is a substantial risk that child abuse or neglect may occur in the reasonable future. Failure to report this information to the CPT is considered a breach of this policy and could result in disciplinary action.

5.3. The alleged abuse:

5.3.1. Can be current or have happened in the past

5.3.2. Can be a one-time incident or multiple incidents over weeks, months, or years

5.3.3. Has taken place within the F&F community or elsewhere

5.4. In the event that any kind of abuse is suspected, the abuse should be reported to a member of the CPT on the same day. It is better to act early and be too sensitive than to regret saying nothing.

5.5. Do not talk openly about what you have seen or reported. We value communicating with integrity, which means we will respect all individuals involved by keeping the strictest confidentiality. Your concerns should only be shared with the CPT.

5.6. The CPT member will ask you to write down what you have heard or observed

5.7. What to do if a child tells you about abuse:

5.7.1. Stay calm and listen carefully. Do not react with your face or body language.

5.7.2. You can ask clarifying questions, such as "Where did they touch you?", but do not ask leading questions that suggest answers, such as "Did they touch your bottom?" Do not ask "why" or "but" questions.

5.7.3. Take the child seriously. Observe non-verbal signs.

5.7.4. Do not promise to keep a secret. If abuse has taken place, it may need to be reported to authorities. If a child asks you to keep a secret, you can say, "I'm glad you want to share something with me. I might need to share it with another adult to help keep you safe."

5.7.5. Reassure the child that they did the right thing by telling you. Make sure to say, "What happened was not your fault."

5.7.6. If possible, go with the child to a CPT member. Your report should happen on the same day the child reports it to you.

5.7.7. If you will not be able to make a report within a few hours, write down what the child told you, in their own words, so that you don't forget.

5.7.7.1. Example of a poor report: "Little Johnny told me someone touched him. He seemed sad. I'm so worried."

5.7.7.2. Example of a helpful report: "Johnny came to me crying right after lunch. Johnny told me XYZ happened to him at XYZ place yesterday. Johnny said the adult who did this was named XYZ. I told Johnny this was not his fault. Johnny said he felt safe to go back to his class. I prayed with Johnny and then came to make this report."

5.7.8. Remember to keep everything confidential. Once you have shared with a CPT member, do not share with anyone else. The CPT will share with the appropriate people. Report any additional information the child shares with you to the CPT.

5.7.9. What will happen next?

5.7.9.1. The CPT member will inform the other members of the team. They will decide on a course of action using the procedures and principles outlined in this document.

## 6. Role of Child Protection Team

6.1. The role of a Child Protection Team Member is not only to respond to allegations of abuse, but also to have an active role in the organization in preventing abuse.

6.2. The CPT educates staff on:

6.2.1. Signs of child abuse (found below)

6.2.2. Appropriate behavior with children

6.2.3. Responsibility to speak about concerns and suspicion of abuse

6.2.4. Procedure for reporting suspected child abuse

6.2.5. Conducts training for those who will work specifically with children

6.3. Educates students and volunteers on:

6.3.1. Their responsibility to adhere to the Child Protection Policy, which has been signed upon acceptance

6.3.2. Who they should talk to if they feel concerned about something regarding a minor

6.4. Responds to child abuse allegations from staff, students, volunteers, parents, etc.

6.5. Maintains an updated Child Protection Policy if needed

## 7. Protocol for Child Protection Team

7.1. This procedure relates to internal allegations within any given F&F location. If F&F becomes aware of abuse involving someone outside of our immediate staff, students, and volunteers, F&F will report it to the appropriate authorities, as it is outside our jurisdiction.

7.2. CPT members should follow this procedure with the strictest adherence:

7.2.1. Once an allegation of abuse has been presented to you, ask the reporter to fill out the reporting form, which can be found in this document. Remind the reporter to share facts and use the child's words to the best of their ability in as much detail as possible.

7.2.2. Tell the reporter that this information will be further investigated immediately. Thank them for sharing with you. Remind the reporter to keep this information confidential to protect everyone involved.

7.2.3. Inform the whole CPT of the report. If appropriate, inform the F&F local leadership team.

7.2.4. Depending on the seriousness of the allegations and the "obviousness" of the signs of abuse (i.e., the reporter saw the abuse take place or the child made the report themselves and was obviously harmed), the CPT may choose at this point to contact the relevant authorities

7.2.4.1. If a serious allegation is made against a F&F staff member, the staff member should immediately be removed from all ministry responsibilities. This decision will be at the discretion of the CPT with consultation of the F&F local leadership team. The staff member may be required to vacate F&F property and/or housing if necessary for the safety of the child. The cost of housing outside official F&F housing will be the responsibility of the staff member.

7.2.5. If the CPT feels more information is needed before a report is made, the CPT may do the following:

7.2.5.1. Ask for a report from the most closely related ministry leader to the event in question.

7.2.5.2. Interview the parents and the child involved. The child should not be interviewed without the parents present.

7.2.6. The CPT should record every step they take and any information they collect during the investigation process. A file should be created for all information.

7.2.7. The CPT should inform the F&F local leadership team about their findings.

7.2.7.1. The Local Leadership Team should report this to their External Advisor Team

7.2.8. If no abuse is evident, all parties involved in the investigation should be notified.

7.2.9. If there is evidence that abuse has taken place, the CPT will evaluate the level of seriousness and determine whether a legal report should be made.

7.2.9.1. The CPT should inform the parents of the child that a report will be made to the relevant authorities.

7.2.9.2. If the CPT feels there is no need to make a legal report, this decision must be approved by the F&F local leadership team. This would only occur in situations where F&F's policy has been breached, but no legal crime has been committed. Any crime against a minor will be reported in accordance with the law. There must be a written plan in place outlining how the situation will be handled internally and how the abuse will be stopped.

7.3. Notes on the process of investigating reports

7.3.1. All reports should be investigated.

7.3.2. All reports should be recorded and completed within 7 days of the allegation.

7.3.3. All parties involved, including both the child and the perpetrator, will be treated with respect and confidentiality.

7.3.4. CPT members need to be aware that false allegations are possible. It is their job to carefully investigate without prejudice. The child's safety is the number one priority. CPT members should share allegations with the accused in a careful way so as not to put the child in further danger. The child's name should NOT be shared.

7.3.5. CPT members need to exercise caution in sharing the name of the accused. F&F could be held liable if factual evidence is not present, and it is not in the public interest to know.

7.3.6. The CPT and F&F reserves the right to, at any point of the investigation, call on the help, consultation, or assistance of the External Oversight Team or any relevant third party outside of F&F.

## 8. Internal Procedures after Conclusion of Investigation

8.1. Counseling and Pastoral Support

8.1.1. F&F will support any involved individuals to the best of our ability. This could be a referral to a local counselor or a meeting with members of the CPT or local leadership team to process what has occurred.

8.2. Dismissal

8.2.1. Any person found by F&F to have violated any section of this policy shall be removed from any school or ministry they are with and will be required to vacate any F&F property within 24 hours.

8.2.2. This person will not be allowed re-entry to F&F property or event without written approval from the F&F local leadership team.

8.2.3. F&F local leadership team reserves the right to report the incident, any evidence, and statements to relevant authorities, as well as their external oversight, regional leadership, and/or global leadership team.

8.3. Appeals

8.3.1. Individuals may file an appeal with the CPT.

8.3.2. The CPT and F&F reserve the right to review the appeal and modify a prior decision or dismiss the appeal.

8.3.3. Appeals are subject to processes implemented by local authorities.

## 9. Final Thoughts

9.1. Remember that the heart of this policy is to provide a framework for the safety of all members, young and old, of F&F. It is not to cause suspicion or fear. Please reach out to the local leadership team or the CPT if you have any questions or concerns regarding this document. As for God, his way is perfect: The LORD's word is flawless; he shields all who take refuge in him. - Psalm 18:30

---

## Appendix 1 — Signs of various kinds of abuse

A note on the following signs of abuse - **none of these signs in and of themselves indicate that abuse has taken place.** There could be other difficult circumstances that are the reason for any of these signs to be present. We should not rush to conclusions or live in suspicion, but should take these signs seriously when present. The CPT is available as a "sounding board" or resource for anyone with concerns about a minor. The CPT is a good place to start if you observe something and need to express your concerns. Do not allow yourself to live in suspicion!

**Warning signs of sexual abuse**

- Age-inappropriate knowledge or interest in sex
- Avoids other people
- Extreme behavior: either very aggressive or very passive,
- Destructive behaviour, attempts at suicide and other physical harm, drug abuse, etc.
- Nightmares and bedwetting, drastic changes in appetite.
- Fear of a particular person or family member.
- Personality changes, such as becoming insecure or clinging.
- Trying to be perfect, overreacting to criticism.
- Suddenly drawing sexually explicit pictures
- Worried about clothing being removed.
- Have trouble sitting or standing, torn or bloody underwear, swelling, bruises, or bleeding in the genital areas
- Pregnancy, especially under the age of 14.
- Caregiver's signs: seems unusually controlling or protective of the child and avoids contact with other adults and children.

**Warning signs of physical abuse**

- Physical marks; unexpected bruises, cuts, burns, etc. in unnatural body parts or shapes of hand or belt. Pattern of several injuries, bite marks.
- Fearfulness, shyness, afraid to go home, avoiding contact (especially physical contact), inappropriate clothing for the weather (too covering).
- Problems in school, anti-social behavior, and fear of adults.
- Fear of medical care or examination, refusal to undress for sports activities (or for going to bed).
- Fear of the suspected abuser being contacted.
- Caregiver's signs: justifies physical abuse as a form of 'discipline', anger management problems, lack of self-control, and high temper, the explanation of the reason for the injury is different from the child's story or unrealistic.

**Warning signs of emotional abuse**

- Excessive shyness, fearfulness, afraid of doing something wrong, uncontrolled aggression, trying to look after other children, extreme behavior, antisocial behavior, age-inappropriate behavior, speaks lowly of himself or herself.
- Apathy, stress, hostility, eating disorders, depression, and lack of concentration.
- Overreacting to mistakes, development lags, sudden speech disorder, extreme fear of new situations,
- Inappropriate reaction to pain, 'I deserve this', neurotic behavior (rocking, hair twisting, etc.)
- Caregiver's signs: belittles the child, talks harshly and critically about and to a child, has anger issues, and extreme concern over the child's well-being.

**Young People who sexually abuse**

- A third of sexual offenses against children are carried out by a person under the age of 18, some of whom will continue as adults to sexually abuse children. It is still considered sexual abuse if the person committing the abuse is under 18 years of age and should still be reported to the CPT.

## Appendix 2 — Grooming

(from https://raisingchildren.net.au/school-age/safety/online-safety/grooming-signs)

Many of the signs of grooming can look like normal adult-child relationships, which is why grooming is difficult to spot. If something doesn't feel right, it's important to trust your instincts, watch for signs, and keep an eye on your child's behavior.

The following signs might indicate that your child or the child you're caring for is being groomed. Your child:

- talks a lot about a particular adult or older child, or wants to spend a lot of time with them or meet them alone
- is in a relationship with a much older person
- is skipping school or sporting activities
- is spending less time with friends or changes friendship groups suddenly
- spends more time alone in their room
- has unexplained gifts like new toys, clothes, jewelry, or electronics, and doesn't want to talk about where the gifts came from
- doesn't want to talk about what they've been doing or lies about it
- stops telling you about their day or asking for your advice.

Signs someone is grooming parents - Grooming often involves gaining the trust of a child's family or caregivers to get time alone with a child. It can look like a close relationship with the child's family, so it can be difficult to spot. If something doesn't feel right, it's important to trust your instincts and watch for signs. The following signs might indicate that someone is grooming you or your family intending to sexually abuse your child or the child you're caring for. The person:

- oversteps your social boundaries – for example, they might show up to your child's birthday party uninvited with a gift
- offers to take your child to sports or other activities, or offers to babysit or take your child camping
- offers to mentor your child, individually coach your child, and so on
- buys gifts for your family
- offers to do things for your family, like repairs or gardening
- shows an interest in your child's activities, wellbeing, school grades, or other areas of your child's life
- compliments your family and parenting
- tries to start a flirtatious or romantic relationship with you

Who might be involved in grooming? — Anyone can engage in grooming behavior. They can be people of all genders. They can include older children, relatives, family friends, strangers, professionals, people from a family's place of worship, sporting coaches, early childhood educators, and school teachers.

---

## Child Protection Policy & Declaration

As F&F, we highly value the well-being and safety of children we hereby inform you that F&F has a Child Protection Policy. (A child is a person under 18) For this reason, we ask you to carefully read the following guidelines and to sign the declaration. In case you cannot or do not want to truthfully sign the declaration, please contact us by phone or email before you send in your application. You will receive a copy and an explanation of the whole Child Protection Policy upon your staff/student orientation with F&F. If desired, you can already request a copy by email.

**Guidelines:**

1. Without permission from the parents, it is not permitted to be alone with a child in a place where you cannot be seen by other people. You will always have to obtain permission from one of the parents before taking a child to a place where you cannot be seen. Make sure the parents know where you are with their child. It is also not allowed to be in contact (build a private relationship) with a child through social media; i.e. Skype, MSN, Messenger, Instagram, TikTok, or any other online platform, etc., without permission of the parents.

2. Act immediately when you see a child in danger or intending to do something that could be dangerous. After acting, please report this situation to a staff worker, who in turn will inform the parents of the child.

3. Do not punish someone else's child. If you think a child needs correction, please bring this to the attention of the F&F staff, who in turn will inform the parents.

4. Don't give any food or drinks to children until the age of 12 without the consent of the parent.

**I declare that:**

- I have read the guidelines given above.
- I have never been convicted of an offense concerning any kind of abuse against a child (a person under 18).
- I have never abused a child.
- I will abide by the Child Protection Policy of F&F.
- I understand that if a complaint is brought against me regarding the abuse of children while under F&F leadership, the allegation will be thoroughly investigated in cooperation with the appropriate authorities. I may be asked to leave F&F property and will do so at my expense.

By ticking the consent box, you confirm the declaration above. Your acceptance — your name, the date and time, and the version of this policy — is recorded as your electronic signature.
$body$,
  true
);

-- ────────────────────────────────────────────────────────────
-- 3. Seed — Non-Disclosure Agreement (kind = 'nda') — STAFF only
--    Verbatim from "FFSA — Reciprocal Confidentiality and Non-Disclosure
--    Agreement (POPI Act)", updated August 2026. Clauses 1–5 +
--    Acknowledgement + EDT clause. Blank signature/name/address fields
--    omitted — the recorded acceptance (name, timestamp, IP) is the
--    electronic signature the Acknowledgement clause anticipates.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.consent_agreements (version, kind, title, body_markdown, is_current)
VALUES (
  'nda-v1.0-2026-08',
  'nda',
  'FFSA — Reciprocal Confidentiality & Non-Disclosure Agreement (POPI Act)',
$body$# Reciprocal Confidentiality and Non-Disclosure Agreement

**FFSA NPC** (Registration number: 2019/110109/08), a non-profit company with registered address at 36 Spruit Street, Potchefstroom, 2531, South Africa

**And** you, the undersigned (accepting electronically).

Whereas the parties place on record that in the pursuance of appointing human resources to the staff of FFSA NPC during the process of staff / intern applications, student interviews or any other volunteer appointment or addition to personnel, the parties may become exposed to personal information from such other parties;

AND for the management of financial data, resources, donations and banking information, the parties may become exposed to sensitive, privileged and confidential information;

AND whereas the parties have agreed upon certain measures to protect the interests of such other parties who have disclosed information to them from time to time;

AND whereas the parties now agree as follows:

## 1. (A) Confidential Information

1.1 The Parties propose to receive certain confidential and proprietary information (The "Confidential Information") from other Parties in the pursuance of staff inclusions. Confidential Information disclosed orally shall be identified as such in writing within five (5) days of disclosure, if necessary for purposes of staff evaluation or suitability. Information which is relevant to the appointment and suitability of potential staff members or students should only be withheld if there is a legitimate reason such as a dispute about the relevance of disclosing such information.

1.2 The Parties receive disclosed information due to their desire to enter into a working relationship to the mutual and common benefit of the parties hereto including their affiliates, subsidiaries, partners, co-ventures, ministry associates, and other associated organisations (herein after referred to as "Affiliates")

1.3 The Parties shall during the course of this agreement, and in the course of normal work proceedings, disclose names of potential staff members or students and other key intermediaries and such information shall be considered confidential in terms of this agreement.

### (B) Non-Disclosure

1.4 The Receiving Party ("party who receives the information") undertakes to the Divulging Party ("party who gives the information") that –

1.4.1 the Receiving Party will treat the Divulging Party's Confidential Information as private and confidential and safeguard it accordingly;

1.4.2 the Receiving Party will not use or disclose or divulge or copy or reproduce or publish or circulate or reverse or engineer and/or decompile or otherwise transfer, whether directly or indirectly, the Confidential Information of the other Party to any other person or entity, except as permitted in 2 below;

1.4.3 the Receiving Party shall take all such steps as may be reasonably necessary to prevent the Divulging Party's Confidential Information from falling into the hands of unauthorized persons or entities;

1.4.4 the Receiving Party shall not disclose the Confidential Information of the Divulging Party to any employee, consultant, professional adviser, contractor or sub-contractor or agent of the Receiving Party, collectively referred to herein as "Representative" of the Receiving Party, or to an affiliate of the Receiving Party, nor shall they be given access thereto by the Receiving Party unless it is strictly necessary for the Purpose referred to in this document;

1.4.5 the Receiving Party shall have procured that the Representative or affiliate to whom or to which such information is disclosed or made available shall have agreed to be bound by all the terms of this Agreement, and, in such event, the Receiving Party hereby indemnifies the Divulging Party against any loss, harm or damage which the Divulging Party may suffer as a result of the unauthorized disclosure of Confidential Information by a Representative or affiliate.

1.5 Any documentation or written record or other material containing Confidential Information in whatsoever form, which comes into the possession of the Receiving Party, shall itself be deemed to form part of the Confidential Information of the Divulging Party. The Receiving Party shall, on request, and in any event if the discussions referred above should not result in an agreement, return to the Divulging Party all of the Divulging Party's Confidential Information which is in physical form (including all copies) and shall destroy any other records (including, without limitation, those in machine readable form) as far as they contain the Divulging Party's Confidential Information.

1.6 The Receiving Party agrees not to disclose to any other party or to use the information of the Divulging Party without the prior written consent or approval of the Divulging Party. The Receiving Party shall herewith be bound to the general non-circumvention rules with specific reference to the direct and indirect networks and people which is accessed by virtue of and as a result of its association with the Divulging Party.

## 2. Agreement Not to Disclose

2.1 Each Party agrees that the Confidential Information is to be considered confidential and proprietary to the other Party and shall hold the same in confidence, shall not use the Confidential Information other than for the purposes of its working relationship with the other Party, and shall disclose it only to its officers, directors, or ministry leaders with a specific need to know.

2.2 The Parties acknowledge responsibility for disclosure to selected persons as per 2.1 herein and accept that any of this Memorandum of Understanding undertaken by such persons shall be deemed to be a breach by the other Party.

2.3 Confidential Information furnished in tangible form shall not be duplicated by either Party except for purposes of this Memorandum of Understanding. Upon the request of either Party, the other Parties shall return all Confidential Information received in written or tangible form, including copies, or reproductions or other media containing such Confidential Information, within ten (10) days of such request. At the requesting Party's option, any documents or other media developed by them as Confidential Information may be destroyed by the other Party who shall provide a written certificate to the requesting Party regarding destruction within ten (10) days thereafter.

2.4 The Parties irrevocably agree that they shall not disclose or otherwise reveal directly or indirectly to a third party any confidential information provided by one party to the other or otherwise acquired, particularly personal information, historical or present psychological issues, criminal records, history of abuse in whatsoever form, traumatic events leading to behavioural patterns, or personal background or issues of whatsoever nature of any person who is disclosing such information, without prior specific written consent of the disclosing Party.

2.5 The Parties agree not to disclose their participation in this undertaking, the existence or terms and conditions of the Memorandum of Understanding, or the fact that discussions are being held with the other Party, unless express permission, in writing is given by the other Party.

## 3. Breach of Confidentiality and Non-Disclosure Clauses

3.1 The Parties agree that it would be unethical and could cause distress, distrust and other harm to the Divulging Party if Confidential Information is divulged by the Receiving party to a third party.

3.2 This Memorandum of Understanding is valid for all interactions, interviews, consultations or intervention opportunities between the Parties and potential staff members, students or volunteers, and the Parties agree that any misuse of Confidential Information supplied in terms of the relationship, notwithstanding any provision contained herein, or any indulgence or relaxation of any clause herein, shall, notwithstanding any arbitration agreements included herein, entitle the Party prejudiced by any breach of agreement to full legal recourse.

3.3 If any of the terms of this Memorandum of Understanding is held by a court of competent jurisdiction to be invalid and unenforceable, then this Memorandum of Understanding, including all of the remaining terms, will remain in full force and effect as if such invalid or unenforceable term had never been included.

3.4 Either party's failure to insist in any one or more instances upon strict performance by the other party of any of the terms of this Memorandum of Understanding shall not be construed as a waiver of any continuing or subsequent failure to perform or delay in performance of any term hereof.

3.5 A party shall not be considered or adjudged to be in violation of this Memorandum of Understanding when the violation is due to circumstances beyond its control, including but not limited to Acts of God, civil disturbances and theft or appropriation of the privileged information or contract(s) without the intervention or assistance of one of The Parties.

3.6 The Parties agree that in the event of any breach or threatened breach of this Memorandum of Understanding, the Divulging Party, may obtain, in addition to any other legal remedies which may be available, such equitable relief as may be necessary for protection against any such breach or threatened breach and that in the event of circumvention of this Memorandum of Understanding by one of the Parties, the other Party shall, without detracting from any other legal remedies which may be available, be directly or indirectly entitled to a legal monetary compensation limited to the costs already incurred as a result of such circumvention plus any and all expenses, including but not limited to all legal costs on a scale as between Attorney-and-Client and expenses incurred to recover the lost revenue.

## 4. Confidential Information

4.1 Notwithstanding the cancellation or termination of this agreement for any reason whatsoever, neither party shall during the existence of this agreement or at any time after the termination date use, divulge, disclose, exploit, permit the use of or in any other manner whatsoever use any other party's confidential information or disclose the existence or contents of this agreement; provided that –

4.1.1 the receiving party may disclose the other party's confidential information and the existence and contents of this agreement;

4.1.2 to the extent required by law (other than in terms of a contractual obligation of the receiving party);

a) to, and permit the use thereof by, its staff members, ministry leaders and professional advisers to the extent strictly necessary for the purpose of implementing or enforcing this agreement or obtaining professional advice or conducting its ministries, it being specifically agreed that any disclosure or use by any such staff member, ministry leader or adviser of such confidential or other information for any other purpose shall constitute a breach of this clause by the receiving party; and

b) the provisions of this clause shall cease to apply to any confidential information of a party which –

i) is or becomes generally available to the public other than as a result of a breach by the receiving party of its obligations in terms of this clause;

ii) is also received by the receiving party from a third party who did not acquire such confidential information subject to any duty of confidentiality in favour of the other party; or

iii) was known to the receiving party prior to receiving it from the other party.

4.2 This clause is severable from the remainder of the agreement and shall remain valid and binding upon the parties, notwithstanding any termination thereof.

## 5. Compliance with POPI Act

5.1 Both parties agree to comply with the Protection of Personal Information Act, 2013 (POPI Act), and any other applicable data protection laws in the handling and processing of any personal information that may be disclosed under this Agreement.

5.2 The POPI Act in South Africa primarily focuses on the protection of individuals' personal information. While the POPI Act does not explicitly address non-disclosure agreements, such as this agreement, it does establish principles and conditions for the lawful processing of personal information.

5.3 When it comes to personal information, the Act emphasizes accountability, processing, limitation, purpose specification, further processing limitation, information quality, openness, security safeguards, data subject participation and the responsible party's obligations. The principles collectively provide a framework for organizations to handle personal information responsibly and ethically.

5.4 In order to enter into this agreement in the context of compliance with the POPI Act's, the following are outlined hereunder:

**a) Purpose specification:**

i) The purpose for which personal information will be disclosed and processed is because of the sensitive nature of the parties to this agreement's work and ministry obligations. In the pursuance of the purposes, vision and public involvement of the organization, staff members, students and volunteers work with members of the public and members of other affiliated or public organizations. It is paramount for the protection and safety of those who are affected and included in the organization's work that personal information of a dangerous, exploitive or abusive nature is handled correctly and the persons affected thereby properly discipled.

ii) Also included in this, is the broader application of FIRE AND FRAGRANCE GLOBAL, LLC values to which FFSA holds and to which all staff members, students and volunteers are held. Staff and students are expected to be eager to grow in their relationship with Jesus, be teachable, and desire to be held accountable to a biblical lifestyle. The parties should uphold a high view of holiness and purity in the community, and all students and staff must agree to a specific policy around this before joining staff or student programs. FFSA upholds biblical sexuality standards and prohibit pre-marital sex, pornography, homosexual behavior, etc. as the Bible does. There are structures in place to walk a road with anyone person who is struggling in these areas and has a genuine desire to allow the Holy Spirit to work in their life unto looking more like Jesus. If the non-disclosure of information relating to any of these issues will have a detrimental effect on the overall health and safety of the majority of staff members and students, it is imperative that such information must be disclosed and addressed by the appropriate persons together with the divulging party.

**b) Security safeguards:** Security safeguards have been implemented to protect personal information against unauthorized access, disclosure, alteration, destruction and any other unlawful processing.

**c) Further Processing Limitation:** Processing of personal information has been limited to what is necessary for the purpose for which it was collected. Any further processing will be compatible with the original purpose.

**d) Responsibility:** There is a responsibility on the "responsible party" (the party collecting and determining the purpose for processing personal information) to ensure compliance with all the requirements and terms of this agreement.

## Acknowledgement of Terms and Conditions

I the undersigned hereto agree and acknowledge that I have read all the above terms and conditions of this agreement and consider myself bound to the content thereof. I acknowledge that this document will be signed by me electronically and therefore does not require my signature or initials on every page thereof. My signature at the end of this document acknowledges my full acceptance thereof.

By ticking the consent box, you accept this agreement. Your acceptance — your name, the date and time, and the version of this agreement — is recorded as your electronic signature under the Electronic Communications and Transactions Act No. 25 of 2002.

**EDT (Electronic document transmissions)** shall be deemed valid and enforceable in respect of any provisions of this Contract. As applicable, this agreement shall incorporate documents submitted and signatures appended by electronic communication as defined in the Electronic Communications and Transactions Act No. 25 of 2002 (South African Law); and any Party may request a hard copy of any document that has been previously transmitted by electronic means, provided however that any such request shall in no manner delay the parties from performing their respective obligations and duties under EDT instruments and signatures appended by 'electronic communication' as defined in the Electronic Communications and Transactions Act, No. 25 of 2002 (South African Law).
$body$,
  true
);

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT kind, version, is_current FROM public.consent_agreements ORDER BY kind;
--   -- exactly one current row per kind:
--   SELECT kind, count(*) FILTER (WHERE is_current) FROM public.consent_agreements GROUP BY kind;
-- ============================================================
