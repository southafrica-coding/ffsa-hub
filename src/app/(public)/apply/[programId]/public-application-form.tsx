"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormField } from "@/components/form/form-field";
import { ErrorSummary } from "@/components/form/error-summary";
import { buildFormSchema } from "@/lib/build-form-schema";
import {
  mapDbQuestion,
  isQuestionVisible,
  orderQuestionsForRender,
  type FormQuestion,
  type FileValue,
} from "@/lib/form-types";
import { CheckCircle2, Loader2, Copy, Check } from "lucide-react";
import {
  referenceHeadsUpNote,
  referenceSubmittedNote,
} from "@/lib/references/reference-status-copy";
import {
  identityGaps,
  isValidApplicantEmail,
  resolveApplicantIdentity,
  type IdentityQuestion,
} from "@/lib/applications/applicant-identity";
import {
  REFEREE_OTHER_PERSON_HINT,
  selfRefereeError,
} from "@/lib/references/self-referee";
import {
  confirmationSentence,
  type ConfirmationStatus,
} from "@/lib/applications/confirmation-notice";
import {
  applicationDraftKey,
  clearApplicationDraft,
  draftHasContent,
  readApplicationDraft,
  writeApplicationDraft,
} from "@/lib/applications/application-draft";

type DbQuestion = {
  id: string;
  label: string;
  description: string | null;
  type: string;
  is_required: boolean;
  options: string[] | null;
  parent_question_id?: string | null;
  show_when_answer?: string | null;
  system_key?: string | null;
};

type ReferenceSlot = {
  id: string;
  label: string;
  description: string | null;
  is_required: boolean;
};

type ReferenceLink = { label: string; url: string };

