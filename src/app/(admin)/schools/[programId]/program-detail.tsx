"use client";

import {
  APPLICATIONS_STATUS_UNKNOWN_MESSAGE,
  type ApplicationExpiry,
} from "@/lib/auth/application-expiry";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { type TreeQuestion } from "@/components/admin/question-tree";
import { ReferenceQuestionsBuilder } from "./reference-questions-builder";
import { ProgramCoursesManager, type PhaseCourse } from "./program-courses-manager";
import { LeadersTab, type ProgramLeaderRow } from "./leaders-tab";
import { StaffTab, type ProgramStaffRow } from "./staff-tab";
import { ClassroomTab } from "./classroom-tab";
import { AssignmentsSection } from "@/components/schools/lms/assignments-section";
import { EmailsTab } from "./emails-tab";
import { StudentsExportPanel } from "./students-export-panel";
import { ENROLLMENT_STATUS_LABELS } from "@/lib/schools/student-export-columns";
import type { ArrivalInsuranceInfo } from "@/lib/schools/arrival-insurance";
import { Badge } from "@/components/ui/badge";
import {
  badgeVariant,
  presentationForMessage,
} from "@/lib/email/delivery-state";
import {
  REFERENCE_BOUNCE_MESSAGE,
  REFERENCE_NOT_SENT_MESSAGE,
} from "@/lib/references/reference-delivery";
import { Chip, Masthead, StatusPill } from "@/components/ffsa";
import { TrackTab } from "./track-tab";
import type { PipelinePerson, TrackSummary } from "@/lib/schools/track-pipeline";
import { RosterTab, AddStudentButton, type RosterFee, type RosterFilter, type RosterTrack } from "./roster-tab";
import { OverviewTab, type OverviewRow } from "./overview-tab";
import {
  arrivalsFor,
  coursesOnTrack,
  focusCourse,
  studentStatus,
  type CourseArrivalStatus,
  type SchoolCourse,
} from "@/lib/schools/course-arrival";
import { todayInSouthAfrica } from "@/lib/finance/student-balance";
import { GradesMatrix } from "./grades-matrix";
import { ApplicantReview, type PipelineStage, type ReviewCheck, type ShownInterviewReview } from "./applicant-review";
import {
  INTERVIEW_OUTCOME_LABEL,
  type InterviewOutcome,
} from "@/lib/schools/interview-outcomes";
import {
  draftFromSaved,
  emptyInterviewDraft,
  interviewClearFlags,
  interviewFormFromReview,
  nextDraftAfterLoad,
  reconcileInterviewDraft,
  savedInterviewFor,
  type InterviewDraft,
} from "@/lib/schools/interview-review-form";
import {
  PIPELINE_STAGE_LABEL,
  PIPELINE_STAGE_ORDER,
  PIPELINE_TABS,
  decisionChoices,
  decisionSelectValue,
  derivePipelineStage,
  interviewOutcomeBadge,
  statusToPersist,
  statusWrittenByDecision,
  type DecisiveInterviewOutcome,
  type InterviewReviewFact,
  type ReferenceRequestFact,
} from "@/lib/schools/applicant-pipeline-stage";
import { LastReminderSent } from "@/lib/references/last-reminder-sent";
import { remindAllToast } from "@/lib/references/manual-reminder";
import { BULK_STATUS_LIMIT, isBeforeAcceptance } from "@/lib/schools/application-status";
import { FormBuilder, FormPreview } from "./form-builder";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Download, Edit2, ClipboardList, Copy, Check, Link as LinkIcon, Archive, BookTemplate, Upload, Loader2, FileText, Send, MailCheck, BarChart3, Calendar, RefreshCw, Search, Users, AlertTriangle, ShieldCheck } from "lucide-react";
import { ProgramActions } from "../program-actions";

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

type Course = {
  id: string;
  name: string;
  code: string;
  credit_hours: number;
  sort_order: number;
};

type StaffUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
};

type Enrollment = {
  id: string;
  /**
   * NULL once the person's account has been deleted. Migration 207 orphans the
   * enrolment instead of destroying it; the server rebuilds `users` below from
   * the identity snapshot on the row, so the name still renders.
   */
  user_id: string | null;
  status: string;
  enrolled_at: string;
  removed_at: string | null;
  removed_by: string | null;
  assigned_staff_id: string | null;
  assigned_staff: StaffUser | null;
  insurance_verified_at: string | null;
  insurance_verified_by: string | null;
  /** Track of record (migration 221) — empty for every ordinary program. */
  enrollment_segments: Array<{
    billing_course_id: string | null;
    billing_courses: { code: string; name: string } | null;
  }>;
  users: {
    id: string | null;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
    /** The roster's FROM column (frame 14a). */
    nationality?: string | null;
  };
};

type GradeRow = {
  id: string;
  enrollment_id: string;
  course_id: string;
  letter_grade: string | null;
  courses: Course;
  enrollments: {
    id: string;
    user_id: string;
    program_id: string;
  };
};

type UserOption = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
};

type Program = {
  id: string;
  name: string;
  code: string;
  credit_hours: number;
  status: string;
  /** 'external' means the school is billed outside the Hub — see frame 14a. */
  billing_mode?: string | null;
  description: string | null;
  application_open: boolean;
  application_deadline: string | null;
  acceptance_email_subject: string | null;
  acceptance_email_body: string | null;
  /** Override for when accepted applicants get their HUB setup link (migration 230). */
  setup_invite_date?: string | null;
  courses: Course[];
};

type AppQuestion = {
  id: string;
  program_id: string;
  label: string;
  description: string | null;
  type: string;
  sort_order: number;
  is_required: boolean;
  options: string[] | null;
  parent_question_id: string | null;
  show_when_answer: string | null;
};

type ReferenceSlot = {
  id: string;
  program_id: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_required: boolean;
};

type ReferenceRequest = {
  id: string;
  application_id: string;
  slot_id: string;
  referee_name: string;
  referee_email: string;
  status: string;
  relationship: string | null;
  known_duration: string | null;
  reference_text: string | null;
  submitted_at: string | null;
  reminder_sent_at?: string | null;
  form_data: Record<string, any> | null;
  reference_slots: { label: string; description: string | null } | null;
  email_problem?: "bounced" | "not_sent" | null;
};

type ApplicantInfo = {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  date_of_birth?: string;
  gender?: string;
  nationality?: string;
  country?: string;
  city?: string;
};

type AppResponse = {
  id: string;
  program_id: string;
  user_id: string | null;
  applicant_email: string | null;
  applicant_info: ApplicantInfo | null;
  answers: Array<{ question_id: string; question_label: string; answer: string }>;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  admin_notes: string | null;
  submitted_at: string;
  removed_at: string | null;
  removed_by: string | null;
  references_requested_at: string | null;
  assigned_staff_id: string | null;
  assigned_staff: StaffUser | null;
  users: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
  } | null;
};

// ────────────────────────────────────────────────────────────
// STORAGE IMAGE COMPONENT
// ────────────────────────────────────────────────────────────

function formatExpiryDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function StorageImage({
  storagePath,
  applicationId,
}: {
  storagePath: string;
  applicationId: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [isHeic, setIsHeic] = useState(false);

  useEffect(() => {
    async function fetchUrl() {
      try {
        const res = await fetch(
          `/api/upload/view?path=${encodeURIComponent(storagePath)}&applicationId=${encodeURIComponent(applicationId)}`
        );
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        setUrl(data.url);
        setIsHeic(data.isHeic ?? false);
      } catch {
        setFetchError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchUrl();
  }, [storagePath, applicationId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading photo…
      </div>
    );
  }

  if (fetchError || !url) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Unable to load photo
      </p>
    );
  }

  // If the image failed to render (e.g. HEIC not supported), show download link
  if (imgError) {
    return (
      <div className="space-y-2 border border-dashed border-muted-foreground/30 p-4">
        <p className="text-sm text-muted-foreground">
          This photo is in HEIC format and cannot be previewed in the browser.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-[#262622]"
        >
          <Download className="h-3.5 w-3.5" /> Download Photo
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Applicant photo"
        className="max-w-[200px] max-h-[250px] border object-cover"
        onError={() => setImgError(true)}
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-electric hover:underline"
      >
        <Download className="h-3 w-3" /> View full size
      </a>
    </div>
  );
}

function isStoragePath(value: string): boolean {
  return value.startsWith("applications/") && value.length > 20;
}

// ────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────

type RefRequestSummary = {
  id: string;
  application_id: string;
  slot_id: string;
  status: string;
  submitted_at: string | null;
  reminder_sent_at: string | null;
};

type InterviewReviewSummary = {
  application_response_id: string;
  author_id?: string | null;
  notes?: string | null;
  interview_outcome: string | null;
  updated_at: string | null;
};

/** Tabs this screen knows. `enrollments` is the pre-14a name for Students and
 *  is still in the wild as ?tab=enrollments, so it maps rather than 404s. */
const TAB_KEYS = [
  "overview", "students", "courses", "track", "grades", "applicants", "application", "arrival", "leaders", "staff", "emails", "fees",
  "staff_decision", "classroom",
];
function normaliseTab(tab: string): string {
  return tab === "enrollments" ? "students" : tab;
}

function displayName(u: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
}): string {
  const first = u.first_name || "";
  const name = `${first} ${u.last_name ?? ""}`.trim();
  return name || u.email || "Unknown";
}

/** Track of record (migration 221) → the roster's small track tag. Empty for every ordinary program. */
/**
 * A student's track for the roster: their enrolment's own track first (what
 * billing reads), else what the Track tab knows from their application or
 * survey answer.
 */
function rosterTrack(
  segments: Array<{ billing_course_id: string | null; billing_courses: { code: string; name: string } | null }>,
  fromPipeline: RosterTrack | undefined
): RosterTrack {
  if (segments.length > 0) {
    if (segments.some((s) => s.billing_course_id === null)) return { kind: "whole", codes: [] };
    return {
      kind: "segments",
      codes: segments.map((s) => s.billing_courses?.code).filter((c): c is string => !!c),
    };
  }
  return fromPipeline ?? { kind: "unknown", codes: [] };
}

export function ProgramDetail({
  program,
  initialTab,
  enrollments,
  trackSegments,
  trackPeople,
  trackSummary,
  arrivalInsurance,
  leaders,
  staff,
  emailTemplates,
  grades,
  feesByEnrollment,
  feesBilledOutside,
  courseArrivals,
  feesPanel,
  gradesLastEdit,
  allUsers,
  staffOptions,
  billingCourses,
  courseStaff,
  questions,
  responses,
  removedResponses,
  referenceSlots,
  referenceQuestions,
  refRequestSummaries,
  interviewReviews = [],
  viewerId,
  applicationExpiry,
  staffDecisionPanel,
  canEditClassroom = false,
  canManageTemplates = false,
  canGradeAssignments = false,
}: {
  program: Program;
  initialTab?: string;
  /** Segments + who is doing which (empty unless the school is split into segments). */
  trackSegments: Array<{ code: string; name: string }>;
  trackPeople: PipelinePerson[];
  trackSummary: TrackSummary;
  enrollments: Enrollment[];
  arrivalInsurance: Record<string, ArrivalInsuranceInfo>;
  leaders: ProgramLeaderRow[];
  staff: ProgramStaffRow[];
  emailTemplates: {
    email_type: string;
    enabled: boolean;
    subject: string | null;
    body: string | null;
    reminder_after_days: number | null;
  }[];
  grades: GradeRow[];
  feesByEnrollment: Record<string, RosterFee>;
  /** billing_mode = 'external': fees live outside the Hub, so there are no numbers. */
  feesBilledOutside: boolean;
  /** Arrival marks per course (migration 259), by enrolment id. */
  courseArrivals: Record<string, Array<{ billing_course_id: string; status: CourseArrivalStatus }>>;
  /** The school's fee settings (server-rendered SchoolFeesPanel), shown as
   *  the Fees tab so they can be managed without leaving Training. */
  feesPanel: React.ReactNode;
  gradesLastEdit: { at: string; by: string } | null;
  allUsers: UserOption[];
  staffOptions: StaffUser[];
  billingCourses: PhaseCourse[];
  courseStaff: Parameters<typeof ProgramCoursesManager>[0]["staff"];
  questions: AppQuestion[];
  responses: AppResponse[];
  removedResponses: AppResponse[];
  referenceSlots: ReferenceSlot[];
  referenceQuestions: TreeQuestion[];
  refRequestSummaries: RefRequestSummary[];
  interviewReviews?: InterviewReviewSummary[];
  /** Signed-in reviewer. Used to prefill their own interview row. */
  viewerId: string;
  applicationExpiry: ApplicationExpiry;
  /** Leadership Track only, and only for Leadership Team viewers — the
   *  server-rendered "accepted as staff?" tab. Absent = no tab. */
  staffDecisionPanel?: React.ReactNode;
  /** LMS slice 1: leaders / managers (userCanManageProgram) get the Classroom
   *  editor. */
  canEditClassroom?: boolean;
  /** Admin or unscoped schools.manage / schools.templates.manage. Scoped managers can still import. */
  canManageTemplates?: boolean;
  /** LMS slice 2: program staff who reach this page (e.g. they also hold a
   *  schools.* grant) get Classroom → Assignments to grade, without the
   *  content editor. Everyone else sees no Classroom tab. */
  canGradeAssignments?: boolean;
}) {
  const router = useRouter();
  const [editingProgram, setEditingProgram] = useState(false);
  const [progName, setProgName] = useState(program.name);
  const [progCode, setProgCode] = useState(program.code);
  const [progDescription, setProgDescription] = useState(program.description ?? "");
  const [progCreditHours, setProgCreditHours] = useState(String(program.credit_hours));
  const [progSaving, setProgSaving] = useState(false);
  const [progError, setProgError] = useState<string | null>(null);

  async function handleSaveProgram(e: React.FormEvent) {
    e.preventDefault();
    setProgSaving(true);
    setProgError(null);
    try {
      const res = await fetch("/api/schools/programs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: program.id,
          name: progName,
          code: progCode,
          description: progDescription || null,
          credit_hours: parseInt(progCreditHours) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProgError(data.error || "Failed to update program");
        return;
      }
      setEditingProgram(false);
      router.refresh();
    } catch {
      setProgError("Network error");
    } finally {
      setProgSaving(false);
    }
  }

  // ── Roster (frame 14a) ──
  const activeEnrollments = enrollments.filter((e) => !e.removed_at);
  const pipelineTrack = new Map<string, RosterTrack>(
    trackPeople
      .filter((p) => p.enrollmentId && p.track.kind !== "unknown")
      .map((p) => [p.enrollmentId as string, { kind: p.track.kind, codes: p.track.codes }])
  );
  // ── Per-course status (migration 259) ──
  // Only a school split into courses (FFX) marks arrival per course; every
  // other school keeps its single school-wide status.
  const today = todayInSouthAfrica();
  const schoolCourses: SchoolCourse[] = billingCourses.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    sequence: c.sequence,
    start_date: c.start_date,
    end_date: c.end_date,
    graded: (c as { graded?: boolean }).graded ?? true,
  }));
  const segmentCodes = new Set(trackSegments.map((s) => s.code));
  const segmentCourses = schoolCourses.filter((c) => segmentCodes.has(c.code));
  const overviewRows: OverviewRow[] = enrollments.map((e) => {
    const track = rosterTrack(e.enrollment_segments, pipelineTrack.get(e.id));
    const mine = coursesOnTrack(track, segmentCourses);
    const arrivals = arrivalsFor(e.status, courseArrivals[e.id] ?? [], mine, today);
    const letters = new Map(
      grades
        .filter((g) => g.enrollment_id === e.id && g.letter_grade)
        .map((g) => [g.course_id, g.letter_grade as string])
    );
    const gradedOnTrack = mine.filter((c) => c.graded && letters.has(c.id));
    return {
      enrollmentId: e.id,
      userId: e.user_id,
      name: displayName(e.users),
      from: e.users.nationality ?? null,
      status: studentStatus({ enrollmentStatus: e.status, track, courses: segmentCourses, arrivals, today }),
      staffId: e.assigned_staff_id,
      staffName: e.assigned_staff ? displayName(e.assigned_staff) : null,
      fee: feesByEnrollment[e.id] ?? { label: "—", owed: false },
      grades: gradedOnTrack.map((c) => ({ code: c.code, letter: letters.get(c.id)! })),
      removed: !!e.removed_at,
      track,
      courseIds: mine.map((c) => c.id),
      arrivals: Object.fromEntries(arrivals),
    };
  });
  const [tab, setTab] = useState(() => {
    const wanted = initialTab ? normaliseTab(initialTab) : "overview";
    if (!TAB_KEYS.includes(wanted)) return "overview";
    if (wanted === "classroom" && !canEditClassroom && !canGradeAssignments) return "overview";
    return wanted;
  });
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>("all");
  const rosterStaffOptions = staffOptions
    .map((s) => ({ id: s.id, name: displayName(s) }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  // A removed enrolment still holds the unique (user, program) slot, so a
  // removed student stays out of this list until restored or deleted.
  const enrolledUserIds = new Set(enrollments.map((e) => e.user_id));
  // Sorted by the name the picker actually shows. The query orders by
  // last_name, but displayName() leads with the preferred/first name, so the
  // list looked unordered to anyone scanning it for a person.
  const enrollableUsers = allUsers
    .filter((u) => !enrolledUserIds.has(u.id))
    .map((u) => ({ id: u.id, name: displayName(u), email: u.email }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  // Everyone carrying this school: the named leaders plus anyone walking with a
  // student, counted once even when they are both.
  const staffOnSchool = new Set<string>([
    ...leaders.map((l) => l.user_id),
    ...activeEnrollments.map((e) => e.assigned_staff_id).filter((id): id is string => !!id),
  ]).size;

  // ── Masthead facts line (frame 14a) ──
  // Dates come off the course run rather than a field on the program, because
  // the run is what actually defines when a school starts and ends.
  const dated = billingCourses.filter((c) => c.start_date && c.end_date);
  const runStart = dated.length
    ? dated.reduce((a, c) => (a.start_date! < c.start_date! ? a : c)).start_date!
    : null;
  const runEnd = dated.length
    ? dated.reduce((a, c) => (a.end_date! > c.end_date! ? a : c)).end_date!
    : null;
  const runWeeks =
    runStart && runEnd
      ? Math.max(1, Math.round((new Date(runEnd).getTime() - new Date(runStart).getTime()) / (86_400_000 * 7)))
      : null;
  const monthYear = (iso: string) =>
    new Date(iso).toLocaleDateString("en-ZA", { month: "short", year: "numeric" }).toUpperCase();
  const factsLine = [
    runStart && runEnd ? `${monthYear(runStart)} – ${monthYear(runEnd)}` : null,
    runWeeks ? `${runWeeks} WEEKS` : null,
    `${billingCourses.length} ${billingCourses.length === 1 ? "COURSE" : "COURSES"}`,
    `${program.credit_hours} CREDIT HOURS`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Training / ${program.code}`}
        title={program.name}
        actions={
          <>
            <StatusPill tone={program.status === "active" ? "good" : "quiet"}>
              {program.status}
            </StatusPill>
            <Button variant="outline" size="sm" onClick={() => setEditingProgram(true)}>
              <Edit2 className="mr-1 h-3 w-3" /> Edit
            </Button>
            <AddStudentButton programId={program.id} options={enrollableUsers} />
            <ProgramActions program={program} variant="button" redirectAfterDelete />
          </>
        }
      />

      {/* The frame's mono line under the title: when this school runs. */}
      <div className="border-b border-rule bg-white px-5 pb-3 md:px-8">
        <span className="font-mono text-[10px] font-bold tracking-[0.14em] text-[color:var(--text-secondary)]">
          {factsLine}
        </span>
      </div>

      {/* A state, not a task — so it stays bone. The yellow band is reserved
          for something actually waiting on you. */}
      {program.status === "archived" && (
        <div className="flex items-center gap-3 border-b border-ink bg-bone px-5 py-3 md:px-8">
          <Archive className="h-4 w-4 shrink-0 text-[color:var(--text-secondary)]" />
          <p className="text-[13px] text-[color:var(--text-secondary)]">
            This program is archived. It is hidden from non-admin users and no new enrollments can be made.
          </p>
        </div>
      )}

      {program.description && (
        <div className="border-b border-rule bg-white px-5 py-3 md:px-8">
          <p className="max-w-3xl text-[13px] text-[color:var(--text-secondary)]">
            {program.description}
          </p>
        </div>
      )}

      {/* Edit Program Dialog */}
      <Dialog open={editingProgram} onOpenChange={setEditingProgram}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Program Details</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveProgram} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Program Name *</Label>
              <Input required value={progName} onChange={(e) => setProgName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input required value={progCode} onChange={(e) => setProgCode(e.target.value)} className="uppercase" />
              </div>
              <div className="space-y-1.5">
                <Label>Credit Hours</Label>
                <Input type="number" min="0" value={progCreditHours} onChange={(e) => setProgCreditHours(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={progDescription} onChange={(e) => setProgDescription(e.target.value)} rows={3} placeholder="Optional program description" />
            </div>
            {progError && <p className="text-sm text-destructive">{progError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingProgram(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={progSaving}>{progSaving ? "Saving..." : "Save Changes"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="border-b border-ink bg-white px-5 pt-4 md:px-8">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="students">Students ({activeEnrollments.length})</TabsTrigger>
            <TabsTrigger value="courses">Courses ({billingCourses.length})</TabsTrigger>
            {(canEditClassroom || canGradeAssignments) && <TabsTrigger value="classroom">Classroom</TabsTrigger>}
            {trackSegments.length > 0 && (
              <TabsTrigger value="track">Track ({trackSummary.confirmed}/{trackSummary.total})</TabsTrigger>
            )}
            <TabsTrigger value="grades">Grades</TabsTrigger>
            <TabsTrigger value="applicants">Applicants ({responses.length})</TabsTrigger>
            <TabsTrigger value="application">Application form</TabsTrigger>
            <TabsTrigger value="arrival">Arrival</TabsTrigger>
            <TabsTrigger value="leaders">Leaders ({leaders.length})</TabsTrigger>
            <TabsTrigger value="staff">Staff ({staff.length})</TabsTrigger>
            <TabsTrigger value="emails">Emails</TabsTrigger>
            <TabsTrigger value="fees">Fees</TabsTrigger>
            {staffDecisionPanel && (
              <TabsTrigger value="staff_decision">Staff decision</TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-0">
          <OverviewTab
            rows={overviewRows.filter((r) => !r.removed)}
            courses={segmentCourses.length > 0 ? segmentCourses : schoolCourses}
            trackSegments={trackSegments}
            staffOnSchool={staffOnSchool}
            feesBilledOutside={feesBilledOutside}
            today={today}
            onOpenStudents={(f) => {
              setRosterFilter(f);
              setTab("students");
            }}
          />
        </TabsContent>

        <TabsContent value="students" className="mt-0">
          <RosterTab
            rows={overviewRows}
            staffOptions={rosterStaffOptions}
            trackSegments={trackSegments}
            filter={rosterFilter}
            onFilterChange={setRosterFilter}
            feesBilledOutside={feesBilledOutside}
            actions={
              <StudentsExportPanel programId={program.id} enrollments={enrollments} />
            }
          />
        </TabsContent>

        <TabsContent value="fees" className="mt-0 px-5 py-6 md:px-8">
          {feesPanel}
        </TabsContent>

        <TabsContent value="courses" className="mt-0 px-5 py-6 md:px-8">
          <ProgramCoursesManager
            programId={program.id}
            courses={billingCourses}
            staff={courseStaff}
          />
        </TabsContent>

        {(canEditClassroom || canGradeAssignments) && (
          <TabsContent value="classroom" className="mt-0 px-5 py-6 md:px-8">
            {canEditClassroom ? (
              <ClassroomTab programId={program.id} />
            ) : (
              <AssignmentsSection programId={program.id} canEdit={false} />
            )}
          </TabsContent>
        )}

        {/* Frame 14b */}
        {trackSegments.length > 0 && (
          <TabsContent value="track" className="mt-0">
            <TrackTab
              programId={program.id}
              segments={trackSegments}
              summary={trackSummary}
              people={trackPeople}
            />
          </TabsContent>
        )}

        <TabsContent value="grades" className="mt-0 px-5 py-6 md:px-8">
          <GradesMatrix
            programId={program.id}
            programCode={program.code}
            // Only graded courses get a column — FFX is never graded.
            courses={billingCourses.filter((c) => (c as { graded?: boolean }).graded !== false).map((c) => ({
              id: c.id,
              code: c.code,
              name: c.name,
              credit_hours: (c as { credit_hours?: number }).credit_hours ?? 0,
            }))}
            students={activeEnrollments.map((e) => ({
              enrollmentId: e.id,
              userId: e.user_id,
              name: displayName(e.users),
            }))}
            grades={grades.map((g) => ({
              enrollment_id: g.enrollment_id,
              course_id: g.course_id,
              letter_grade: g.letter_grade,
            }))}
            lastEdit={gradesLastEdit}
          />
        </TabsContent>

        <TabsContent value="applicants" className="mt-0 px-5 py-6 md:px-8">
          {applicationExpiry.lookupFailed ? (
            <p className="mb-4 border border-ink bg-muted px-4 py-3 text-[13px]">
              {APPLICATIONS_STATUS_UNKNOWN_MESSAGE}
            </p>
          ) : applicationExpiry.expired && (
            <p className="mb-4 border border-ink bg-muted px-4 py-3 text-[13px]">
              {applicationExpiry.canAccess
                ? `Archived on ${formatExpiryDate(applicationExpiry.expiresOn)} — only admins and the Training team can see these applications.`
                : `Applications for this school were archived on ${formatExpiryDate(applicationExpiry.expiresOn)}. Contact the Training team for access.`}
            </p>
          )}
          {!applicationExpiry.lookupFailed && (!applicationExpiry.expired || applicationExpiry.canAccess) && (
          <ApplicantsTab
            programId={program.id}
            programCode={program.code}
            responses={responses}
            removedResponses={removedResponses}
            referenceSlots={referenceSlots}
            refRequestSummaries={refRequestSummaries}
            pipelineReviews={interviewReviews}
            viewerId={viewerId}
            staffOptions={staffOptions}
          />
          )}
        </TabsContent>

        <TabsContent value="application" className="mt-0">
          <ApplicationTab
            programId={program.id}
            programCode={program.code}
            programName={program.name}
            applicationOpen={program.application_open}
            applicationDeadline={program.application_deadline}
            questions={questions}
            referenceSlots={referenceSlots}
            referenceQuestions={referenceQuestions}
            canManageTemplates={canManageTemplates}
          />
        </TabsContent>

        <TabsContent value="arrival" className="mt-0 px-5 py-6 md:px-8">
          <ArrivalTab
            enrollments={enrollments}
            arrivalInsurance={arrivalInsurance}
            courses={segmentCourses}
            focusCourseId={focusCourse(segmentCourses, today)?.id ?? null}
            studentCourses={Object.fromEntries(overviewRows.map((r) => [r.enrollmentId, { courseIds: r.courseIds, arrivals: r.arrivals }]))}
          />
        </TabsContent>

        <TabsContent value="leaders" className="mt-0 px-5 py-6 md:px-8">
          <LeadersTab
            programId={program.id}
            leaders={leaders}
            allUsers={allUsers}
          />
        </TabsContent>

        <TabsContent value="staff" className="mt-0 px-5 py-6 md:px-8">
          <StaffTab
            programId={program.id}
            staff={staff}
            allUsers={allUsers}
          />
        </TabsContent>

        {staffDecisionPanel && (
          <TabsContent value="staff_decision" className="mt-0 px-5 py-6 md:px-8">
            {staffDecisionPanel}
          </TabsContent>
        )}

        <TabsContent value="emails" className="mt-0 px-5 py-6 md:px-8">
          <EmailsTab
            programId={program.id}
            templates={emailTemplates}
            acceptanceSubject={program.acceptance_email_subject}
            acceptanceBody={program.acceptance_email_body}
            setupInviteDate={program.setup_invite_date ?? null}
            schoolStartDate={runStart}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// COURSES TAB
// ────────────────────────────────────────────────────────────


// ────────────────────────────────────────────────────────────
// STAFF ASSIGN SELECT
// Shared inline picker used in both the applicants and enrollments
// tables, plus the review dialog. Calls a parent-supplied onAssign
// callback so each caller can hit the right API route.
// ────────────────────────────────────────────────────────────

function staffLabel(u: StaffUser | null | undefined) {
  if (!u) return "";
  const first = u.first_name || "";
  const last = u.last_name || "";
  const name = `${first} ${last}`.trim();
  return name || u.email || "Unknown";
}

const UNASSIGNED_VALUE = "__none__";

function StaffAssignSelect({
  value,
  staffOptions,
  onAssign,
  disabled,
  placeholder = "Unassigned",
  className,
}: {
  value: string | null;
  staffOptions: StaffUser[];
  onAssign: (newStaffId: string | null) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Select
      value={value ?? UNASSIGNED_VALUE}
      onValueChange={async (v) => {
        const next = v === UNASSIGNED_VALUE ? null : v;
        setBusy(true);
        try {
          await onAssign(next);
        } finally {
          setBusy(false);
        }
      }}
      disabled={disabled || busy}
    >
      <SelectTrigger className={className ?? "h-8 w-[180px] text-xs"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED_VALUE}>
          <span className="text-muted-foreground">Unassigned</span>
        </SelectItem>
        {staffOptions.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {staffLabel(s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ────────────────────────────────────────────────────────────
// ARRIVAL TAB
// ────────────────────────────────────────────────────────────
// Arrival-day checklist: for each arriving student, is their profile filled
// in (or not started yet), is their health insurance valid, and has a staff
// member physically checked it on arrival. Insurance/profile status is derived
// server-side (see lib/schools/arrival-insurance.ts) and passed in as a compact
// per-user summary keyed by user id.

// The two arrival-relevant enrollment statuses. Everyone else (dismissed,
// graduated, decided_to_leave, removed) has already come and gone.
const ARRIVAL_STATUSES = ["waiting_for_arrival", "arrived"];

// The arrival-day helper standing in front of the student needs to know WHICH
// fields are missing, not just how many. Incomplete / "No profile yet" badges
// are therefore buttons that open a read-only breakdown; Complete / Inactive /
// Unknown stay plain, non-clickable badges (nothing to drill into).
//
// Uses Dialog, not Popover — Radix popovers have silently failed to open in
// Safari in this codebase before (see SearchableSelect / phone inputs).
function ProfileBadge({
  info,
  studentName,
  userId,
}: {
  info: ArrivalInsuranceInfo | undefined;
  studentName: string;
  userId: string;
}) {
  const [open, setOpen] = useState(false);

  if (!info) {
    return <Badge variant="secondary">Unknown</Badge>;
  }
  if (info.profileStage === "inactive") {
    return <Badge variant="secondary">Inactive</Badge>;
  }

  // A held-back setup link (migration 230) is the same "no profile yet" state.
  const isInvited =
    info.profileStage === "invited" || info.profileStage === "invite_scheduled";
  const isIncomplete = info.profileStage === "profile_incomplete";

  if (!isInvited && !isIncomplete) {
    return (
      <Badge
        variant="outline"
        className="status-green"
      >
        Complete
      </Badge>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer"
        title="See exactly what's missing"
      >
        {isInvited ? (
          <Badge variant="destructive">No profile yet</Badge>
        ) : (
          <Badge
            variant="outline"
            className="status-yellow"
          >
            Incomplete ({info.completedRequired}/{info.totalRequired})
          </Badge>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{studentName}</DialogTitle>
            <DialogDescription>
              {isInvited
                ? "Accepted, but hasn't signed in or started a profile yet — nothing has been filled in."
                : `${info.completedRequired} of ${info.totalRequired} required fields complete.`}
            </DialogDescription>
          </DialogHeader>

          {info.missingGroups.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm font-medium">Still needed</p>
              {info.missingGroups.map((group) => (
                <div key={group.section} className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.section}
                  </p>
                  <ul className="list-disc pl-5 text-sm">
                    {group.fields.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <a
            href={`/users/${userId}`}
            className="text-sm underline underline-offset-4"
          >
            Open full profile
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InsuranceBadge({ info }: { info: ArrivalInsuranceInfo | undefined }) {
  const state = info?.insurance.state ?? "missing";
  const daysLeft = info?.insurance.daysLeft ?? null;
  if (state === "ok") {
    return (
      <Badge
        variant="outline"
        className="status-green"
      >
        Valid
      </Badge>
    );
  }
  // An open-ended SA medical scheme: valid, with no date to count down to.
  if (state === "no_expiry") {
    return (
      <Badge variant="outline" className="status-green">
        Valid · no expiry
      </Badge>
    );
  }
  if (state === "expiring") {
    return (
      <Badge
        variant="outline"
        className="status-yellow"
      >
        Expires in {daysLeft ?? "?"} day{daysLeft === 1 ? "" : "s"}
      </Badge>
    );
  }
  if (state === "expired") {
    return <Badge variant="destructive">Expired</Badge>;
  }
  return <Badge variant="destructive">No insurance on file</Badge>;
}

function ArrivalTab({
  enrollments,
  arrivalInsurance,
  courses,
  focusCourseId,
  studentCourses,
}: {
  enrollments: Enrollment[];
  arrivalInsurance: Record<string, ArrivalInsuranceInfo>;
  /** A school split into courses (FFX) marks arrival per course; empty = one school-wide status. */
  courses: SchoolCourse[];
  /** The course running now, else the next one — what the picker opens on. */
  focusCourseId: string | null;
  /** Each student's courses and per-course marks. */
  studentCourses: Record<string, { courseIds: string[]; arrivals: Record<string, CourseArrivalStatus> }>;
}) {
  const router = useRouter();
  const perCourse = courses.length > 0;
  const [courseId, setCourseId] = useState<string | null>(focusCourseId);
  const course = courses.find((c) => c.id === courseId) ?? null;
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [arrivalSearch, setArrivalSearch] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function userName(u: Enrollment["users"]) {
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
    return name || u.email || "Unknown";
  }

  // An enrolment whose account was deleted (migration 207). It keeps its place
  // on the roster so the student isn't silently lost, but there is no profile
  // or insurance behind it to check — only a person to re-link.
  const isOrphan = (e: Enrollment) => !e.user_id;

  const needsAttention = (e: Enrollment) => {
    if (isOrphan(e)) return true;
    const info = arrivalInsurance[e.user_id!];
    const profileDone =
      info?.profileStage === "active" || info?.profileStage === "pending_approval";
    const insuranceOk =
      info?.insurance.state === "ok" || info?.insurance.state === "no_expiry";
    return !profileDone || !insuranceOk;
  };

  // Per course: everyone whose track includes the picked course and who is
  // still with the school. Otherwise the school-wide waiting/arrived list.
  const roster = enrollments.filter((e) =>
    perCourse
      ? !e.removed_at &&
        !["graduated", "dismissed", "decided_to_leave"].includes(e.status) &&
        !!courseId &&
        (studentCourses[e.id]?.courseIds ?? []).includes(courseId)
      : !e.removed_at && ARRIVAL_STATUSES.includes(e.status)
  );
  // Orphans are excluded from both counters: they aren't students who haven't
  // filled a profile in, they're records with no account at all.
  const noProfileCount = roster.filter(
    (e) => !isOrphan(e) && ["invited", "invite_scheduled"].includes(
        arrivalInsurance[e.user_id!]?.profileStage ?? ""
      )
  ).length;
  const insuranceProblemCount = roster.filter((e) => {
    if (isOrphan(e)) return false;
    const s = arrivalInsurance[e.user_id!]?.insurance.state;
    return s === "missing" || s === "expired";
  }).length;

  // Alphabetical by the name actually shown, so the order matches what the
  // eye scans. localeCompare keeps accented names (de Lange, Grøteide) in
  // their expected places rather than after Z.
  const sortedRoster = [...roster].sort((a, b) =>
    userName(a.users).localeCompare(userName(b.users), undefined, {
      sensitivity: "base",
    })
  );

  const query = arrivalSearch.trim().toLowerCase();
  const visible = sortedRoster
    .filter((e) => (attentionOnly ? needsAttention(e) : true))
    .filter((e) => {
      if (!query) return true;
      const name = userName(e.users).toLowerCase();
      const email = (e.users.email ?? "").toLowerCase();
      return name.includes(query) || email.includes(query);
    });

  const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
    waiting_for_arrival: "secondary",
    arrived: "default",
  };

  async function handleCourseArrival(enrollmentId: string, mark: string) {
    if (!courseId) return;
    setUpdatingStatus(enrollmentId);
    try {
      const res = await fetch("/api/schools/enrollments/course-arrival", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId, courseId, status: mark }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to update arrival");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to update arrival");
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function handleStatusChange(enrollmentId: string, newStatus: string) {
    if (newStatus === "dismissed") {
      const e = enrollments.find((x) => x.id === enrollmentId);
      const ok = confirm(
        `Dismiss ${e ? userName(e.users) : "this student"}?\n\n` +
          "They come off the arrival list and show as Dismissed on the " +
          "Students tab. Their Hub login is switched off (staff and admin " +
          "accounts are never touched)."
      );
      if (!ok) return;
    }
    setUpdatingStatus(enrollmentId);
    try {
      const res = await fetch("/api/schools/enrollments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: enrollmentId, status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(
          res.status === 403 && newStatus === "dismissed"
            ? "Dismissing a student needs a schools admin or program leader. " +
                "Ask one of them to dismiss this student."
            : data.error || "Failed to update status"
        );
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to update status");
    } finally {
      setUpdatingStatus(null);
    }
  }

  /**
   * Takes a student off the arrival list.
   *
   * Reuses the roster tab's soft removal rather than adding anything new: it
   * sets removed_at, so the row drops off Arrival (the roster filter excludes
   * removed enrolments) and reappears under the Removed chip on Students,
   * where it can be restored. Nothing is deleted here.
   */
  async function removeFromArrival(enrollment: Enrollment) {
    const orphan = isOrphan(enrollment);
    const name = userName(enrollment.users);
    const ok = confirm(
      orphan
        ? "Remove this leftover enrolment from the school?\n\n" +
            "The Hub account behind it no longer exists. The enrolment is kept " +
            "under Removed on the Students tab, so it can be put back if you " +
            "re-link them to a new account."
        : `Remove ${name} from this school?\n\n` +
            "They come off the arrival list and the active roster. Nothing is " +
            "deleted — you can put them back from the Students tab under Removed."
    );
    if (!ok) return;

    setMenuFor(null);
    setRemovingId(enrollment.id);
    try {
      const res = await fetch("/api/schools/enrollments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: enrollment.id, removed: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Arrival's status and insurance actions only need a login, but
        // removing needs schools-admin or program-leader rights. Say who can
        // do it rather than "not authorized".
        alert(
          res.status === 403
            ? "You can update arrival status, but taking a student off the " +
                "roster needs a schools admin or program leader. Ask one of " +
                "them to remove this student."
            : data.error || "That didn't work"
        );
        return;
      }
      router.refresh();
    } catch {
      alert("That didn't work — check your connection");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleVerify(enrollmentId: string, verified: boolean) {
    setVerifyingId(enrollmentId);
    try {
      const res = await fetch("/api/schools/enrollments/insurance-verify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: enrollmentId, verified }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to update insurance check");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to update insurance check");
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {perCourse && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[13px] text-[color:var(--text-secondary)]">Marking arrival for</span>
          {courses.map((c) => (
            <button key={c.id} type="button" onClick={() => setCourseId(c.id)}>
              <Chip active={c.id === courseId}>{c.code}</Chip>
            </button>
          ))}
          {course && (
            <span className="ml-2 text-[13px] text-[color:var(--text-secondary)]">
              {roster.filter((e) => studentCourses[e.id]?.arrivals[course.id] === "arrived").length} of {roster.length} arrived
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 border border-border px-2.5 py-1">
            No profile yet
            <span className="bg-bone px-1.5 py-0.5 text-[10px] font-bold">
              {noProfileCount}
            </span>
          </span>
          <span className="flex items-center gap-1.5 border border-border px-2.5 py-1">
            Insurance missing / expired
            <span className="bg-bone px-1.5 py-0.5 text-[10px] font-bold">
              {insuranceProblemCount}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={arrivalSearch}
            onChange={(e) => setArrivalSearch(e.target.value)}
            placeholder="Search name or email"
            className="h-[30px] w-56 text-xs"
            aria-label="Search students on arrival"
          />
          <button
            type="button"
            onClick={() => setAttentionOnly((v) => !v)}
            className={`flex items-center gap-1.5 border px-2.5 py-1 text-xs font-medium transition-colors ${
              attentionOnly
                ? "border-ink bg-ink text-white"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Needs attention only
          </button>
        </div>
      </div>

      <div className="border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>{perCourse && course ? `Arrival · ${course.code}` : "Arrival"}</TableHead>
              <TableHead>Insurance</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="text-center">Checked on arrival</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {roster.length === 0
                    ? perCourse
                      ? "No students are signed up for this course."
                      : "No students waiting for arrival or arrived yet."
                    : query
                    ? `No students match \u201c${arrivalSearch.trim()}\u201d.`
                    : "No students match the current filter."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((enrollment) => {
                const orphaned = isOrphan(enrollment);
                const info = orphaned
                  ? undefined
                  : arrivalInsurance[enrollment.user_id!];
                const verified = !!enrollment.insurance_verified_at;
                return (
                  <TableRow key={enrollment.id}>
                    <TableCell className="font-medium">
                      {/* Roll-off lives here rather than in a seventh column —
                          the arrival table is six columns and stays six. */}
                      <div className="group/row relative flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          {userName(enrollment.users)}
                          <div className="text-xs text-muted-foreground">
                            {enrollment.users.email ?? "—"}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={removingId === enrollment.id}
                          onClick={() =>
                            setMenuFor(menuFor === enrollment.id ? null : enrollment.id)
                          }
                          aria-label={`Actions for ${userName(enrollment.users)}`}
                          className="shrink-0 px-1 font-mono text-[13px] leading-none text-[color:var(--text-tertiary)] opacity-0 hover:text-ink focus:opacity-100 group-hover/row:opacity-100"
                        >
                          ⋯
                        </button>
                        {menuFor === enrollment.id && (
                          <div className="absolute right-0 top-full z-20 w-[210px] border border-ink bg-white">
                            <button
                              type="button"
                              onClick={() => removeFromArrival(enrollment)}
                              className="block w-full px-3 py-2 !font-sans text-left text-[13px] !font-semibold normal-case tracking-normal text-ink hover:bg-[#F7F5EE]"
                            >
                              Remove from school
                            </button>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {orphaned ? (
                        <Badge
                          variant="secondary"
                          title="This person's account was deleted. The enrolment was kept — re-invite them and link the new account to it."
                        >
                          Account deleted
                        </Badge>
                      ) : (
                        <ProfileBadge
                          info={info}
                          studentName={userName(enrollment.users)}
                          userId={enrollment.user_id!}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {perCourse && courseId ? (
                        <select
                          value={studentCourses[enrollment.id]?.arrivals[courseId] ?? "waiting"}
                          disabled={updatingStatus === enrollment.id || removingId === enrollment.id}
                          onChange={(e) =>
                            e.target.value === "dismissed"
                              ? handleStatusChange(enrollment.id, "dismissed")
                              : handleCourseArrival(enrollment.id, e.target.value)
                          }
                          aria-label={`Arrival for ${userName(enrollment.users)}`}
                          className="h-9 w-[160px]"
                        >
                          <option value="waiting">Waiting</option>
                          <option value="arrived">Arrived</option>
                          <option value="no_show">No-show</option>
                          <option value="dismissed">Dismissed</option>
                        </select>
                      ) : (
                      <Select
                        value={enrollment.status}
                        onValueChange={(val) => handleStatusChange(enrollment.id, val)}
                        disabled={
                          updatingStatus === enrollment.id || removingId === enrollment.id
                        }
                      >
                        <SelectTrigger className="w-[160px]">
                          <Badge variant={statusColors[enrollment.status] ?? "secondary"}>
                            {ENROLLMENT_STATUS_LABELS[enrollment.status] ?? enrollment.status}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="waiting_for_arrival">Waiting for Arrival</SelectItem>
                          <SelectItem value="arrived">Arrived</SelectItem>
                          <SelectItem value="dismissed">Dismissed</SelectItem>
                        </SelectContent>
                      </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      {orphaned ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <InsuranceBadge info={info} />
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {info?.provider ? (
                        <div className="space-y-0.5">
                          <div className="text-foreground">{info.provider}</div>
                          {info.policyNumber && <div>Policy {info.policyNumber}</div>}
                          {info.insurance.expiryDate && (
                            <div>
                              Expires{" "}
                              {new Date(info.insurance.expiryDate).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <div
                        className="flex items-center justify-center"
                        title={
                          verified && enrollment.insurance_verified_at
                            ? `Checked ${new Date(enrollment.insurance_verified_at).toLocaleString()}`
                            : "Mark once you've physically checked their insurance"
                        }
                      >
                        <Checkbox
                          checked={verified}
                          disabled={verifyingId === enrollment.id}
                          onCheckedChange={(val) =>
                            handleVerify(enrollment.id, val === true)
                          }
                          aria-label="Insurance checked on arrival"
                        />
                        {verified && (
                          <ShieldCheck className="ml-2 h-4 w-4 text-[color:var(--green-text)]" />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// ENROLLMENTS TAB
// ────────────────────────────────────────────────────────────


// ────────────────────────────────────────────────────────────
// GRADES TAB
// ────────────────────────────────────────────────────────────


// ────────────────────────────────────────────────────────────
// APPLICANTS TAB
// ────────────────────────────────────────────────────────────

type AnalyticsData = {
  total: number;
  statusCounts: Record<string, number>;
  avgDaysToDecision: number | null;
  refCompletionRate: number | null;
  totalRefs: number;
  submittedRefs: number;
  weeklyData: Array<{ week: string; count: number }>;
};

type ApplicantEmailRow = {
  id: string;
  category: string | null;
  subject: string | null;
  to_email: string;
  status: string;
  error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  created_at: string;
};

function prettyCategory(c: string | null): string {
  if (!c) return "Email";
  return c
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function ApplicantStageBadges({
  stage,
  outcome,
  variant,
}: {
  stage: string;
  outcome: DecisiveInterviewOutcome | null;
  variant: "default" | "secondary" | "destructive";
}) {
  const label =
    stage in PIPELINE_STAGE_LABEL
      ? PIPELINE_STAGE_LABEL[stage as keyof typeof PIPELINE_STAGE_LABEL]
      : stage.replace(/_/g, " ");
  return (
    <div className="flex max-w-full flex-wrap items-center gap-1">
      <Badge variant={variant} className="whitespace-nowrap">
        {label}
      </Badge>
      {stage === "interview_complete" && (
        <Badge
          variant={
            outcome === "decline"
              ? "destructive"
              : outcome === "recommend"
                ? "default"
                : outcome === "hold"
                  ? "secondary"
                  : "outline"
          }
          className="whitespace-nowrap"
        >
          {outcome ? INTERVIEW_OUTCOME_LABEL[outcome] : "No outcome"}
        </Badge>
      )}
    </div>
  );
}

function ApplicantEmailStatusBadge({ email }: { email: ApplicantEmailRow }) {
  // Sent and delivered are success. A missing open or click is not a problem.
  const view = presentationForMessage(email);
  return (
    <Badge variant={badgeVariant(view.tone)} className="shrink-0">
      {view.label}
    </Badge>
  );
}

/**
 * The four readiness checks. Deliberately only things the Hub actually knows:
 * a check it cannot answer would be worse than no check at all.
 */
function reviewChecks(resp: AppResponse, refs: ReferenceRequest[]): ReviewCheck[] {
  const answered = (resp.answers ?? []).filter((a) => a.answer?.trim()).length;
  const total = (resp.answers ?? []).length;
  const refsIn = refs.filter((r) => r.status === "submitted").length;
  const decided = ["accepted", "waitlisted", "rejected"].includes(resp.status);
  return [
    {
      label: "Application form",
      value: total > 0 && answered === total ? "COMPLETE" : `${answered} OF ${total} ANSWERED`,
      ok: total > 0 && answered === total,
    },
    {
      label: "References",
      value: refs.length === 0 ? "NONE ASKED FOR" : `${refsIn} OF ${refs.length} IN`,
      ok: refs.length > 0 && refsIn === refs.length,
    },
    {
      label: "Interview",
      value: resp.status === "interview_scheduled" ? "SCHEDULED" : "NOT SCHEDULED",
      ok: resp.status === "interview_scheduled",
    },
    {
      label: "Hub account",
      value: resp.user_id ? "ACTIVE" : "NOT CREATED YET",
      ok: !!resp.user_id || decided,
    },
  ];
}

function formatInterviewWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date
    .toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();
}

function ApplicantsTab({
  programId,
  programCode,
  responses,
  removedResponses,
  referenceSlots,
  refRequestSummaries,
  pipelineReviews,
  viewerId,
  staffOptions,
}: {
  programId: string;
  programCode: string;
  responses: AppResponse[];
  removedResponses: AppResponse[];
  referenceSlots: ReferenceSlot[];
  refRequestSummaries: RefRequestSummary[];
  pipelineReviews: InterviewReviewSummary[];
  viewerId: string;
  staffOptions: StaffUser[];
}) {
  const router = useRouter();
  const [reviewingResponse, setReviewingResponse] = useState<AppResponse | null>(null);

  // Reference display in review dialog
  const [reviewReferences, setReviewReferences] = useState<ReferenceRequest[]>([]);
  const [refsLoading, setRefsLoading] = useState(false);

  // Email delivery history for the applicant under review.
  const [applicantEmails, setApplicantEmails] = useState<ApplicantEmailRow[]>([]);

  async function fetchApplicantEmails(applicationId: string) {
    setApplicantEmails([]);
    try {
      const res = await fetch(
        `/api/schools/programs/${programId}/applicant-emails?applicationId=${applicationId}`
      );
      if (res.ok) {
        const data = (await res.json()) as { emails: ApplicantEmailRow[] };
        setApplicantEmails(data.emails ?? []);
      }
    } catch {
      // Non-critical panel — leave it empty on failure.
    }
  }

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);

  // Analytics state
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Reference reminder state
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [requestingReferences, setRequestingReferences] = useState(false);
  const [bulkRequesting, setBulkRequesting] = useState(false);

  // Reference contact edit state (swap a pending referee's name/email)
  const [editingRefId, setEditingRefId] = useState<string | null>(null);
  const [editRefName, setEditRefName] = useState("");
  const [editRefEmail, setEditRefEmail] = useState("");
  const [savingRef, setSavingRef] = useState(false);

  function startEditReference(ref: ReferenceRequest) {
    setEditingRefId(ref.id);
    setEditRefName(ref.referee_name ?? "");
    setEditRefEmail(ref.referee_email ?? "");
  }

  function cancelEditReference() {
    setEditingRefId(null);
    setEditRefName("");
    setEditRefEmail("");
  }

  async function handleSaveReferenceEdit(refId: string) {
    if (!editRefName.trim() || !editRefEmail.trim()) {
      alert("Reference name and email are both required.");
      return;
    }
    setSavingRef(true);
    try {
      const res = await fetch("/api/schools/applications/references", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference_request_id: refId,
          referee_name: editRefName.trim(),
          referee_email: editRefEmail.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.email_changed) {
          alert(
            data.emailed
              ? "Reference updated — a fresh invite was sent to the new email and the old link no longer works."
              : "Reference updated, but the invite email could not be sent. Check the address and try again."
          );
        }
        cancelEditReference();
        fetchReferences(reviewingResponse!.id);
      } else {
        alert(data.error || "Failed to update reference");
      }
    } catch {
      alert("Failed to update reference");
    } finally {
      setSavingRef(false);
    }
  }

  // Resend invite state
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);
  const [resendingAcceptanceId, setResendingAcceptanceId] = useState<string | null>(null);
  const [copyingLinkId, setCopyingLinkId] = useState<string | null>(null);

  // Emailing the link cannot help an applicant whose address has bounced —
  // every send is dropped by the suppression list. Copying it is the way out
  // that does not involve deleting and recreating their account.
  async function handleCopySetupLink(responseId: string, userId: string) {
    setCopyingLinkId(responseId);
    try {
      const res = await fetch("/api/admin/setup-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Could not create a setup link");
        return;
      }
      try {
        await navigator.clipboard.writeText(data.url);
        alert(`Setup link copied — valid 30 days. Send it to ${data.email}.`);
      } catch {
        prompt("Copy this setup link (valid 30 days):", data.url);
      }
    } catch {
      alert("Could not create a setup link");
    } finally {
      setCopyingLinkId(null);
    }
  }

  /** Re-send the acceptance email itself (no setup link). */
  async function handleResendAcceptance(responseId: string) {
    setResendingAcceptanceId(responseId);
    try {
      const res = await fetch("/api/admin/resend-acceptance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_id: responseId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Failed to resend the acceptance email");
        return;
      }
      alert(`Acceptance email resent to ${data.email}.`);
    } catch {
      alert("Failed to resend the acceptance email");
    } finally {
      setResendingAcceptanceId(null);
    }
  }

  async function handleResendInvite(responseId: string) {
    setResendingInviteId(responseId);
    try {
      const res = await fetch("/api/admin/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_id: responseId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to resend invite");
        return;
      }
      if (data.alreadyActive) {
        alert("User has already activated their account");
        return;
      }
      alert("Invite resent");
    } catch (err) {
      alert("Failed to resend invite");
    } finally {
      setResendingInviteId(null);
    }
  }

  // Remove / restore / delete state
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function handleArchive(resp: AppResponse) {
    if (!confirm(`Remove ${respName(resp)}'s application from the list? You can restore it later from the Removed tab.`)) return;
    setRemovingId(resp.id);
    try {
      const res = await fetch("/api/schools/applications/responses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", id: resp.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to remove application");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to remove application");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleRestore(resp: AppResponse) {
    setRemovingId(resp.id);
    try {
      const res = await fetch("/api/schools/applications/responses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", id: resp.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to restore application");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to restore application");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleDeletePermanently(resp: AppResponse) {
    if (
      !confirm(
        `Permanently delete ${respName(resp)}'s application? This cannot be undone — the application and its references will be erased.`
      )
    )
      return;
    setRemovingId(resp.id);
    try {
      const res = await fetch("/api/schools/applications/responses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: resp.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to delete application");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to delete application");
    } finally {
      setRemovingId(null);
    }
  }

  // Review state
  const [reviewStatus, setReviewStatus] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteFeedback, setNoteFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [interviewReviews, setInterviewReviews] = useState<ShownInterviewReview[]>([]);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [interviewReady, setInterviewReady] = useState(false);
  const [interviewNotes, setInterviewNotes] = useState("");
  const [savedInterviewNotes, setSavedInterviewNotes] = useState("");
  const [interviewOutcome, setInterviewOutcome] = useState<InterviewOutcome>("pending");
  const [savedInterviewOutcome, setSavedInterviewOutcome] = useState<InterviewOutcome>("pending");
  const [interviewSaving, setInterviewSaving] = useState(false);
  const [interviewFeedback, setInterviewFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const interviewRequest = useRef(0);
  const interviewDraft = useRef<InterviewDraft>(emptyInterviewDraft());
  // False until this open's fetch returns. Pipeline props can prefill before
  // that; they must not overwrite the fetch afterwards.
  const interviewAuthoritative = useRef(false);
  const [reviewLoading, setReviewLoading] = useState(false);

  const commitInterviewDraft = useCallback((next: InterviewDraft) => {
    interviewDraft.current = next;
    setInterviewNotes(next.notes);
    setSavedInterviewNotes(next.baselineNotes);
    setInterviewOutcome(next.outcome);
    setSavedInterviewOutcome(next.baselineOutcome);
  }, []);

  // Pipeline props can arrive after the panel is open (refresh, or a late
  // server payload). Copy the viewer's saved row in until the reviews
  // request has become the source of truth. The open click also prefills
  // immediately; this covers the payload that lands afterwards.
  useEffect(() => {
    if (!reviewingResponse || interviewAuthoritative.current) return;
    const saved = savedInterviewFor(pipelineReviews, reviewingResponse.id, viewerId);
    const next = reconcileInterviewDraft(interviewDraft.current, saved, reviewingResponse.id);
    if (next !== interviewDraft.current) commitInterviewDraft(next);
  }, [reviewingResponse, pipelineReviews, viewerId, commitInterviewDraft]);

  // Pipeline filter & search
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  async function handleAssignStaff(responseId: string, staffId: string | null) {
    const res = await fetch("/api/schools/applications/responses/assign-staff", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_id: responseId, assigned_staff_id: staffId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to assign staff");
      return;
    }
    router.refresh();
  }

  function respName(resp: AppResponse) {
    if (resp.users) {
      const u = resp.users;
      if (u.first_name) return `${u.first_name} ${u.last_name ?? ""}`.trim();
      return u.email ?? "Unknown";
    }
    if (resp.applicant_info) {
      return `${resp.applicant_info.first_name} ${resp.applicant_info.last_name}`.trim();
    }
    return resp.applicant_email ?? "Unknown";
  }

  function respEmail(resp: AppResponse) {
    return resp.users?.email ?? resp.applicant_email ?? resp.applicant_info?.email ?? "—";
  }

  const responseStatusColors: Record<string, "default" | "secondary" | "destructive"> = {
    submitted: "secondary",
    references_received: "secondary",
    interview_scheduled: "secondary",
    interview_complete: "secondary",
    accepted: "default",
    rejected: "destructive",
    waitlisted: "secondary",
    cancelled: "secondary",
  };

  const requiredSlotIds = referenceSlots.filter((slot) => slot.is_required).map((slot) => slot.id);
  const requestsByApp = new Map<string, ReferenceRequestFact[]>();
  for (const ref of refRequestSummaries) {
    const rows = requestsByApp.get(ref.application_id) ?? [];
    rows.push({ slotId: ref.slot_id, status: ref.status });
    requestsByApp.set(ref.application_id, rows);
  }
  const reviewsByApp = new Map<string, InterviewReviewFact[]>();
  for (const review of pipelineReviews) {
    const rows = reviewsByApp.get(review.application_response_id) ?? [];
    rows.push({ interviewOutcome: review.interview_outcome, updatedAt: review.updated_at });
    reviewsByApp.set(review.application_response_id, rows);
  }

  function stageOf(resp: AppResponse) {
    return derivePipelineStage({
      storedStatus: resp.status,
      requiredSlotIds,
      requests: requestsByApp.get(resp.id) ?? [],
      reviews: reviewsByApp.get(resp.id) ?? [],
    });
  }

  function outcomeOf(resp: AppResponse): DecisiveInterviewOutcome | null {
    return interviewOutcomeBadge(reviewsByApp.get(resp.id) ?? []);
  }

  // Counts follow the derived tab, so a stale stored status does not
  // leave someone under Waiting for refs or Submitted after the refs are in.
  const statusCounts: Record<string, number> = {};
  for (const resp of responses) {
    const stage = stageOf(resp);
    statusCounts[stage] = (statusCounts[stage] ?? 0) + 1;
  }

  const unassignedCount = responses.filter((r) => !r.assigned_staff_id).length;

  // "Removed" is a virtual filter that swaps the data source to the archive bin.
  const isRemovedView = statusFilter === "removed";
  const sourceResponses = isRemovedView ? removedResponses : responses;

  // Filter responses by status, search, and unassigned-only toggle.
  const filteredResponses = sourceResponses.filter((resp) => {
    if (!isRemovedView && statusFilter === "unassigned") {
      if (resp.assigned_staff_id) return false;
    } else if (!isRemovedView && statusFilter !== "all" && stageOf(resp) !== statusFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const name = respName(resp).toLowerCase();
      const email = respEmail(resp).toLowerCase();
      if (!name.includes(q) && !email.includes(q)) return false;
    }
    return true;
  });

  async function fetchReferences(applicationId: string) {
    setRefsLoading(true);
    try {
      const res = await fetch(`/api/schools/applications/references?application_id=${applicationId}`);
      const data = await res.json();
      if (res.ok) setReviewReferences(data.references ?? []);
    } catch {
      // ignore
    } finally {
      setRefsLoading(false);
    }
  }

  function applyInterviewRows(
    applicationId: string,
    rows: Array<{
      id: string;
      author_name?: string;
      author_id?: string | null;
      notes?: string | null;
      note?: string | null;
      interview_notes?: string | null;
      interview_outcome?: string | null;
      outcome?: string | null;
      interviewOutcome?: string | null;
      updated_at: string;
      mine?: boolean;
    }>
  ) {
    if (interviewDraft.current.applicationId !== applicationId) return;
    const shown: ShownInterviewReview[] = rows.map((row) => {
      const form = interviewFormFromReview(row);
      return {
        id: row.id,
        authorName: row.author_name?.trim() || "Someone",
        outcome: form.outcome,
        notes: form.notes || null,
        when: formatInterviewWhen(row.updated_at),
        mine: !!row.mine || (!!viewerId && row.author_id === viewerId),
      };
    });
    setInterviewReviews(shown);
    interviewAuthoritative.current = true;
    const next = nextDraftAfterLoad(interviewDraft.current, rows, viewerId);
    if (next !== interviewDraft.current) commitInterviewDraft(next);
  }

  async function fetchInterviewReviews(applicationId: string, background = false) {
    const ticket = ++interviewRequest.current;
    if (!background) setInterviewLoading(true);
    try {
      const res = await fetch(`/api/schools/applications/reviews?response_id=${applicationId}`);
      const data = await res.json().catch(() => ({}));
      if (ticket !== interviewRequest.current) return;
      if (!res.ok) {
        if (!background) {
          setInterviewReviews([]);
          setInterviewReady(false);
          setInterviewFeedback({
            tone: "error",
            text: data.error || "Could not load interview notes",
          });
        }
        return;
      }
      applyInterviewRows(applicationId, data.reviews ?? []);
      setInterviewReady(true);
    } catch {
      if (ticket !== interviewRequest.current || background) return;
      setInterviewReady(false);
      setInterviewFeedback({ tone: "error", text: "Could not load interview notes" });
    } finally {
      if (ticket === interviewRequest.current) setInterviewLoading(false);
    }
  }

  function closeReview() {
    const noteDirty = reviewNotes.trim() !== savedNotes.trim();
    const draft = interviewDraft.current;
    const interviewDirty =
      draft.notes.trim() !== draft.baselineNotes.trim() ||
      draft.outcome !== draft.baselineOutcome;
    if (noteDirty || interviewDirty) {
      const what =
        noteDirty && interviewDirty
          ? "The internal note and the interview notes are not saved."
          : noteDirty
            ? "This internal note is not saved."
            : "These interview notes are not saved.";
      if (!window.confirm(`${what} Close without saving?`)) return;
    }
    setReviewingResponse(null);
  }

  async function handleSaveNote() {
    if (!reviewingResponse) return;
    setNoteSaving(true);
    setNoteFeedback(null);
    const stored = reviewNotes.trim();
    try {
      const res = await fetch("/api/schools/applications/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reviewingResponse.id,
          admin_notes: stored || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNoteFeedback({ tone: "error", text: data.error || "Could not save the note" });
        return;
      }
      setSavedNotes(stored);
      setReviewNotes(stored);
      setReviewingResponse((prev) => (prev ? { ...prev, admin_notes: stored || null } : prev));
      setNoteFeedback({ tone: "ok", text: "Saved" });
      router.refresh();
    } catch {
      setNoteFeedback({ tone: "error", text: "Could not save the note" });
    } finally {
      setNoteSaving(false);
    }
  }

  async function handleSaveInterview() {
    if (!reviewingResponse) return;
    const applicationId = reviewingResponse.id;
    setInterviewSaving(true);
    setInterviewFeedback(null);
    const draft = interviewDraft.current;
    const stored = draft.notes.trim();
    const flags = interviewClearFlags(draft);
    try {
      const res = await fetch("/api/schools/applications/reviews", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_id: applicationId,
          notes: stored,
          interview_outcome: draft.outcome,
          clear_outcome: flags.clear_outcome,
          clear_notes: flags.clear_notes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInterviewFeedback({
          tone: "error",
          text: data.error || "Could not save the interview notes",
        });
        return;
      }
      if (interviewDraft.current.applicationId !== applicationId) return;
      const storedForm = interviewFormFromReview(
        data.review ?? { notes: stored, interview_outcome: draft.outcome }
      );
      interviewAuthoritative.current = true;
      commitInterviewDraft(draftFromSaved(storedForm, applicationId));
      setInterviewFeedback({ tone: "ok", text: "Saved" });
      await fetchInterviewReviews(applicationId, true);
    } catch {
      setInterviewFeedback({ tone: "error", text: "Could not save the interview notes" });
    } finally {
      setInterviewSaving(false);
    }
  }

  // ── Bulk Actions ──
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredResponses.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredResponses.map((r) => r.id)));
    }
  }

  async function handleBulkStatusUpdate() {
    if (selectedIds.size === 0 || !statusWrittenByDecision(bulkStatus)) return;
    if (selectedIds.size > BULK_STATUS_LIMIT) {
      toast.error(`You can update at most ${BULK_STATUS_LIMIT} applications at once.`);
      return;
    }
    const movingAccepted =
      isBeforeAcceptance(bulkStatus) &&
      responses.some((row) => selectedIds.has(row.id) && row.status === "accepted");
    if (
      movingAccepted &&
      !window.confirm(
        "Some of these applicants are already accepted and still enrolled. Move them back to an earlier stage?"
      )
    ) {
      return;
    }
    setBulkLoading(true);
    try {
      const res = await fetch("/api/schools/applications/responses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          status: bulkStatus,
          send_email: true,
          confirm_regress: movingAccepted,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Failed to update statuses");
        return;
      }
      // Accepting now also puts people on the roster. Anyone we couldn't
      // enrol has no account for their email yet and needs the Accept
      // button, which invites them — say so rather than letting them look
      // accepted while being absent from the Arrival tab.
      const stranded = (data.notEnrolled ?? []).length;
      if (stranded > 0) {
        alert(
          `${stranded} applicant${stranded === 1 ? " was" : "s were"} marked accepted but not added to the roster — ` +
            `they have no account yet. Use Accept on each so they get an invite.`
        );
      }
      const emailWarnings: string[] = data.emailWarnings ?? [];
      if (emailWarnings.length > 0) {
        alert(
          `${emailWarnings.length} acceptance email${emailWarnings.length === 1 ? " was" : "s were"} not sent:\n\n` +
            emailWarnings.join("\n")
        );
      }
      setSelectedIds(new Set());
      setBulkStatus("");
      router.refresh();
    } catch {
      alert("Failed to update statuses");
    } finally {
      setBulkLoading(false);
    }
  }

  // ── Analytics ──
  async function loadAnalytics() {
    setAnalyticsLoading(true);
    try {
      const res = await fetch(`/api/schools/applications/analytics?program_id=${programId}`);
      const data = await res.json();
      if (res.ok) setAnalytics(data);
    } catch { /* ignore */ }
    setAnalyticsLoading(false);
  }

  // ── Reference Reminder ──
  function reminderToast(data: {
    skipped?: boolean;
    emailed?: boolean;
    error?: string;
    message?: string;
  }, ok: boolean) {
    if (!ok) {
      toast.error(data.message || data.error || "Could not send the reminder");
      return;
    }
    if (data.skipped) {
      toast.error("This program has reference reminders switched off.");
      return;
    }
    if (data.emailed) {
      toast.success("Reminder sent");
      return;
    }
    toast.error("The reminder was not sent. Check the address and try again.");
  }

  async function handleSendReminder(refRequestId: string) {
    setSendingReminder(refRequestId);
    try {
      const res = await fetch("/api/schools/applications/responses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_reference_reminder",
          reference_request_id: refRequestId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      reminderToast(data, res.ok);
      if (res.ok && reviewingResponse) {
        fetchReferences(reviewingResponse.id);
        router.refresh();
      }
    } catch {
      toast.error("Could not send the reminder");
    } finally {
      setSendingReminder(null);
    }
  }

  async function handleRemindOutstanding() {
    if (!reviewingResponse) return;
    setSendingReminder("all");
    try {
      const res = await fetch("/api/schools/applications/responses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_outstanding_reference_reminders",
          application_id: reviewingResponse.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message || data.error || "Could not send reminders");
        return;
      }
      const summary = remindAllToast(data.results ?? []);
      if (summary.tone === "ok") toast.success(summary.text);
      else toast.error(summary.text);
      fetchReferences(reviewingResponse.id);
      router.refresh();
    } catch {
      toast.error("Could not send reminders");
    } finally {
      setSendingReminder(null);
    }
  }

  // Email the applicant a link to their status page so they can add the required
  // references they didn't provide at submit time.
  async function handleRequestReferences() {
    if (!reviewingResponse) return;
    setRequestingReferences(true);
    try {
      const res = await fetch("/api/schools/applications/request-references", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: reviewingResponse.id }),
      });
      const data = await res.json();
      if (res.ok) {
        alert("Email sent to the applicant.");
        // Reflect the "Requested {date}" indicator immediately.
        setReviewingResponse((prev) =>
          prev ? { ...prev, references_requested_at: new Date().toISOString() } : prev
        );
        router.refresh();
      } else {
        alert(data.error || "Failed to send email");
      }
    } catch {
      alert("Failed to send email");
    } finally {
      setRequestingReferences(false);
    }
  }

  // Email every applicant for this program who is missing a required reference.
  async function handleBulkRequestReferences() {
    if (
      !confirm(
        "Email all applicants for this program who are missing required references?"
      )
    ) {
      return;
    }
    setBulkRequesting(true);
    try {
      const res = await fetch("/api/schools/applications/request-references", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_id: programId, all: true }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(
          data.emailed === 0
            ? "No applicants are missing required references."
            : `Emailed ${data.emailed} applicant${data.emailed === 1 ? "" : "s"}.`
        );
        router.refresh();
      } else {
        alert(data.error || "Failed to send emails");
      }
    } catch {
      alert("Failed to send emails");
    } finally {
      setBulkRequesting(false);
    }
  }

  /** `statusOverride` lets the 14c decision bar decide without waiting for the
   *  status select's state to settle. */
  async function handleReviewSave(statusOverride?: string) {
    if (!reviewingResponse) return;
    const nextStatus = statusToPersist(
      statusOverride ?? reviewStatus,
      reviewingResponse.status
    );
    if (!nextStatus) {
      toast.error("Record an interview outcome to reach Interview complete.");
      return;
    }
    const confirmRegress =
      reviewingResponse.status === "accepted" && isBeforeAcceptance(nextStatus);
    if (
      confirmRegress &&
      !window.confirm(
        "This applicant is already accepted and still enrolled. Move them back to an earlier stage?"
      )
    ) {
      return;
    }
    const draft = interviewDraft.current;
    const interviewDirty =
      draft.notes.trim() !== draft.baselineNotes.trim() ||
      draft.outcome !== draft.baselineOutcome;
    if (interviewDirty) {
      const proceed = window.confirm(
        "These interview notes are not saved. Continue with the decision without them?"
      );
      if (!proceed) return;
    }
    setReviewLoading(true);

    try {
      // Accept flow — route through the accept-application pipeline so the
      // student is automatically enrolled (and, for public applicants, a user
      // account is created and an invite email is sent). Only do this when the
      // application is *transitioning* into accepted — if it's already accepted
      // and we're just editing the notes, fall through to the standard update
      // below (re-running accept would fail with "already accepted").
      if (nextStatus === "accepted" && reviewingResponse.status !== "accepted") {
        const res = await fetch("/api/admin/accept-application", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            response_id: reviewingResponse.id,
            admin_notes: reviewNotes.trim() || null,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || "Failed to accept application");
          return;
        }
        // Accepted, but the email didn't go out — say so. The route has
        // returned this for months; nothing showed it, so a failed send
        // looked exactly like a successful one.
        if (data.emailWarning) {
          alert(`Accepted — but the student was not emailed.\n\n${data.emailWarning}`);
        }

        setReviewingResponse(null);
        router.refresh();
        return;
      }

      // Standard status update for non-accept statuses (rejected, waitlisted, etc.)
      const res = await fetch("/api/schools/applications/responses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reviewingResponse.id,
          status: nextStatus,
          admin_notes: reviewNotes.trim() || null,
          confirm_regress: confirmRegress,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to update status");
        return;
      }

      setReviewingResponse(null);
      router.refresh();
    } catch {
      alert("Failed to update status");
    } finally {
      setReviewLoading(false);
    }
  }

  const pipelineStages: PipelineStage[] = PIPELINE_STAGE_ORDER.map((key) => ({
    key,
    label: PIPELINE_STAGE_LABEL[key].toUpperCase(),
    count: responses.filter((r) => stageOf(r) === key).length,
  }));

  /** The mono strap above the applicant's name: school · when · who. */
  function reviewContextLine(resp: AppResponse): string {
    const info = resp.applicant_info;
    return [
      programCode,
      `SUBMITTED ${new Date(resp.submitted_at)
        .toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })
        .toUpperCase()}`,
      info?.nationality || null,
      info?.city || null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return (
    <div className="min-w-0 space-y-6">
      {/* Pipeline Filter Chips & Search */}
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium">Applicant Pipeline</h3>
          </div>
          {responses.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setShowAnalytics(!showAnalytics); if (!analytics) loadAnalytics(); }}
              >
                <BarChart3 className="mr-1 h-3 w-3" />
                Analytics
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(`/api/schools/applications/export?program_id=${programId}`, "_blank")}
              >
                <Download className="mr-1 h-3 w-3" />
                Export CSV
              </Button>
              {referenceSlots.some((slot) => slot.is_required) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkRequesting}
                  onClick={handleBulkRequestReferences}
                  title="Email every applicant missing a required reference"
                >
                  {bulkRequesting ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="mr-1 h-3 w-3" />
                  )}
                  Request missing references
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Status filter chips. They wrap; a chip never grows wider than the screen. */}
        <div className="flex min-w-0 flex-wrap gap-2">
          {PIPELINE_TABS.map(({ key, label }) => {
            const count =
              key === "all"
                ? responses.length
                : key === "unassigned"
                  ? unassignedCount
                  : (statusCounts[key] ?? 0);
            const isActive = statusFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {label}
                <span className={`px-1.5 py-0.5 text-[10px] font-bold ${
                  isActive ? "text-white" : "bg-bone"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
          {removedResponses.length > 0 && (
            <button
              onClick={() => setStatusFilter(isRemovedView ? "all" : "removed")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                isRemovedView
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              title="Applications removed from the pipeline"
            >
              <Archive className="h-3 w-3" />
              Removed
              <span className={`px-1.5 py-0.5 text-[10px] font-bold ${
                isRemovedView ? "text-white" : "bg-bone"
              }`}>
                {removedResponses.length}
              </span>
            </button>
          )}
        </div>

        {/* Search bar */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Analytics Dashboard */}
      {showAnalytics && (
        <div className="border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Application Analytics
            </h4>
            <Button variant="ghost" size="sm" onClick={loadAnalytics} disabled={analyticsLoading}>
              <RefreshCw className={`h-3 w-3 ${analyticsLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          {analyticsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : analytics ? (
            <div className="space-y-4">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="border p-3 text-center">
                  <p className="text-2xl font-bold">{analytics.total}</p>
                  <p className="text-xs text-muted-foreground">Total Applications</p>
                </div>
                <div className="border p-3 text-center">
                  <p className="text-2xl font-bold">
                    {analytics.avgDaysToDecision !== null ? `${analytics.avgDaysToDecision}d` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Avg. Time to Decision</p>
                </div>
                <div className="border p-3 text-center">
                  <p className="text-2xl font-bold">
                    {analytics.refCompletionRate !== null ? `${analytics.refCompletionRate}%` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Reference Completion</p>
                </div>
                <div className="border p-3 text-center">
                  <p className="text-2xl font-bold">
                    {analytics.statusCounts.accepted ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Accepted</p>
                </div>
              </div>

              {/* Status Breakdown */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status Breakdown</p>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(analytics.statusCounts).map(([status, count]) => (
                    <Badge key={status} variant={responseStatusColors[status] ?? "secondary"} className="gap-1">
                      {status.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      <span className="font-bold">{count}</span>
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Weekly Bar Chart */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Applications per Week</p>
                <div className="flex items-end gap-1 h-20">
                  {analytics.weeklyData.map((w, i) => {
                    const maxCount = Math.max(...analytics.weeklyData.map((d) => d.count), 1);
                    const height = (w.count / maxCount) * 100;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">{w.count || ""}</span>
                        <div
                          className="w-full bg-ink min-h-[2px]"
                          style={{ height: `${Math.max(height, 3)}%` }}
                        />
                        <span className="text-[9px] text-muted-foreground truncate w-full text-center">{w.week}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Removed-view explainer */}
      {isRemovedView && (
        <div className="border bg-muted/40 p-3 text-sm text-muted-foreground flex items-start gap-2">
          <Archive className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            These applications have been removed from the pipeline. <strong>Restore</strong> returns one to its
            previous status. <strong>Delete permanently</strong> erases it for good and is only available for
            applications that were never accepted.
          </span>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {!isRemovedView && selectedIds.size > 0 && (
        <div className="border border-ink bg-bone p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <Select value={bulkStatus} onValueChange={setBulkStatus}>
            <SelectTrigger className="w-full sm:w-[240px]">
              <SelectValue placeholder="Set status..." />
            </SelectTrigger>
            <SelectContent>
              {decisionChoices().map((choice) => (
                <SelectItem key={choice.value} value={choice.value} disabled={!choice.settable}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!bulkStatus || bulkLoading}
            onClick={handleBulkStatusUpdate}
          >
            {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedIds(new Set()); setBulkStatus(""); }}>
            Clear
          </Button>
        </div>
      )}

      {filteredResponses.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          {isRemovedView
            ? "No removed applications."
            : responses.length === 0
              ? "No applications submitted yet."
              : "No applicants match your filters."}
        </p>
      ) : (
        <div className="border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  {!isRemovedView && (
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredResponses.length && filteredResponses.length > 0}
                      onChange={toggleSelectAll}
                    />
                  )}
                </TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                {referenceSlots.length > 0 && <TableHead>References</TableHead>}
                <TableHead>Assigned</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredResponses.map((resp) => (
                <TableRow key={resp.id} className={selectedIds.has(resp.id) ? "bg-bone" : ""}>
                  <TableCell>
                    {!isRemovedView && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(resp.id)}
                        onChange={() => toggleSelect(resp.id)}
                      />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {respName(resp)}
                    {/* Not a privacy flag: it means they applied from outside
                        the Hub and no account exists yet. Accepting creates one,
                        which is why it clears on accept. */}
                    {/* Its own line, not trailing the name: the label is two
                        words wider than the old "Public" and this column is
                        narrow enough that inline wrapping broke the name. */}
                    {!resp.user_id && (
                      <div className="mt-1">
                        <Badge variant="secondary" className="whitespace-nowrap text-xs">
                          No Hub account
                        </Badge>
                      </div>
                    )}
                    {/* The status column sits past the fold on a phone. Repeat
                        the stage here so the tab's badge is on screen. */}
                    <div className="mt-1.5 md:hidden">
                      <ApplicantStageBadges
                        stage={stageOf(resp)}
                        outcome={outcomeOf(resp)}
                        variant={responseStatusColors[stageOf(resp)] ?? "secondary"}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {respEmail(resp)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(resp.submitted_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <ApplicantStageBadges
                      stage={stageOf(resp)}
                      outcome={outcomeOf(resp)}
                      variant={responseStatusColors[stageOf(resp)] ?? "secondary"}
                    />
                  </TableCell>
                  {referenceSlots.length > 0 && (
                    <TableCell>
                      {(() => {
                        const refs = refRequestSummaries.filter((r) => r.application_id === resp.id);
                        const totalRefs = refs.length;
                        const submittedRefs = refs.filter((r) => r.status === "submitted").length;
                        if (totalRefs === 0) return <span className="text-xs text-muted-foreground">—</span>;
                        const allIn = submittedRefs === totalRefs;

                        // Latest referee submission (→ completion date) / latest referee
                        // reminder (→ last-reminded date) across this app's references.
                        const maxDate = (vals: (string | null)[]) => {
                          const ts = vals
                            .filter(Boolean)
                            .map((v) => new Date(v as string).getTime());
                          return ts.length ? new Date(Math.max(...ts)) : null;
                        };
                        const completedAt = allIn ? maxDate(refs.map((r) => r.submitted_at)) : null;
                        const remindedAt = !allIn ? maxDate(refs.map((r) => r.reminder_sent_at)) : null;

                        return (
                          <div className="flex flex-col gap-0.5">
                            <span className={`text-xs font-medium ${allIn ? "text-[color:var(--green-text)]" : "text-[color:var(--amber)]"}`}>
                              {allIn ? "✓" : "⚠"} {submittedRefs}/{totalRefs}
                            </span>
                            {completedAt && (
                              <span className="text-[11px] text-muted-foreground">
                                Completed {completedAt.toLocaleDateString()}
                              </span>
                            )}
                            {remindedAt && (
                              <span className="text-[11px] text-muted-foreground">
                                Reminded {remindedAt.toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                  )}
                  <TableCell>
                    <StaffAssignSelect
                      value={resp.assigned_staff_id}
                      staffOptions={staffOptions}
                      onAssign={(staffId) => handleAssignStaff(resp.id, staffId)}
                    />
                  </TableCell>
                  <TableCell>
                    {isRemovedView ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={removingId === resp.id}
                          onClick={() => handleRestore(resp)}
                        >
                          {removingId === resp.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Restore"
                          )}
                        </Button>
                        {resp.status === "accepted" ? (
                          <span
                            className="text-[11px] text-muted-foreground"
                            title="Accepted applications have an enrolment/billing attached — restore it instead of deleting."
                          >
                            Can’t delete
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            title="Delete permanently"
                            aria-label="Delete permanently"
                            disabled={removingId === resp.id}
                            onClick={() => handleDeletePermanently(resp)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const note = resp.admin_notes ?? "";
                            setReviewingResponse(resp);
                            setReviewStatus(decisionSelectValue(resp.status));
                            setReviewNotes(note);
                            setSavedNotes(note);
                            setNoteFeedback(null);
                            setInterviewReviews([]);
                            setInterviewReady(false);
                            setInterviewFeedback(null);
                            interviewAuthoritative.current = false;
                            commitInterviewDraft(
                              draftFromSaved(
                                savedInterviewFor(pipelineReviews, resp.id, viewerId),
                                resp.id
                              )
                            );
                            fetchReferences(resp.id);
                            fetchApplicantEmails(resp.id);
                            fetchInterviewReviews(resp.id);
                          }}
                        >
                          Review
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          title="Print application"
                          onClick={() => window.open(`/api/schools/applications/pdf?response_id=${resp.id}`, "_blank")}
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                        {resp.status === "accepted" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            title="Resend invite email"
                            aria-label="Resend invite email"
                            disabled={resendingInviteId === resp.id}
                            onClick={() => handleResendInvite(resp.id)}
                          >
                            {resendingInviteId === resp.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        {resp.status === "accepted" && resp.user_id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            title="Resend acceptance email"
                            aria-label="Resend acceptance email"
                            disabled={resendingAcceptanceId === resp.id}
                            onClick={() => handleResendAcceptance(resp.id)}
                          >
                            {resendingAcceptanceId === resp.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <MailCheck className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        {resp.status === "accepted" && resp.user_id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            title="Copy setup link (send it yourself)"
                            aria-label="Copy setup link"
                            disabled={copyingLinkId === resp.id}
                            onClick={() =>
                              handleCopySetupLink(resp.id, resp.user_id as string)
                            }
                          >
                            {copyingLinkId === resp.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <LinkIcon className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          title="Remove application"
                          aria-label="Remove application"
                          disabled={removingId === resp.id}
                          onClick={() => handleArchive(resp)}
                        >
                          {removingId === resp.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Archive className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Frame 14c — applicant review ─────────────────────
          A screen, not a dialog: the pipeline, her answers at a size you can
          read, references and readiness beside them, and a decision bar that
          never scrolls away. */}
      {reviewingResponse && (
        <ApplicantReview
          name={respName(reviewingResponse)}
          email={respEmail(reviewingResponse)}
          phone={reviewingResponse.applicant_info?.phone ?? null}
          contextLine={reviewContextLine(reviewingResponse)}
          stages={pipelineStages}
          currentStatus={stageOf(reviewingResponse)}
          answers={reviewingResponse.answers ?? []}
          references={reviewReferences.map((ref) => ({
            id: ref.id,
            slotLabel: ref.reference_slots?.label ?? "Reference",
            status: ref.status,
            refereeName: ref.referee_name,
            org: ref.relationship,
          }))}
          refsLoading={refsLoading}
          checks={reviewChecks(reviewingResponse, reviewReferences)}
          note={reviewNotes}
          noteMeta={
            reviewingResponse.reviewed_at
              ? `INTERNAL NOTE · LAST TOUCHED ${new Date(reviewingResponse.reviewed_at)
                  .toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })
                  .toUpperCase()}`
              : "INTERNAL NOTE"
          }
          noteSaving={noteSaving}
          noteFeedback={noteFeedback}
          onSaveNote={handleSaveNote}
          interviewReviews={interviewReviews}
          interviewLoading={interviewLoading}
          interviewReady={interviewReady}
          interviewNotes={interviewNotes}
          interviewOutcome={interviewOutcome}
          onInterviewNotesChange={(value) => {
            commitInterviewDraft({ ...interviewDraft.current, notes: value });
            setInterviewFeedback(null);
          }}
          onInterviewOutcomeChange={(value) => {
            commitInterviewDraft({ ...interviewDraft.current, outcome: value });
            setInterviewFeedback(null);
          }}
          onSaveInterview={handleSaveInterview}
          interviewSaving={interviewSaving}
          interviewFeedback={interviewFeedback}
          acceptConsequence={
            reviewingResponse.status === "accepted"
              ? "ALREADY ACCEPTED — SAVING AGAIN ONLY UPDATES THE NOTE."
              : "ACCEPTING SENDS THE ACCEPTANCE EMAIL AND CREATES THEIR ENROLMENT."
          }
          busy={reviewLoading}
          renderAnswer={(answer) =>
            isStoragePath(answer) ? (
              <StorageImage
                storagePath={answer}
                applicationId={reviewingResponse.id}
              />
            ) : (
              answer
            )
          }
          onNoteChange={(value) => {
            setReviewNotes(value);
            setNoteFeedback(null);
          }}
          onDecision={(status) => handleReviewSave(status)}
          onClose={closeReview}
          extras={
            <div className="space-y-6">
          {/* Email, phone and the submitted date are NOT repeated here — the
              14c header already carries all three. This is only the structured
              record captured at submit time for someone with no Hub account. */}
          <div className="text-sm text-muted-foreground space-y-1">
            {!reviewingResponse.user_id && reviewingResponse.applicant_info && (
              <div className="bg-muted p-3 space-y-1">
                <p className="text-xs font-medium text-foreground uppercase tracking-wider mb-2">Applicant Details</p>
                {reviewingResponse.applicant_info.date_of_birth && (
                  <p>Date of Birth: {reviewingResponse.applicant_info.date_of_birth}</p>
                )}
                {reviewingResponse.applicant_info.gender && (
                  <p>Gender: {reviewingResponse.applicant_info.gender}</p>
                )}
                {reviewingResponse.applicant_info.nationality && (
                  <p>Nationality: {reviewingResponse.applicant_info.nationality}</p>
                )}
                {reviewingResponse.applicant_info.country && (
                  <p>Country: {reviewingResponse.applicant_info.country}</p>
                )}
                {reviewingResponse.applicant_info.city && (
                  <p>City: {reviewingResponse.applicant_info.city}</p>
                )}
              </div>
            )}
          </div>

          {/* Email history */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground uppercase tracking-wider">
              Email history
            </p>
            {applicantEmails.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No emails recorded for this applicant yet.
              </p>
            ) : (
              <ul className="divide-y border">
                {applicantEmails.map((em) => (
                  <li
                    key={em.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm truncate">
                        {em.subject || prettyCategory(em.category)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(
                          em.sent_at ?? em.created_at
                        ).toLocaleString()}
                      </p>
                      {em.error &&
                        presentationForMessage(em).tone === "problem" && (
                          <p className="text-xs text-destructive">{em.error}</p>
                        )}
                    </div>
                    <ApplicantEmailStatusBadge email={em} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* The answers are NOT repeated here. <ApplicantReview> renders them
              above at 15px/1.5, which is the whole point of frame 14c; this
              block is only what the team has done about them. */}

          {/* References */}
          {referenceSlots.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-sm font-medium">References</h4>
                {reviewReferences.some((ref) => ref.status !== "submitted") && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 w-full gap-1.5 sm:h-9 sm:w-auto"
                    disabled={sendingReminder !== null}
                    onClick={handleRemindOutstanding}
                  >
                    {sendingReminder === "all" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Remind all outstanding
                  </Button>
                )}
              </div>
              {!refsLoading &&
                referenceSlots.some(
                  (slot) =>
                    slot.is_required &&
                    !reviewReferences.some((ref) => ref.slot_id === slot.id)
                ) && (
                  <div className="border border-amber-border bg-white p-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--amber)]">
                      <AlertTriangle className="h-4 w-4" />
                      Missing required references
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This application was submitted without:{" "}
                      {referenceSlots
                        .filter(
                          (slot) =>
                            slot.is_required &&
                            !reviewReferences.some((ref) => ref.slot_id === slot.id)
                        )
                        .map((slot) => slot.label)
                        .join(", ")}
                      .
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        disabled={requestingReferences}
                        onClick={handleRequestReferences}
                      >
                        {requestingReferences ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Email applicant to add references
                      </Button>
                      {reviewingResponse?.references_requested_at && (
                        <span className="text-xs text-muted-foreground">
                          Requested{" "}
                          {new Date(
                            reviewingResponse.references_requested_at
                          ).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              {refsLoading ? (
                <p className="text-sm text-muted-foreground">Loading references...</p>
              ) : reviewReferences.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No references were provided with this application.</p>
              ) : (
                <div className="space-y-3">
                  {reviewReferences.map((ref) => (
                    <div key={ref.id} className="border bg-muted/50 p-3 space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {ref.reference_slots?.label ?? "Reference"}
                          </p>
                          <p className="text-xs text-muted-foreground break-all">
                            {ref.referee_name} · {ref.referee_email}
                          </p>
                          {ref.status !== "submitted" && (
                            <div className="mt-1">
                              <LastReminderSent sentAt={ref.reminder_sent_at ?? null} />
                            </div>
                          )}
                          {ref.status !== "submitted" && ref.email_problem === "bounced" && (
                            <p className="mt-1 text-xs text-destructive" role="status">
                              {REFERENCE_BOUNCE_MESSAGE}
                            </p>
                          )}
                          {ref.status !== "submitted" && ref.email_problem === "not_sent" && (
                            <p className="mt-1 text-xs text-destructive" role="status">
                              {REFERENCE_NOT_SENT_MESSAGE}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {ref.status !== "submitted" && editingRefId !== ref.id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-11 text-xs gap-1 sm:h-8"
                              onClick={() => startEditReference(ref)}
                              title="Change reference name or email"
                            >
                              <Edit2 className="h-3 w-3" />
                              Edit
                            </Button>
                          )}
                          {ref.status !== "submitted" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-11 text-xs gap-1 sm:h-8"
                              disabled={sendingReminder !== null}
                              onClick={() => handleSendReminder(ref.id)}
                              title="Send reminder email"
                            >
                              {sendingReminder === ref.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Send className="h-3 w-3" />
                              )}
                              Remind
                            </Button>
                          )}
                          {ref.status !== "submitted" && ref.email_problem === "bounced" ? (
                            <Badge variant="destructive">Email bounced</Badge>
                          ) : (
                            <Badge variant={ref.status === "submitted" ? "default" : "secondary"}>
                              {ref.status === "submitted" ? "Submitted" : "Pending"}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Inline edit: swap a pending referee's name/email */}
                      {editingRefId === ref.id && (
                        <div className="border bg-background p-3 space-y-3">
                          <div className="space-y-1">
                            <Label htmlFor={`ref-name-${ref.id}`} className="text-xs">
                              Reference name
                            </Label>
                            <Input
                              id={`ref-name-${ref.id}`}
                              value={editRefName}
                              onChange={(e) => setEditRefName(e.target.value)}
                              placeholder="Full name"
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`ref-email-${ref.id}`} className="text-xs">
                              Reference email
                            </Label>
                            <Input
                              id={`ref-email-${ref.id}`}
                              type="email"
                              value={editRefEmail}
                              onChange={(e) => setEditRefEmail(e.target.value)}
                              placeholder="name@example.com"
                              className="h-8 text-sm"
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Changing the email sends a fresh invite to the new
                            address and disables the old link.
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              className="text-xs gap-1"
                              disabled={savingRef}
                              onClick={() => handleSaveReferenceEdit(ref.id)}
                            >
                              {savingRef && <Loader2 className="h-3 w-3 animate-spin" />}
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs"
                              disabled={savingRef}
                              onClick={cancelEditReference}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                      {ref.status === "submitted" && (
                        Array.isArray(ref.form_data?.answers) && ref.form_data.answers.length > 0 ? (
                          <div className="space-y-3 pt-2 border-t text-sm">
                            {(ref.form_data.answers as Array<{ question_id: string; question_label: string; answer: string }>).map((a) => {
                              const trimmed = (a.answer ?? "").trim();
                              if (!trimmed) return null;
                              // Highlight standalone rating answers (Excellent/Good/Fair/Poor) since they're common.
                              const ratingColor =
                                trimmed === "Excellent" ? "text-[color:var(--green-text)]" :
                                trimmed === "Good" ? "text-electric" :
                                trimmed === "Fair" ? "text-[color:var(--amber)]" :
                                trimmed === "Poor" ? "text-destructive" : null;
                              return (
                                <div key={a.question_id}>
                                  <p className="text-xs font-medium text-muted-foreground">{a.question_label}</p>
                                  <p className={`whitespace-pre-wrap ${ratingColor ?? ""}`}>{trimmed}</p>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                        <div className="space-y-3 pt-2 border-t text-sm">
                          {/* Basic info */}
                          <div className="grid grid-cols-2 gap-2">
                            {ref.relationship && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground">Relationship</p>
                                <p>{ref.relationship}</p>
                              </div>
                            )}
                            {ref.known_duration && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground">Known Duration</p>
                                <p>{ref.known_duration}</p>
                              </div>
                            )}
                            {ref.form_data?.whatsapp_number && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground">WhatsApp</p>
                                <p>{ref.form_data.whatsapp_number}</p>
                              </div>
                            )}
                          </div>
                          {ref.form_data?.growth_context && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Growth/Discipleship Context</p>
                              <p className="whitespace-pre-wrap">{ref.form_data.growth_context}</p>
                            </div>
                          )}

                          {/* Character ratings */}
                          {ref.form_data?.character_ratings && Object.keys(ref.form_data.character_ratings).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Character Assessment</p>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                                {Object.entries(ref.form_data.character_ratings).map(([trait, rating]) => (
                                  <div key={trait} className="flex justify-between">
                                    <span className="text-muted-foreground">{trait}</span>
                                    <span className={
                                      rating === "Excellent" ? "text-[color:var(--green-text)]" :
                                      rating === "Good" ? "text-electric" :
                                      rating === "Fair" ? "text-[color:var(--amber)]" :
                                      "text-destructive"
                                    }>{rating as string}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {ref.form_data?.additional_comments && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Additional Comments on Character</p>
                              <p className="whitespace-pre-wrap">{ref.form_data.additional_comments}</p>
                            </div>
                          )}

                          {/* Short answers */}
                          {ref.form_data?.christian_history && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Christian History</p>
                              <p><strong>{ref.form_data.christian_history}</strong> — {ref.form_data.christian_history_why}</p>
                            </div>
                          )}
                          {ref.form_data?.strengths_weaknesses && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Strengths & Weaknesses</p>
                              <p className="whitespace-pre-wrap">{ref.form_data.strengths_weaknesses}</p>
                            </div>
                          )}
                          {ref.form_data?.seeking_growth && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Actively Seeking Growth?</p>
                              <p className="whitespace-pre-wrap">{ref.form_data.seeking_growth}</p>
                            </div>
                          )}
                          {ref.form_data?.missions_ministry && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Missions/Ministry Area</p>
                              <p className="whitespace-pre-wrap">{ref.form_data.missions_ministry}</p>
                            </div>
                          )}
                          {ref.form_data?.recommendation && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Recommendation</p>
                              <p>
                                <Badge variant={
                                  ref.form_data.recommendation === "Yes" ? "default" :
                                  ref.form_data.recommendation === "No" ? "destructive" :
                                  "secondary"
                                }>
                                  {ref.form_data.recommendation}
                                </Badge>
                              </p>
                              {ref.form_data.recommendation_explanation && (
                                <p className="whitespace-pre-wrap mt-1 text-muted-foreground">{ref.form_data.recommendation_explanation}</p>
                              )}
                            </div>
                          )}
                          {ref.form_data?.other_comments && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Other Comments</p>
                              <p className="whitespace-pre-wrap">{ref.form_data.other_comments}</p>
                            </div>
                          )}

                          {/* Fallback for old-style references without form_data */}
                          {!ref.form_data && ref.reference_text && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Reference</p>
                              <p className="whitespace-pre-wrap">{ref.reference_text}</p>
                            </div>
                          )}
                        </div>
                        )
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Assigned Staff */}
          <div className="border-t pt-4 flex items-center gap-3">
            <Label className="shrink-0">Assigned Staff:</Label>
            <StaffAssignSelect
              value={reviewingResponse.assigned_staff_id}
              staffOptions={staffOptions}
              className="h-9 w-[220px] text-sm"
              onAssign={(staffId) =>
                handleAssignStaff(reviewingResponse.id, staffId)
              }
            />
          </div>


          {/* Status Update. Options are the pipeline stages. */}
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="applicant-decision">Decision</Label>
              <Select
                value={decisionSelectValue(reviewStatus)}
                onValueChange={(value) => {
                  if (statusWrittenByDecision(value)) setReviewStatus(value);
                }}
              >
                <SelectTrigger id="applicant-decision" className="w-full sm:max-w-[280px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {decisionChoices().map((choice) => (
                    <SelectItem key={choice.value} value={choice.value} disabled={!choice.settable}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {stageOf(reviewingResponse) === "interview_complete" && (
                <p className="text-xs text-muted-foreground">
                  Record an interview outcome to reach Interview complete.
                </p>
              )}
            </div>
            <Button
              onClick={() => handleReviewSave()}
              disabled={
                reviewLoading ||
                (statusToPersist(reviewStatus, reviewingResponse.status) ===
                  statusToPersist(
                    decisionSelectValue(reviewingResponse.status),
                    reviewingResponse.status
                  ) &&
                  (reviewNotes.trim() || "") === (reviewingResponse.admin_notes || ""))
              }
              size="sm"
              className="h-11 w-full sm:h-9 sm:w-auto"
            >
              {reviewLoading ? "Saving..." : "Save Decision"}
            </Button>
          </div>
            </div>
          }
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// APPLICATION TAB
// ────────────────────────────────────────────────────────────

function ApplicationTab({
  programId,
  programCode,
  programName,
  applicationOpen,
  applicationDeadline,
  questions,
  referenceSlots,
  referenceQuestions,
  canManageTemplates,
}: {
  programId: string;
  programCode: string;
  programName: string;
  applicationOpen: boolean;
  applicationDeadline: string | null;
  questions: AppQuestion[];
  referenceSlots: ReferenceSlot[];
  referenceQuestions: TreeQuestion[];
  canManageTemplates: boolean;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(applicationOpen);
  const [toggling, setToggling] = useState(false);
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<TreeQuestion | null>(null);

  // Reference slot state
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [editingSlot, setEditingSlot] = useState<ReferenceSlot | null>(null);
  const [slotLabel, setSlotLabel] = useState("");
  const [slotDescription, setSlotDescription] = useState("");
  const [slotRequired, setSlotRequired] = useState(true);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  // Deadline state
  const [deadline, setDeadline] = useState(applicationDeadline ?? "");
  const [deadlineSaving, setDeadlineSaving] = useState(false);

  // The acceptance email is edited on the Emails tab now, beside the other
  // six, so its state and save live in <AcceptanceEmailEditor> there.

  function copyPublicLink() {
    const link = publicLink;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Question form state
  const [qLabel, setQLabel] = useState("");
  const [qDescription, setQDescription] = useState("");
  const [qType, setQType] = useState("short_answer");
  const [qOptions, setQOptions] = useState("");
  const [qRequired, setQRequired] = useState(true);
  const [qParentId, setQParentId] = useState<string>("");
  const [qShowWhenAnswer, setQShowWhenAnswer] = useState<string>("");
  const [qLoading, setQLoading] = useState(false);
  const [qError, setQError] = useState<string | null>(null);

  // The public link was read straight off `window` during render, which threw
  // "window is not defined" on the server and dropped this whole tab to client
  // rendering. Resolve it after mount instead.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const publicLink = origin ? `${origin}/apply/${programId}` : `/apply/${programId}`;

  // Parent candidates: questions that can trigger follow-ups (yes_no / multiple_choice).
  // Exclude the question being edited to prevent self-reference.
  const parentCandidates = questions.filter(
    (q) =>
      (q.type === "yes_no" || q.type === "multiple_choice") &&
      q.id !== editingQuestion?.id
  );
  const selectedParent = parentCandidates.find((q) => q.id === qParentId) ?? null;
  const parentAnswerOptions: string[] = selectedParent
    ? selectedParent.type === "yes_no"
      ? ["yes", "no"]
      : selectedParent.options ?? []
    : [];

  // Template state
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [showImportTemplate, setShowImportTemplate] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description: string | null; application_template_questions: [{ count: number }] }>>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  async function handleSaveAsTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!templateName.trim()) return;
    setTemplateSaving(true);
    setTemplateError(null);
    try {
      const res = await fetch("/api/schools/applications/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_from_program",
          program_id: programId,
          name: templateName.trim(),
          description: templateDesc.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTemplateError(data.error || "Failed to save template");
        return;
      }
      setShowSaveTemplate(false);
      setTemplateName("");
      setTemplateDesc("");
    } catch {
      setTemplateError("Network error");
    } finally {
      setTemplateSaving(false);
    }
  }

  async function loadTemplates() {
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/schools/applications/templates");
      const data = await res.json();
      if (res.ok) setTemplates(data.templates ?? []);
    } catch { /* ignore */ }
    setTemplatesLoading(false);
  }

  async function handleImportTemplate(templateId: string) {
    setImportingId(templateId);
    try {
      const res = await fetch("/api/schools/applications/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_to_program",
          template_id: templateId,
          program_id: programId,
        }),
      });
      if (res.ok) {
        setShowImportTemplate(false);
        router.refresh();
      }
    } catch { /* ignore */ }
    setImportingId(null);
  }

  async function handleDeleteTemplate(templateId: string) {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/schools/applications/templates?id=${templateId}`, {
        method: "DELETE",
      });
      if (res.ok) loadTemplates();
    } catch { /* ignore */ }
  }

  async function handleToggleOpen() {
    setToggling(true);
    try {
      // We'll add a simple toggle endpoint, but for now use the programs route
      const newVal = !isOpen;
      const res = await fetch("/api/schools/programs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: programId, application_open: newVal }),
      });
      if (res.ok) {
        setIsOpen(newVal);
        router.refresh();
      }
    } catch {
      // ignore
    } finally {
      setToggling(false);
    }
  }

  function resetQuestionForm() {
    setQLabel("");
    setQDescription("");
    setQType("short_answer");
    setQOptions("");
    setQRequired(true);
    setQParentId("");
    setQShowWhenAnswer("");
    setQError(null);
    setEditingQuestion(null);
    setShowAddQuestion(false);
  }

  function startEdit(q: TreeQuestion) {
    setEditingQuestion(q);
    setQLabel(q.label);
    setQDescription(q.description ?? "");
    setQType(q.type);
    setQOptions(q.options?.join("\n") ?? "");
    setQRequired(q.is_required);
    setQParentId(q.parent_question_id ?? "");
    setQShowWhenAnswer(q.show_when_answer ?? "");
    setShowAddQuestion(true);
  }

  /** A field-type chip in the builder appends a question of that type. */
  function startAddOfType(type: string) {
    resetQuestionForm();
    setQType(type);
    setQRequired(type !== "section_header");
    setShowAddQuestion(true);
  }

  function startAddFollowUp(parent: TreeQuestion) {
    setEditingQuestion(null);
    setQLabel("");
    setQDescription("");
    setQType("short_answer");
    setQOptions("");
    setQRequired(true);
    setQParentId(parent.id);
    setQShowWhenAnswer(parent.type === "yes_no" ? "yes" : parent.options?.[0] ?? "");
    setQError(null);
    setShowAddQuestion(true);
  }

  async function handleSaveQuestion(e: React.FormEvent) {
    e.preventDefault();
    setQLoading(true);
    setQError(null);

    const hasParent = !!qParentId;
    if (hasParent && !qShowWhenAnswer) {
      setQError("Please choose which answer should trigger this follow-up question.");
      setQLoading(false);
      return;
    }

    const followUpPayload = hasParent
      ? { parent_question_id: qParentId, show_when_answer: qShowWhenAnswer }
      : { parent_question_id: null, show_when_answer: null };

    try {
      if (editingQuestion) {
        // Update
        const res = await fetch("/api/schools/applications/questions", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingQuestion.id,
            label: qLabel,
            description: qDescription || null,
            type: qType,
            is_required: qRequired,
            options: (qType === "multiple_choice" || qType === "checkbox_group") ? qOptions.split("\n").map((o: string) => o.trim()).filter(Boolean) : [],
            ...followUpPayload,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setQError(data.error || "Failed to update question");
          return;
        }
      } else {
        // Create
        const res = await fetch("/api/schools/applications/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            program_id: programId,
            label: qLabel,
            description: qDescription || null,
            type: qType,
            is_required: qRequired,
            sort_order: questions.length,
            options: (qType === "multiple_choice" || qType === "checkbox_group") ? qOptions.split("\n").map((o: string) => o.trim()).filter(Boolean) : [],
            ...followUpPayload,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setQError(data.error || "Failed to add question");
          return;
        }
      }

      resetQuestionForm();
      router.refresh();
    } catch {
      setQError("Network error");
    } finally {
      setQLoading(false);
    }
  }

  async function handleDeleteQuestion(id: string) {
    if (!confirm("Delete this question?")) return;
    try {
      const res = await fetch(`/api/schools/applications/questions?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } catch {
      alert("Failed to delete question");
    }
  }

  async function handleReorderSiblings(orderedIds: string[]) {
    const items = orderedIds.map((id, idx) => ({ id, sort_order: idx }));
    await fetch("/api/schools/applications/questions/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    router.refresh();
  }

  // ── Reference Slot Helpers ──

  function resetSlotForm() {
    setSlotLabel("");
    setSlotDescription("");
    setSlotRequired(true);
    setSlotError(null);
    setEditingSlot(null);
    setShowAddSlot(false);
  }

  function startEditSlot(slot: ReferenceSlot) {
    setEditingSlot(slot);
    setSlotLabel(slot.label);
    setSlotDescription(slot.description ?? "");
    setSlotRequired(slot.is_required);
    setShowAddSlot(true);
  }

  async function handleSaveSlot(e: React.FormEvent) {
    e.preventDefault();
    setSlotLoading(true);
    setSlotError(null);

    try {
      if (editingSlot) {
        const res = await fetch("/api/schools/applications/reference-slots", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingSlot.id,
            label: slotLabel,
            description: slotDescription || null,
            is_required: slotRequired,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setSlotError(data.error || "Failed to update"); return; }
      } else {
        const res = await fetch("/api/schools/applications/reference-slots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            program_id: programId,
            label: slotLabel,
            description: slotDescription || null,
            is_required: slotRequired,
            sort_order: referenceSlots.length,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setSlotError(data.error || "Failed to add"); return; }
      }

      resetSlotForm();
      router.refresh();
    } catch {
      setSlotError("Network error");
    } finally {
      setSlotLoading(false);
    }
  }

  async function handleDeleteSlot(id: string) {
    if (!confirm("Delete this reference slot?")) return;
    try {
      const res = await fetch(`/api/schools/applications/reference-slots?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        // The server refuses to remove a program's last required reference.
        // Without this the click just did nothing, with no explanation.
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to delete reference slot");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to delete reference slot");
    }
  }

  async function handleMoveSlot(slotId: string, direction: "up" | "down") {
    const idx = referenceSlots.findIndex((s) => s.id === slotId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= referenceSlots.length) return;

    const updates = [
      { id: referenceSlots[idx].id, sort_order: referenceSlots[swapIdx].sort_order },
      { id: referenceSlots[swapIdx].id, sort_order: referenceSlots[idx].sort_order },
    ];

    for (const u of updates) {
      await fetch("/api/schools/applications/reference-slots", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(u),
      });
    }
    router.refresh();
  }

  // ── Deadline ──
  async function handleSaveDeadline() {
    setDeadlineSaving(true);
    try {
      await fetch("/api/schools/programs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: programId,
          application_deadline: deadline || null,
        }),
      });
      router.refresh();
    } catch { /* ignore */ }
    setDeadlineSaving(false);
  }

  return (
    <div className="space-y-6">
      {/* Application Open Toggle */}
      <div className="border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">Application Status</h3>
            <p className="text-sm text-muted-foreground">
              {isOpen
                ? "Application is open — students can apply from the portal or via the public link."
                : "Application is closed — students cannot apply."}
            </p>
          </div>
          <Button
            variant={isOpen ? "destructive" : "default"}
            size="sm"
            onClick={handleToggleOpen}
            disabled={toggling}
          >
            {toggling
              ? "Updating..."
              : isOpen
                ? "Close Application"
                : "Open Application"}
          </Button>
        </div>

        {isOpen && (
          <div className="space-y-3">
            <div className="border border-ink bg-bone p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <LinkIcon className="h-4 w-4" />
                Public Application Link
              </div>
              <p className="text-xs text-muted-foreground">
                Share this link with prospective students. They can apply without needing an account.
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 border bg-background px-3 py-2 text-sm font-mono select-all truncate">
                  {publicLink}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-2"
                  onClick={copyPublicLink}
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 text-[color:var(--green-text)]" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy Link
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Application Deadline */}
            <div className="border p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Calendar className="h-4 w-4" />
                Application Deadline
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="datetime-local"
                  value={deadline ? new Date(deadline).toISOString().slice(0, 16) : ""}
                  onChange={(e) => setDeadline(e.target.value ? new Date(e.target.value).toISOString() : "")}
                  className="max-w-[240px]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveDeadline}
                  disabled={deadlineSaving}
                >
                  {deadlineSaving ? "Saving..." : "Save"}
                </Button>
                {deadline && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setDeadline(""); handleSaveDeadline(); }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              {deadline && (
                <p className="text-xs text-muted-foreground">
                  Applications close: {new Date(deadline).toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── APPLICATION BUILDER ─── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Application Questions ({questions.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowImportTemplate(true);
                loadTemplates();
              }}
            >
              <Upload className="mr-2 h-4 w-4" />
              Import Template
            </Button>
            {canManageTemplates && questions.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowSaveTemplate(true)}
              >
                <BookTemplate className="mr-2 h-4 w-4" />
                Save as Template
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                resetQuestionForm();
                setShowAddQuestion(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Question
            </Button>
          </div>
          {!canManageTemplates && (
            <p className="w-full text-xs leading-snug text-muted-foreground">
              Only admins and Hub-wide template managers can save or delete templates.
            </p>
          )}
        </div>

        {/* Save as Template Dialog */}
        {canManageTemplates && showSaveTemplate && (
          <div className="border bg-card p-4 space-y-3">
            <h4 className="text-sm font-medium">Save Questions as Template</h4>
            <p className="text-xs text-muted-foreground">
              Save the current {questions.length} question{questions.length !== 1 ? "s" : ""} as a reusable template.
            </p>
            <form onSubmit={handleSaveAsTemplate} className="space-y-3">
              <div>
                <Label>Template Name *</Label>
                <Input
                  required
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g. Standard FFBX Application"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={templateDesc}
                  onChange={(e) => setTemplateDesc(e.target.value)}
                  placeholder="Optional description"
                />
              </div>
              {templateError && <p className="text-sm text-destructive">{templateError}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={templateSaving}>
                  {templateSaving ? "Saving..." : "Save Template"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowSaveTemplate(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Import from Template Dialog */}
        {showImportTemplate && (
          <div className="border bg-card p-4 space-y-3">
            <h4 className="text-sm font-medium">Import from Template</h4>
            <p className="text-xs text-muted-foreground">
              Select a template to add its questions to this application. Existing questions will be kept.
            </p>
            {templatesLoading ? (
              <div className="flex items-center gap-2 py-4 justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading templates...
              </div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No templates yet. Save questions from a program to create one.
              </p>
            ) : (
              <div className="space-y-2">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 border p-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.application_template_questions?.[0]?.count ?? 0} question{(t.application_template_questions?.[0]?.count ?? 0) !== 1 ? "s" : ""}
                        {t.description ? ` — ${t.description}` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={importingId !== null}
                      onClick={() => handleImportTemplate(t.id)}
                    >
                      {importingId === t.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Import"
                      )}
                    </Button>
                    {canManageTemplates && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteTemplate(t.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => setShowImportTemplate(false)}>
              Close
            </Button>
          </div>
        )}

        {/* Add/Edit Question Form */}
        {showAddQuestion && (
          <div className="border p-4">
            <form onSubmit={handleSaveQuestion} className="space-y-3">
              <div>
                <Label>{qType === "section_header" ? "Header Title *" : "Question Label *"}</Label>
                <Input
                  required
                  value={qLabel}
                  onChange={(e) => setQLabel(e.target.value)}
                  placeholder={qType === "section_header" ? "e.g. Passport Information" : "e.g. Tell us about your faith journey"}
                />
              </div>
              <div>
                <Label>{qType === "section_header" ? "Description Text" : "Help Text / Description"}</Label>
                <Input
                  value={qDescription}
                  onChange={(e) => setQDescription(e.target.value)}
                  placeholder={qType === "section_header" ? "Optional text shown below the header" : "Optional instructions for the applicant"}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Answer Type</Label>
                  <Select value={qType} onValueChange={setQType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="short_answer">Short Answer</SelectItem>
                      <SelectItem value="long_answer">Long Answer (Essay)</SelectItem>
                      <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                      <SelectItem value="yes_no">Yes / No</SelectItem>
                      <SelectItem value="checkbox_group">Checkbox Group</SelectItem>
                      <SelectItem value="country">Country Select</SelectItem>
                      <SelectItem value="phone">Phone Number</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="file">Photo Upload</SelectItem>
                      <SelectItem value="consent">Consent Checkbox</SelectItem>
                      <SelectItem value="section_header">Section Header</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {qType !== "section_header" && (
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      id="q-required"
                      checked={qRequired}
                      onChange={(e) => setQRequired(e.target.checked)}
                    />
                    <Label htmlFor="q-required" className="mb-0">Required</Label>
                  </div>
                )}
              </div>
              {(qType === "multiple_choice" || qType === "checkbox_group") && (
                <div>
                  <Label>Options (one per line) *</Label>
                  <Textarea
                    value={qOptions}
                    onChange={(e) => setQOptions(e.target.value)}
                    placeholder={"Option 1\nOption 2\nOption 3"}
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Enter each choice on a new line.</p>
                </div>
              )}
              {qType !== "section_header" && (
                <div className="border bg-muted/30 p-3 space-y-3">
                  <div>
                    <Label>Show this question only as a follow-up to…</Label>
                    <Select
                      value={qParentId || "none"}
                      onValueChange={(v) => {
                        const nextId = v === "none" ? "" : v;
                        setQParentId(nextId);
                        if (!nextId) {
                          setQShowWhenAnswer("");
                          return;
                        }
                        const parent = parentCandidates.find((q) => q.id === nextId);
                        if (parent) {
                          setQShowWhenAnswer(
                            parent.type === "yes_no"
                              ? "yes"
                              : parent.options?.[0] ?? ""
                          );
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No — show this question always" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No — show this question always</SelectItem>
                        {parentCandidates.map((q) => (
                          <SelectItem key={q.id} value={q.id}>
                            {q.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Optional. Only yes/no and multiple-choice questions can trigger follow-ups.
                    </p>
                  </div>
                  {qParentId && parentAnswerOptions.length > 0 && (
                    <div>
                      <Label>Show when answer is</Label>
                      <Select value={qShowWhenAnswer} onValueChange={setQShowWhenAnswer}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an answer" />
                        </SelectTrigger>
                        <SelectContent>
                          {parentAnswerOptions.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt === "yes" ? "Yes" : opt === "no" ? "No" : opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}
              {qError && <p className="text-sm text-destructive">{qError}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={qLoading}>
                  {qLoading
                    ? "Saving..."
                    : editingQuestion
                      ? "Update Question"
                      : "Add Question"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetQuestionForm}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* ── Frame 15a — the form as one readable list ───────── */}
        {(showAddSlot || editingSlot) && (
          <form onSubmit={handleSaveSlot} className="space-y-3 border bg-card p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="slot-label">Label *</Label>
                <Input
                  id="slot-label"
                  placeholder="e.g. Friend Reference"
                  value={slotLabel}
                  onChange={(e) => setSlotLabel(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slot-desc">Description</Label>
                <Input
                  id="slot-desc"
                  placeholder="Optional instructions for the referee"
                  value={slotDescription}
                  onChange={(e) => setSlotDescription(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="slot-required"
                checked={slotRequired}
                onChange={(e) => setSlotRequired(e.target.checked)}
              />
              <Label htmlFor="slot-required" className="mb-0">Required</Label>
            </div>
            {slotError && <p className="text-sm text-destructive">{slotError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={slotLoading}>
                {slotLoading ? "Saving..." : editingSlot ? "Update Slot" : "Add Slot"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={resetSlotForm}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        <div className="border border-ink">
          <FormBuilder
            questions={questions}
            slots={referenceSlots}
            onEdit={startEdit}
            onDelete={handleDeleteQuestion}
            onReorder={handleReorderSiblings}
            onAddFollowUp={startAddFollowUp}
            onAddOfType={startAddOfType}
            onAddSlot={() => {
              resetSlotForm();
              setShowAddSlot(true);
            }}
            onEditSlot={(slot) => startEditSlot(slot as ReferenceSlot)}
            onMoveSlot={handleMoveSlot}
            onDeleteSlot={handleDeleteSlot}
            preview={
              <FormPreview
                schoolName={programName}
                programCode={programCode}
                questions={questions}
              />
            }
          />
        </div>
      </div>

      {/* ─── REFERENCE QUESTIONS ─── */}
      <ReferenceQuestionsBuilder
        programId={programId}
        questions={referenceQuestions}
      />


    </div>
  );
}