function SuccessScreen({
  programName,
  referenceLinks,
  statusUrl,
  confirmationStatus,
}: {
  programName: string;
  referenceLinks: ReferenceLink[];
  statusUrl: string | null;
  confirmationStatus: ConfirmationStatus;
}) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const hasReferences = referenceLinks.length > 0;

  function copyToClipboard(url: string, idx: number) {
    navigator.clipboard.writeText(url);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  return (
    <div className="text-center space-y-6 py-8">
      <CheckCircle2 className="h-14 w-14 text-primary mx-auto" />
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-foreground">
          Application Received
        </h2>
        {hasReferences ? (
          <>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Thank you for applying to {programName}.
              {confirmationSentence(confirmationStatus)
                ? ` ${confirmationSentence(confirmationStatus)}`
                : ""}
            </p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {referenceSubmittedNote(referenceLinks.length)}
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              You don&apos;t have an account yet — you&apos;ll receive an email
              with setup instructions once your application is accepted. Until
              then, use the tracker below to check when each reference comes in.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Thank you for applying to {programName}.
              {confirmationSentence(confirmationStatus)
                ? ` ${confirmationSentence(confirmationStatus)}`
                : ""}{" "}
              Our team will review your application and get back to you soon.
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              You don&apos;t have an account yet — you&apos;ll receive an email
              with setup instructions once your application is accepted. Until
              then, use the tracker below to check your status.
            </p>
          </>
        )}
      </div>

      {statusUrl && (
        <div className="max-w-md mx-auto">
          <Button asChild className="w-full sm:w-auto">
            <a href={statusUrl}>Track your application</a>
          </Button>
        </div>
      )}

      {referenceLinks.length > 0 && (
        <div className="space-y-3 max-w-md mx-auto text-left">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Your References
          </p>
          <p className="text-xs text-muted-foreground">
            We&apos;ve emailed each of your referees a link to submit their
            reference, so there&apos;s nothing more you need to do. If a referee
            doesn&apos;t receive it, you can share their link with them directly:
          </p>

          <div className="space-y-2">
            {referenceLinks.map((link, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded-md border bg-card p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">
                    {link.label}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {link.url}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => copyToClipboard(link.url, idx)}
                >
                  {copiedIdx === idx ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Segment = { id: string; code: string; name: string; sequence: number };

export function PublicApplicationForm({
  programId,
  programName,
  questions,
  referenceSlots = [],
  countries = [],
  consentAgreementVersion,
  segments = [],
  hasWholeProgramOption = false,
}: {
  programId: string;
  programName: string;
  questions: DbQuestion[];
  referenceSlots?: ReferenceSlot[];
  countries?: string[];
  consentAgreementVersion: string | null;
  /** Standalone segments (e.g. FFX's Q1/Q2/Q3) this program is split into. Empty for every ordinary program — the picker below then doesn't render. */
  segments?: Segment[];
  /** Whether whole-program pricing is configured, i.e. "the whole thing" is a real option alongside the segments. */
  hasWholeProgramOption?: boolean;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [applicationId, setApplicationId] = useState("");
  const [referenceLinks, setReferenceLinks] = useState<ReferenceLink[]>([]);
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const [confirmationStatus, setConfirmationStatus] = useState<ConfirmationStatus>("failed");
  const [serverError, setServerError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [refNames, setRefNames] = useState<Record<string, string>>({});
  const [refEmails, setRefEmails] = useState<Record<string, string>>({});
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [homeCountry, setHomeCountry] = useState("");
  const [homeCountryError, setHomeCountryError] = useState<string | null>(null);
  const [nationality, setNationality] = useState("");
  const [nationalityError, setNationalityError] = useState<string | null>(null);
  // Name and email are collected here when this school's questions don't
  // already ask for them. Schools that do are left alone — no second box.
  const gaps = useMemo(() => identityGaps(questions as IdentityQuestion[]), [questions]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [identityError, setIdentityError] = useState<string | null>(null);
  // Track selection (migration 221) — which segment(s), or the whole
  // program. Defaults to whole-program when that's on offer, otherwise to
  // no selection (a segment-only school must have the applicant choose).
  const [trackMode, setTrackMode] = useState<"whole_program" | "segments">(
    hasWholeProgramOption ? "whole_program" : "segments"
  );
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [trackError, setTrackError] = useState<string | null>(null);
  const showTrackPicker = segments.length > 0;

  const requiredReferenceCount = referenceSlots.filter(
    (slot) => slot.is_required
  ).length;

  // Reorder so follow-ups render directly under their parent (and indent
  // them via depthById) instead of falling to the bottom by sort_order.
  const { allQuestions, depthById } = useMemo<{
    allQuestions: FormQuestion[];
    depthById: Map<string, number>;
  }>(() => {
    const mapped = questions.map(mapDbQuestion);
    const { ordered, depthById } = orderQuestionsForRender(
      mapped,
      (q) => q.parentQuestionId
    );
    return { allQuestions: ordered, depthById };
  }, [questions]);

  const questionsById = useMemo(
    () => new Map(allQuestions.map((q) => [q.id, q])),
    [allQuestions]
  );

  const parentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const q of allQuestions) {
      if (q.parentQuestionId) ids.add(q.parentQuestionId);
    }
    return Array.from(ids);
  }, [allQuestions]);

  // System questions (Nationality / Home Country) render as dedicated
  // country dropdowns bound to their own state — keep them out of the RHF
  // schema so they aren't double-validated.
  const rhfQuestions = useMemo(
    () => allQuestions.filter((q) => !q.systemKey),
    [allQuestions]
  );

  const schema = useMemo(
    () => buildFormSchema(rhfQuestions),
    [rhfQuestions]
  );

  const defaultValues = useMemo(() => {
    const defaults: Record<string, unknown> = {};
    for (const q of rhfQuestions) {
      if (q.type === "section_header") continue;
      if (q.type === "checkbox_group") {
        defaults[q.id] = [];
      } else if (q.type === "consent") {
        defaults[q.id] = false;
      } else if (q.type === "file") {
        defaults[q.id] = null;
      } else {
        defaults[q.id] = "";
      }
    }
    return defaults;
  }, [allQuestions]);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onBlur",
  });

  // ── Draft on this device ────────────────────────────────────────────────
  // Phones reload this page on pull-to-refresh and when the browser drops a
  // background tab, which used to wipe every answer. Keep a draft in
  // localStorage, put it back on load, and remove it once submitted.
  const draftKey = applicationDraftKey(programId);
  const [draftRestored, setDraftRestored] = useState(false);
  const draftReadyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localStateRef = useRef({
    refNames,
    refEmails,
    firstName,
    lastName,
    email,
    nationality,
    homeCountry,
    trackMode,
    selectedSegmentIds,
  });
  localStateRef.current = {
    refNames,
    refEmails,
    firstName,
    lastName,
    email,
    nationality,
    homeCountry,
    trackMode,
    selectedSegmentIds,
  };

  const scheduleDraftSave = useCallback(() => {
    if (!draftReadyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      writeApplicationDraft(draftKey, {
        v: 1,
        savedAt: Date.now(),
        answers: getValues() as Record<string, unknown>,
        ...localStateRef.current,
      });
    }, 400);
  }, [draftKey, getValues]);

  // Restore once, after mount (localStorage isn't there during SSR).
  useEffect(() => {
    const draft = readApplicationDraft(draftKey);
    if (draft && draftHasContent(draft)) {
      // Only answers to questions that still exist on the form.
      const answers: Record<string, unknown> = { ...defaultValues };
      for (const id of Object.keys(defaultValues)) {
        if (id in draft.answers) answers[id] = draft.answers[id];
      }
      reset(answers);
      const slotIds = new Set(referenceSlots.map((s) => s.id));
      const keep = (r: Record<string, string>) =>
        Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => slotIds.has(k)));
      setRefNames(keep(draft.refNames));
      setRefEmails(keep(draft.refEmails));
      setFirstName(draft.firstName ?? "");
      setLastName(draft.lastName ?? "");
      setEmail(draft.email ?? "");
      if (countries.includes(draft.nationality)) setNationality(draft.nationality);
      if (countries.includes(draft.homeCountry)) setHomeCountry(draft.homeCountry);
      if (draft.trackMode === "segments" || hasWholeProgramOption) {
        setTrackMode(draft.trackMode);
      }
      const segIds = new Set(segments.map((s) => s.id));
      setSelectedSegmentIds((draft.selectedSegmentIds ?? []).filter((id) => segIds.has(id)));
      setDraftRestored(true);
    }
    draftReadyRef.current = true;
    // Run once on mount — later prop changes must not overwrite typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on every answer change (RHF fields) …
  useEffect(() => {
    const sub = watch(() => scheduleDraftSave());
    return () => sub.unsubscribe();
  }, [watch, scheduleDraftSave]);

  // … and on the fields kept in local state.
  useEffect(() => {
    scheduleDraftSave();
  }, [
    scheduleDraftSave,
    refNames,
    refEmails,
    firstName,
    lastName,
    email,
    nationality,
    homeCountry,
    trackMode,
    selectedSegmentIds,
  ]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  function startOver() {
    if (!window.confirm("Clear all your answers and start again?")) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    clearApplicationDraft(draftKey);
    reset(defaultValues);
    setRefNames({});
    setRefEmails({});
    setFirstName("");
    setLastName("");
    setEmail("");
    setNationality("");
    setHomeCountry("");
    setTrackMode(hasWholeProgramOption ? "whole_program" : "segments");
    setSelectedSegmentIds([]);
    setDraftRestored(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Watch parent answers so follow-up visibility updates live.
  const watchedParentValues = useWatch({
    control,
    name: parentIds,
  });

  const visibleQuestionIds = useMemo(() => {
    const parentValueMap: Record<string, unknown> = {};
    if (parentIds.length > 0 && Array.isArray(watchedParentValues)) {
      parentIds.forEach((id, idx) => {
        parentValueMap[id] = watchedParentValues[idx];
      });
    }
    const ids = new Set<string>();
    for (const q of allQuestions) {
      if (isQuestionVisible(q, questionsById, parentValueMap)) ids.add(q.id);
    }
    return ids;
  }, [allQuestions, questionsById, parentIds, watchedParentValues]);

  const visibleQuestions = useMemo(
    () => allQuestions.filter((q) => visibleQuestionIds.has(q.id)),
    [allQuestions, visibleQuestionIds]
  );

  async function onSubmit(data: Record<string, unknown>) {
    setServerError(null);

    if (gaps.firstName && !firstName.trim()) {
      setIdentityError("Please enter your first name.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (gaps.lastName && !lastName.trim()) {
      setIdentityError("Please enter your last name.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (gaps.email && !isValidApplicantEmail(email)) {
      setIdentityError("Please enter a valid email address.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setIdentityError(null);

    if (!nationality) {
      setNationalityError("Please select your nationality.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setNationalityError(null);

    if (!homeCountry) {
      setHomeCountryError("Please select your home country.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setHomeCountryError(null);

    if (showTrackPicker && trackMode === "segments" && selectedSegmentIds.length === 0) {
      setTrackError("Please choose at least one option.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setTrackError(null);

    const answers: Array<{
      question_id: string;
      question_label: string;
      answer: string;
    }> = [];
    if (gaps.firstName) {
      answers.push({
        question_id: "first_name",
        question_label: "First name",
        answer: firstName.trim(),
      });
    }
    if (gaps.lastName) {
      answers.push({
        question_id: "last_name",
        question_label: "Last name",
        answer: lastName.trim(),
      });
    }
    if (gaps.email) {
      answers.push({
        question_id: "email",
        question_label: "Email",
        answer: email.trim(),
      });
    }
    const files: Array<{
      questionId: string;
      storagePath: string;
      mimeType: string;
      size: number;
    }> = [];

    for (const q of allQuestions) {
      if (q.type === "section_header") continue;
      // System questions (nationality / home country) are sent separately.
      if (q.systemKey) continue;
      if (!visibleQuestionIds.has(q.id)) continue;
      const value = data[q.id];
      if (q.type === "file" && value && typeof value === "object") {
        const fv = value as FileValue;
        files.push({
          questionId: q.id,
          storagePath: fv.storagePath,
          mimeType: fv.mimeType,
          size: fv.size,
        });
        answers.push({
          question_id: q.id,
          question_label: q.label,
          answer: fv.storagePath,
        });
      } else if (q.type === "checkbox_group" && Array.isArray(value)) {
        answers.push({
          question_id: q.id,
          question_label: q.label,
          answer: (value as string[]).join(", "),
        });
      } else if (q.type === "consent") {
        answers.push({
          question_id: q.id,
          question_label: q.label,
          answer: value ? "Yes" : "No",
        });
      } else {
        answers.push({
          question_id: q.id,
          question_label: q.label,
          answer: String(value ?? ""),
        });
      }
    }

    // Required references must have both a name and an email. The server
    // enforces this too, but validate here so applicants get an inline error
    // instead of a rejected submission.
    for (const slot of referenceSlots) {
      if (
        slot.is_required &&
        (!refNames[slot.id]?.trim() || !refEmails[slot.id]?.trim())
      ) {
        setServerError(`Please provide referee details for: "${slot.label}"`);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }

    const references = referenceSlots
      .filter(
        (slot) =>
          refNames[slot.id]?.trim() && refEmails[slot.id]?.trim()
      )
      .map((slot) => ({
        slot_id: slot.id,
        referee_name: refNames[slot.id].trim(),
        referee_email: refEmails[slot.id].trim(),
      }));

    const identity = resolveApplicantIdentity({
      questions,
      answers,
      firstName: gaps.firstName ? firstName : undefined,
      lastName: gaps.lastName ? lastName : undefined,
      email: gaps.email ? email : undefined,
    });
    if (identity.ok) {
      const selfReferee = selfRefereeError(
        references,
        [identity.identity.email],
        referenceSlots
      );
      if (selfReferee) {
        setServerError(selfReferee);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }

    if (!consentAccepted) {
      setConsentError("Please accept the Privacy & Data Processing Agreement to submit your application.");
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      return;
    }
    setConsentError(null);

    try {
      const res = await fetch("/api/public/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program_id: programId,
          answers,
          references,
          nationality,
          home_country: homeCountry,
          first_name: gaps.firstName ? firstName.trim() : undefined,
          last_name: gaps.lastName ? lastName.trim() : undefined,
          email: gaps.email ? email.trim() : undefined,
          track_choice: showTrackPicker
            ? trackMode === "whole_program"
              ? { whole_program: true, segment_ids: [] }
              : { whole_program: false, segment_ids: selectedSegmentIds }
            : undefined,
          files: files.length > 0 ? files : undefined,
          consent_version: consentAgreementVersion,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setServerError(result.error || "Failed to submit application");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      setApplicationId(result.id);
      setReferenceLinks(result.referenceLinks ?? []);
      setStatusUrl(result.statusUrl ?? null);
      setConfirmationStatus(
        result.confirmationStatus === "sent" || result.confirmationStatus === "skipped"
          ? result.confirmationStatus
          : "failed"
      );
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      draftReadyRef.current = false;
      clearApplicationDraft(draftKey);
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setServerError("Network error. Please try again.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function onError() {
    setHasAttemptedSubmit(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (submitted) {
    return (
      <SuccessScreen
        programName={programName}
        referenceLinks={referenceLinks}
        statusUrl={statusUrl}
        confirmationStatus={confirmationStatus}
      />
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, onError)}
      className="space-y-8"
      noValidate
    >
      {draftRestored && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-4">
          <p className="text-sm text-foreground">
            We kept the answers you started on this device.
          </p>
          <button
            type="button"
            onClick={startOver}
            className="ffsa-public-btn-ghost text-sm text-muted-foreground underline underline-offset-2"
          >
            Start over
          </button>
        </div>
      )}

      {serverError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{serverError}</p>
        </div>
      )}

      {hasAttemptedSubmit && Object.keys(errors).length > 0 && (
        <ErrorSummary errors={errors} questions={allQuestions} />
      )}

      {(gaps.firstName || gaps.lastName || gaps.email) && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h2 className="font-semibold text-foreground">Your details</h2>
          {identityError && <p className="text-sm text-destructive">{identityError}</p>}
          {gaps.firstName && (
            <div className="space-y-1.5">
              <Label htmlFor="identity_first_name">
                First name
                <span className="text-destructive ml-0.5">*</span>
              </Label>
              <Input
                id="identity_first_name"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  if (e.target.value.trim()) setIdentityError(null);
                }}
                required
              />
            </div>
          )}
          {gaps.lastName && (
            <div className="space-y-1.5">
              <Label htmlFor="identity_last_name">
                Last name
                <span className="text-destructive ml-0.5">*</span>
              </Label>
              <Input
                id="identity_last_name"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  if (e.target.value.trim()) setIdentityError(null);
                }}
                required
              />
            </div>
          )}
          {gaps.email && (
            <div className="space-y-1.5">
              <Label htmlFor="identity_email">
                Email
                <span className="text-destructive ml-0.5">*</span>
              </Label>
              <Input
                id="identity_email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (isValidApplicantEmail(e.target.value)) setIdentityError(null);
                }}
                required
              />
            </div>
          )}
        </div>
      )}

      {/* Application Questions — includes the locked system fields
          (Nationality / Home Country) at whatever position they're ordered. */}
      {visibleQuestions.length > 0 && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          {visibleQuestions.map((q) => {
            const depth = depthById.get(q.id) ?? 0;

            // System country fields render as tier-list dropdowns bound to
            // their own state (nationality drives fee tier; home country for
            // records). Their label/help text come from the (editable) question.
            if (q.systemKey === "nationality" || q.systemKey === "home_country") {
              const isNat = q.systemKey === "nationality";
              const value = isNat ? nationality : homeCountry;
              const err = isNat ? nationalityError : homeCountryError;
              const setter = isNat ? setNationality : setHomeCountry;
              const clearErr = isNat ? setNationalityError : setHomeCountryError;
              return (
                <div key={q.id} className="space-y-2">
                  <Label htmlFor={q.id}>
                    {q.label}
                    <span className="text-destructive ml-0.5">*</span>
                  </Label>
                  {q.helpText && (
                    <p className="text-xs text-muted-foreground">{q.helpText}</p>
                  )}
                  <select
                    id={q.id}
                    value={value}
                    onChange={(e) => {
                      setter(e.target.value);
                      if (e.target.value) clearErr(null);
                    }}
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="" disabled>
                      Select…
                    </option>
                    {countries.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {err && <p className="text-sm text-destructive">{err}</p>}
                </div>
              );
            }

            return (
              <div
                key={q.id}
                style={depth > 0 ? { marginLeft: `${depth * 16}px` } : undefined}
              >
                <FormField
                  question={q}
                  control={control}
                  applicationId={applicationId || programId}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Track selection (migration 221) — only for a school split into
          standalone segments, e.g. FFX's Q1/Q2/Q3. */}
      {showTrackPicker && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h2 className="font-semibold text-foreground">Which part are you applying for?</h2>
          <div className="space-y-2">
            {hasWholeProgramOption && (
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="radio"
                  name="track_mode"
                  checked={trackMode === "whole_program"}
                  onChange={() => {
                    setTrackMode("whole_program");
                    setTrackError(null);
                  }}
                  className="mt-0.5"
                />
                <span>The whole programme</span>
              </label>
            )}
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="radio"
                name="track_mode"
                checked={trackMode === "segments"}
                onChange={() => {
                  setTrackMode("segments");
                  setTrackError(null);
                }}
                className="mt-0.5"
              />
              <span>One or more individual sections</span>
            </label>
          </div>
          {trackMode === "segments" && (
            <div className="ml-6 space-y-2 border-l pl-4">
              {segments.map((s) => (
                <label key={s.id} className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedSegmentIds.includes(s.id)}
                    onChange={(e) => {
                      setSelectedSegmentIds((prev) =>
                        e.target.checked
                          ? [...prev, s.id]
                          : prev.filter((id) => id !== s.id)
                      );
                      setTrackError(null);
                    }}
                    className="mt-0.5"
                  />
                  <span>{s.name}</span>
                </label>
              ))}
            </div>
          )}
          {trackError && <p className="text-sm text-destructive">{trackError}</p>}
        </div>
      )}

      {/* References */}
      {referenceSlots.length > 0 && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h2 className="font-semibold text-foreground">References</h2>
          <p className="text-sm text-muted-foreground">
            Please provide contact details for the following references. They
            will receive an email with a link to submit their reference.
          </p>
          {requiredReferenceCount > 0 && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
              {referenceHeadsUpNote(requiredReferenceCount)}
            </p>
          )}

          {referenceSlots.map((slot) => (
            <div key={slot.id} className="space-y-3 rounded-md border p-4">
              <div>
                <p className="text-sm font-medium">
                  {slot.label}
                  {slot.is_required && (
                    <span className="text-destructive ml-0.5">*</span>
                  )}
                </p>
                {slot.description && (
                  <p className="text-xs text-muted-foreground">
                    {slot.description}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`ref_${slot.id}_name`}>
                    Referee Name
                    {slot.is_required && (
                      <span className="text-destructive ml-0.5">*</span>
                    )}
                  </Label>
                  <Input
                    id={`ref_${slot.id}_name`}
                    placeholder="Full name"
                    value={refNames[slot.id] ?? ""}
                    onChange={(e) =>
                      setRefNames((prev) => ({
                        ...prev,
                        [slot.id]: e.target.value,
                      }))
                    }
                    required={slot.is_required}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`ref_${slot.id}_email`}>
                    Referee Email
                    {slot.is_required && (
                      <span className="text-destructive ml-0.5">*</span>
                    )}
                  </Label>
                  <Input
                    id={`ref_${slot.id}_email`}
                    type="email"
                    placeholder="referee@email.com"
                    value={refEmails[slot.id] ?? ""}
                    onChange={(e) =>
                      setRefEmails((prev) => ({
                        ...prev,
                        [slot.id]: e.target.value,
                      }))
                    }
                    required={slot.is_required}
                  />
                  <p className="text-xs text-muted-foreground">{REFEREE_OTHER_PERSON_HINT}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Consent */}
      <div className="rounded-lg border bg-card p-6 space-y-3">
        <h2 className="font-semibold text-foreground">Privacy & Data Processing</h2>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={consentAccepted}
            onChange={(e) => {
              setConsentAccepted(e.target.checked);
              if (e.target.checked) setConsentError(null);
            }}
            className="mt-1 h-4 w-4 shrink-0"
            required
          />
          <span className="text-sm text-foreground/90">
            I have read and agree to the{" "}
            <a
              href="/legal/consent"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-primary"
            >
              FFSA Privacy & Data Processing Agreement
            </a>
            . I consent to FFSA collecting, storing, and using my personal
            information for the purposes described in the agreement, including
            contacting the references I have listed, and to receiving
            communications from FFSA related to my application and programs.
            <span className="text-destructive ml-0.5">*</span>
          </span>
        </label>
        {consentError && (
          <p className="text-sm text-destructive">{consentError}</p>
        )}
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : (
          "SUBMIT APPLICATION"
        )}
      </Button>
    </form>
  );
}

