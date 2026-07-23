"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { QuestionTree, type TreeQuestion } from "@/components/admin/question-tree";
import { ReferenceQuestionsBuilder } from "./reference-questions-builder";
import { ProgramCoursesManager, type PhaseCourse } from "./program-courses-manager";
import { StudentsExportPanel } from "./students-export-panel";
import { ENROLLMENT_STATUS_LABELS } from "@/lib/schools/student-export-columns";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Download, ChevronUp, ChevronDown, Edit2, ClipboardList, Copy, Check, Link as LinkIcon, Archive, BookTemplate, Upload, Loader2, FileText, Send, BarChart3, Calendar, RefreshCw, CheckSquare, Search, Users, MoreHorizontal, UserMinus, RotateCcw, AlertTriangle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
  user_id: string;
  status: string;
  enrolled_at: string;
  removed_at: string | null;
  removed_by: string | null;
  assigned_staff_id: string | null;
  assigned_staff: StaffUser | null;
  users: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
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
  description: string | null;
  application_open: boolean;
  application_deadline: string | null;
  acceptance_email_subject: string | null;
  acceptance_email_body: string | null;
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
  form_data: Record<string, any> | null;
  reference_slots: { label: string; description: string | null } | null;
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

function StorageImage({ storagePath }: { storagePath: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [isHeic, setIsHeic] = useState(false);

  useEffect(() => {
    async function fetchUrl() {
      try {
        const res = await fetch(
          `/api/upload/view?path=${encodeURIComponent(storagePath)}`
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
  }, [storagePath]);

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
      <div className="space-y-2 rounded-lg border border-dashed border-muted-foreground/30 p-4">
        <p className="text-sm text-muted-foreground">
          This photo is in HEIC format and cannot be previewed in the browser.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
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
        className="max-w-[200px] max-h-[250px] rounded-lg border object-cover"
        onError={() => setImgError(true)}
      />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
      >
        <Download className="h-3 w-3" /> View full size
      </a>
    </div>
  );
}

function isStoragePath(value: string): boolean {
  return value.startsWith("applications/") && value.length > 20;
}

const LETTER_GRADES = [
  "A", "A-", "B+", "B", "B-", "C+", "C", "C-",
  "D+", "D", "D-", "F", "W", "I", "P",
];

// ────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────

type RefRequestSummary = {
  id: string;
  application_id: string;
  status: string;
  submitted_at: string | null;
  reminder_sent_at: string | null;
};

export function ProgramDetail({
  program,
  enrollments,
  grades,
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
}: {
  program: Program;
  enrollments: Enrollment[];
  grades: GradeRow[];
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/schools" className="text-xs text-muted-foreground hover:text-foreground uppercase" style={{ letterSpacing: "0.15em" }}>
          ← Schools
        </Link>
      </div>
      {program.status === "archived" && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-600/30 bg-yellow-950/20 px-4 py-3">
          <Archive className="h-4 w-4 text-yellow-500 shrink-0" />
          <p className="text-sm text-yellow-200">
            This program is archived. It is hidden from non-admin users and no new enrollments can be made.
          </p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <p className="page-eyebrow">TRAINING &amp; EDUCATION</p>
          <h1 className="page-title">{program.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {program.code} &middot; {program.credit_hours} credit hours
            {program.description && ` — ${program.description}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={program.status === "active" ? "default" : "secondary"}>
            {program.status}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => setEditingProgram(true)}>
            <Edit2 className="mr-1 h-3 w-3" /> Edit
          </Button>
          <ProgramActions program={program} variant="button" redirectAfterDelete />
        </div>
      </div>

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

      {/* Tabs */}
      <Tabs defaultValue="courses">
        <TabsList>
          <TabsTrigger value="courses">
            Courses ({billingCourses.length})
          </TabsTrigger>
          <TabsTrigger value="enrollments">
            Enrollments ({enrollments.length})
          </TabsTrigger>
          <TabsTrigger value="application">
            Application
          </TabsTrigger>
          <TabsTrigger value="applicants">
            Applicants ({responses.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="courses" className="mt-4">
          <ProgramCoursesManager
            programId={program.id}
            courses={billingCourses}
            staff={courseStaff}
          />
        </TabsContent>

        <TabsContent value="enrollments" className="mt-4">
          <EnrollmentsTab
            programId={program.id}
            enrollments={enrollments}
            allUsers={allUsers}
            staffOptions={staffOptions}
          />
        </TabsContent>

        <TabsContent value="grades" className="mt-4">
          <GradesTab
            programId={program.id}
            courses={program.courses}
            enrollments={enrollments.filter((e) => !e.removed_at)}
            grades={grades}
          />
        </TabsContent>

        <TabsContent value="application" className="mt-4">
          <ApplicationTab
            programId={program.id}
            programCode={program.code}
            applicationOpen={program.application_open}
            applicationDeadline={program.application_deadline}
            acceptanceEmailSubject={program.acceptance_email_subject}
            acceptanceEmailBody={program.acceptance_email_body}
            questions={questions}
            referenceSlots={referenceSlots}
            referenceQuestions={referenceQuestions}
          />
        </TabsContent>

        <TabsContent value="applicants" className="mt-4">
          <ApplicantsTab
            programId={program.id}
            programCode={program.code}
            responses={responses}
            removedResponses={removedResponses}
            referenceSlots={referenceSlots}
            refRequestSummaries={refRequestSummaries}
            questions={questions}
            staffOptions={staffOptions}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// COURSES TAB
// ────────────────────────────────────────────────────────────

function CoursesTab({
  programId,
  courses,
}: {
  programId: string;
  courses: Course[];
}) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [creditHours, setCreditHours] = useState("3");
  const [deleting, setDeleting] = useState<string | null>(null);

  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editCreditHours, setEditCreditHours] = useState("3");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEditCourse(course: Course) {
    setEditingCourse(course);
    setEditName(course.name);
    setEditCode(course.code);
    setEditCreditHours(String(course.credit_hours));
    setEditError(null);
  }

  async function handleEditCourse(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCourse) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const res = await fetch("/api/schools/courses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingCourse.id,
          name: editName,
          code: editCode.toUpperCase(),
          credit_hours: parseInt(editCreditHours) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || "Failed to update course");
        return;
      }
      setEditingCourse(null);
      router.refresh();
    } catch {
      setEditError("Network error");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleAddCourse(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/schools/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program_id: programId,
          name,
          code: code.toUpperCase(),
          credit_hours: parseInt(creditHours) || 3,
          sort_order: courses.length,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to add course");
        return;
      }

      setName("");
      setCode("");
      setCreditHours("3");
      setShowAdd(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(courseId: string) {
    if (!confirm("Delete this course? This cannot be undone.")) return;
    setDeleting(courseId);
    try {
      const res = await fetch(`/api/schools/courses?id=${courseId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to delete course");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to delete course");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Course
        </Button>
      </div>

      {showAdd && (
        <div className="rounded-lg border p-4">
          <form onSubmit={handleAddCourse} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Course Name *</Label>
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Biblical Studies I"
                />
              </div>
              <div>
                <Label>Code *</Label>
                <Input
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. BIB101"
                  className="uppercase"
                />
              </div>
              <div>
                <Label>Credit Hours</Label>
                <Input
                  type="number"
                  min="0"
                  value={creditHours}
                  onChange={(e) => setCreditHours(e.target.value)}
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? "Adding..." : "Add Course"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Course Name</TableHead>
              <TableHead>Credit Hours</TableHead>
              <TableHead className="w-[90px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {courses.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  No courses yet. Add courses to this program.
                </TableCell>
              </TableRow>
            ) : (
              courses.map((course, idx) => (
                <TableRow key={course.id}>
                  <TableCell className="text-muted-foreground">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {course.code}
                  </TableCell>
                  <TableCell className="font-medium">{course.name}</TableCell>
                  <TableCell>{course.credit_hours}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                        onClick={() => startEditCourse(course)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(course.id)}
                        disabled={deleting === course.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Course Dialog */}
      <Dialog open={editingCourse !== null} onOpenChange={(open) => { if (!open) setEditingCourse(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Course</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditCourse} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Course Name *</Label>
              <Input required value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input required value={editCode} onChange={(e) => setEditCode(e.target.value)} className="uppercase" />
              </div>
              <div className="space-y-1.5">
                <Label>Credit Hours</Label>
                <Input type="number" min="0" value={editCreditHours} onChange={(e) => setEditCreditHours(e.target.value)} />
              </div>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingCourse(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={editLoading}>{editLoading ? "Saving..." : "Save Changes"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// STAFF ASSIGN SELECT
// Shared inline picker used in both the applicants and enrollments
// tables, plus the review dialog. Calls a parent-supplied onAssign
// callback so each caller can hit the right API route.
// ────────────────────────────────────────────────────────────

function staffLabel(u: StaffUser | null | undefined) {
  if (!u) return "";
  const first = u.preferred_name || u.first_name || "";
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
// ENROLLMENTS TAB
// ────────────────────────────────────────────────────────────

function EnrollmentsTab({
  programId,
  enrollments,
  allUsers,
  staffOptions,
}: {
  programId: string;
  enrollments: Enrollment[];
  allUsers: UserOption[];
  staffOptions: StaffUser[];
}) {
  const router = useRouter();
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filter out already-enrolled users (a removed enrollment still occupies
  // the unique (user, program) slot, so removed students stay excluded here
  // until they're restored or permanently deleted).
  const enrolledIds = new Set(enrollments.map((e) => e.user_id));
  const availableUsers = allUsers.filter((u) => !enrolledIds.has(u.id));

  async function handleAssignStaff(enrollmentId: string, staffId: string | null) {
    const res = await fetch("/api/schools/enrollments/assign-staff", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrollment_id: enrollmentId, assigned_staff_id: staffId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to assign staff");
      return;
    }
    router.refresh();
  }

  const activeEnrollments = enrollments.filter((e) => !e.removed_at);
  const removedEnrollments = enrollments.filter((e) => e.removed_at);
  const removedCount = removedEnrollments.length;

  const visibleEnrollments = showRemoved
    ? removedEnrollments
    : unassignedOnly
      ? activeEnrollments.filter((e) => !e.assigned_staff_id)
      : activeEnrollments;
  const unassignedCount = activeEnrollments.filter((e) => !e.assigned_staff_id).length;

  async function handleRemove(enrollmentId: string) {
    setBusyId(enrollmentId);
    try {
      const res = await fetch("/api/schools/enrollments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: enrollmentId, removed: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to remove student");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to remove student");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(enrollmentId: string) {
    setBusyId(enrollmentId);
    try {
      const res = await fetch("/api/schools/enrollments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: enrollmentId, removed: false }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to restore student");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to restore student");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(enrollment: Enrollment) {
    if (
      !confirm(
        `Permanently delete ${userName(enrollment.users)} from this school?\n\n` +
          "This removes their enrollment, grades and fees for this program and cannot be undone. " +
          "Their Hub account is not affected."
      )
    ) {
      return;
    }
    setBusyId(enrollment.id);
    try {
      const res = await fetch("/api/schools/enrollments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: enrollment.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to delete student");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to delete student");
    } finally {
      setBusyId(null);
    }
  }

  function userName(u: { first_name: string | null; last_name: string | null; preferred_name: string | null; email: string | null }) {
    if (u.first_name) {
      return `${u.preferred_name ?? u.first_name} ${u.last_name ?? ""}`.trim();
    }
    return u.email ?? "Unknown";
  }

  async function handleEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUserId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/schools/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUserId, program_id: programId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to enroll user");
        return;
      }

      setSelectedUserId("");
      setEnrollOpen(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(enrollmentId: string, newStatus: string) {
    setUpdatingStatus(enrollmentId);
    try {
      const res = await fetch("/api/schools/enrollments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: enrollmentId, status: newStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to update status");
        return;
      }

      router.refresh();
    } catch {
      alert("Failed to update status");
    } finally {
      setUpdatingStatus(null);
    }
  }

  const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
    waiting_for_arrival: "secondary",
    arrived: "default",
    graduated: "secondary",
    dismissed: "destructive",
    decided_to_leave: "secondary",
    // legacy fallbacks (pre-migration data, just in case)
    active: "default",
    completed: "secondary",
    withdrawn: "destructive",
    on_hold: "secondary",
  };

  const statusLabels = ENROLLMENT_STATUS_LABELS;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setUnassignedOnly((v) => !v);
              setShowRemoved(false);
            }}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              unassignedOnly && !showRemoved
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Unassigned
            <span className="rounded-full bg-background/60 px-1.5 py-0.5 text-[10px] font-bold">
              {unassignedCount}
            </span>
          </button>
          {removedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowRemoved((v) => !v);
                setUnassignedOnly(false);
              }}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                showRemoved
                  ? "border-destructive bg-destructive/15 text-destructive"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Removed
              <span className="rounded-full bg-background/60 px-1.5 py-0.5 text-[10px] font-bold">
                {removedCount}
              </span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StudentsExportPanel programId={programId} enrollments={enrollments} />
          <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Enroll Student
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enroll Student</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEnroll} className="space-y-4">
              <div>
                <Label>Select Student</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a student..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.length === 0 ? (
                      <SelectItem value="_none" disabled>
                        All users are already enrolled
                      </SelectItem>
                    ) : (
                      availableUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {userName(u)} {u.email ? `(${u.email})` : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEnrollOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !selectedUserId}
                >
                  {loading ? "Enrolling..." : "Enroll"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Enrolled</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned Staff</TableHead>
              <TableHead className="w-[1%]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleEnrollments.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  {showRemoved
                    ? "No removed students."
                    : enrollments.length === 0
                      ? "No students enrolled yet."
                      : "No enrollments match the current filter."}
                </TableCell>
              </TableRow>
            ) : (
              visibleEnrollments.map((enrollment) => (
                <TableRow
                  key={enrollment.id}
                  className={enrollment.removed_at ? "opacity-60" : undefined}
                >
                  <TableCell className="font-medium">
                    {userName(enrollment.users)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {enrollment.users.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(enrollment.enrolled_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={enrollment.status}
                      onValueChange={(val) =>
                        handleStatusChange(enrollment.id, val)
                      }
                      disabled={updatingStatus === enrollment.id}
                    >
                      <SelectTrigger className="w-[170px]">
                        <Badge variant={statusColors[enrollment.status] ?? "secondary"}>
                          {statusLabels[enrollment.status] ?? enrollment.status}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="waiting_for_arrival">Waiting for Arrival</SelectItem>
                        <SelectItem value="arrived">Arrived</SelectItem>
                        <SelectItem value="dismissed">Dismissed</SelectItem>
                        <SelectItem value="decided_to_leave">Decided to Leave</SelectItem>
                        <SelectItem value="graduated">Graduated</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <StaffAssignSelect
                      value={enrollment.assigned_staff_id}
                      staffOptions={staffOptions}
                      onAssign={(staffId) =>
                        handleAssignStaff(enrollment.id, staffId)
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={busyId === enrollment.id}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Student actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {enrollment.removed_at ? (
                          <>
                            <DropdownMenuItem
                              onClick={() => handleRestore(enrollment.id)}
                            >
                              <RotateCcw className="mr-2 h-4 w-4" />
                              Restore to school
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleDelete(enrollment)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete permanently
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleRemove(enrollment.id)}
                          >
                            <UserMinus className="mr-2 h-4 w-4" />
                            Remove from school
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// GRADES TAB
// ────────────────────────────────────────────────────────────

function GradesTab({
  programId,
  courses,
  enrollments,
  grades,
}: {
  programId: string;
  courses: Course[];
  enrollments: Enrollment[];
  grades: GradeRow[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Build a map: enrollmentId -> courseId -> letterGrade
  const gradeMap = new Map<string, Map<string, string>>();
  for (const g of grades) {
    if (!gradeMap.has(g.enrollment_id)) {
      gradeMap.set(g.enrollment_id, new Map());
    }
    if (g.letter_grade) {
      gradeMap.get(g.enrollment_id)!.set(g.course_id, g.letter_grade);
    }
  }

  // Local state for edits
  const [edits, setEdits] = useState<
    Map<string, Map<string, string | null>>
  >(new Map());

  function getGrade(enrollmentId: string, courseId: string): string {
    // Check local edits first
    const editVal = edits.get(enrollmentId)?.get(courseId);
    if (editVal !== undefined) return editVal ?? "";
    // Then check server data
    return gradeMap.get(enrollmentId)?.get(courseId) ?? "";
  }

  function setGrade(enrollmentId: string, courseId: string, grade: string) {
    setEdits((prev) => {
      const next = new Map(prev);
      if (!next.has(enrollmentId)) {
        next.set(enrollmentId, new Map());
      }
      next.get(enrollmentId)!.set(courseId, grade || null);
      return next;
    });
    setSuccess(false);
  }

  function userName(e: Enrollment) {
    const u = e.users;
    if (u.first_name) {
      return `${u.preferred_name ?? u.first_name} ${u.last_name ?? ""}`.trim();
    }
    return u.email ?? "Unknown";
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);

    // Collect all grades (edits + existing)
    const allGrades: Array<{
      enrollment_id: string;
      course_id: string;
      letter_grade: string | null;
    }> = [];

    for (const enrollment of enrollments) {
      for (const course of courses) {
        const grade = getGrade(enrollment.id, course.id);
        if (grade) {
          allGrades.push({
            enrollment_id: enrollment.id,
            course_id: course.id,
            letter_grade: grade,
          });
        }
      }
    }

    if (allGrades.length === 0) {
      setError("No grades to save");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/schools/grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grades: allGrades }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save grades");
        return;
      }

      setEdits(new Map());
      setSuccess(true);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  // Filter to active enrollments for grading
  const activeEnrollments = enrollments.filter(
    (e) => e.status === "active" || e.status === "completed"
  );

  if (courses.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-8 text-center">
        Add courses before entering grades.
      </p>
    );
  }

  if (activeEnrollments.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-8 text-center">
        Enroll students before entering grades.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Enter grades for each student. Click Save All when done.
        </p>
        <div className="flex items-center gap-3">
          {success && (
            <span className="text-sm text-green-600">Grades saved!</span>
          )}
          {error && <span className="text-sm text-destructive">{error}</span>}
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? "Saving..." : "Save All Grades"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-card z-10 min-w-[180px]">
                Student
              </TableHead>
              {courses.map((course) => (
                <TableHead key={course.id} className="text-center min-w-[100px]">
                  <div className="font-mono text-xs">{course.code}</div>
                  <div className="text-xs font-normal text-muted-foreground truncate max-w-[120px]">
                    {course.name}
                  </div>
                </TableHead>
              ))}
              <TableHead className="text-center min-w-[80px]">
                Transcript
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeEnrollments.map((enrollment) => (
              <TableRow key={enrollment.id}>
                <TableCell className="sticky left-0 bg-card z-10 font-medium">
                  {userName(enrollment)}
                </TableCell>
                {courses.map((course) => (
                  <TableCell key={course.id} className="p-1">
                    <Select
                      value={getGrade(enrollment.id, course.id) || "_empty"}
                      onValueChange={(val) =>
                        setGrade(
                          enrollment.id,
                          course.id,
                          val === "_empty" ? "" : val
                        )
                      }
                    >
                      <SelectTrigger className="h-8 text-center text-sm">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_empty">—</SelectItem>
                        {LETTER_GRADES.map((g) => (
                          <SelectItem key={g} value={g}>
                            {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                ))}
                <TableCell className="text-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-primary"
                    onClick={() => {
                      window.open(
                        `/api/schools/transcript?userId=${enrollment.user_id}&programId=${programId}`,
                        "_blank"
                      );
                    }}
                    title="Download Transcript"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

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

const ALL_STATUSES = [
  { key: "all", label: "All" },
  { key: "submitted", label: "Submitted" },
  { key: "waiting_for_references", label: "Waiting for Refs" },
  { key: "references_received", label: "Refs Received" },
  { key: "interview_scheduled", label: "Interview" },
  { key: "accepted", label: "Accepted" },
  { key: "waitlisted", label: "Waitlisted" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
] as const;

function ApplicantsTab({
  programId,
  programCode,
  responses,
  removedResponses,
  referenceSlots,
  refRequestSummaries,
  questions,
  staffOptions,
}: {
  programId: string;
  programCode: string;
  responses: AppResponse[];
  removedResponses: AppResponse[];
  referenceSlots: ReferenceSlot[];
  refRequestSummaries: RefRequestSummary[];
  questions: AppQuestion[];
  staffOptions: StaffUser[];
}) {
  const router = useRouter();
  const [reviewingResponse, setReviewingResponse] = useState<AppResponse | null>(null);

  // Reference display in review dialog
  const [reviewReferences, setReviewReferences] = useState<ReferenceRequest[]>([]);
  const [refsLoading, setRefsLoading] = useState(false);

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
              : "Reference updated, but the invite email could not be sent. Use 'Remind' to retry."
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
  const [reviewLoading, setReviewLoading] = useState(false);

  // Pipeline filter & search
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [unassignedOnly, setUnassignedOnly] = useState(false);

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
      if (u.first_name) return `${u.preferred_name ?? u.first_name} ${u.last_name ?? ""}`.trim();
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
    waiting_for_references: "secondary",
    references_received: "secondary",
    interview_scheduled: "secondary",
    accepted: "default",
    rejected: "destructive",
    waitlisted: "secondary",
    cancelled: "secondary",
  };

  // Compute status counts for pipeline chips
  const statusCounts: Record<string, number> = {};
  for (const resp of responses) {
    statusCounts[resp.status] = (statusCounts[resp.status] ?? 0) + 1;
  }

  const unassignedCount = responses.filter((r) => !r.assigned_staff_id).length;

  // "Removed" is a virtual filter that swaps the data source to the archive bin.
  const isRemovedView = statusFilter === "removed";
  const sourceResponses = isRemovedView ? removedResponses : responses;

  // Filter responses by status, search, and unassigned-only toggle.
  const filteredResponses = sourceResponses.filter((resp) => {
    if (!isRemovedView && statusFilter !== "all" && resp.status !== statusFilter) return false;
    if (unassignedOnly && resp.assigned_staff_id) return false;
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
    if (selectedIds.size === 0 || !bulkStatus) return;
    setBulkLoading(true);
    try {
      const res = await fetch("/api/schools/applications/responses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          status: bulkStatus,
          send_email: true,
        }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        setBulkStatus("");
        router.refresh();
      }
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
      if (res.ok) {
        alert("Reminder sent!");
        fetchReferences(reviewingResponse!.id);
      } else {
        const data = await res.json();
        alert(data.error || "Failed to send reminder");
      }
    } catch {
      alert("Failed to send reminder");
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

  async function handleReviewSave() {
    if (!reviewingResponse || !reviewStatus) return;
    setReviewLoading(true);

    try {
      // Accept flow — always route through the accept-application pipeline so the
      // student is automatically enrolled (and, for public applicants, a user
      // account is created and an invite email is sent).
      if (reviewStatus === "accepted") {
        const res = await fetch("/api/admin/accept-application", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            response_id: reviewingResponse.id,
            admin_notes: reviewNotes.trim() || null,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          alert(data.error || "Failed to accept application");
          return;
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
          status: reviewStatus,
          admin_notes: reviewNotes.trim() || null,
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

  return (
    <div className="space-y-6">
      {/* Pipeline Filter Chips & Search */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium">Applicant Pipeline</h3>
          </div>
          {responses.length > 0 && (
            <div className="flex items-center gap-2">
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

        {/* Status filter chips */}
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.map(({ key, label }) => {
            const count = key === "all" ? responses.length : (statusCounts[key] ?? 0);
            const isActive = statusFilter === key;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background/50"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => setUnassignedOnly((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              unassignedOnly
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            title="Show only applicants with no staff assigned"
          >
            Unassigned
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              unassignedOnly ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background/50"
            }`}>
              {unassignedCount}
            </span>
          </button>
          {removedResponses.length > 0 && (
            <button
              onClick={() => setStatusFilter(isRemovedView ? "all" : "removed")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                isRemovedView
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              title="Applications removed from the pipeline"
            >
              <Archive className="h-3 w-3" />
              Removed
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                isRemovedView ? "bg-destructive-foreground/20 text-destructive-foreground" : "bg-background/50"
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
        <div className="rounded-lg border bg-card p-4 space-y-4">
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
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{analytics.total}</p>
                  <p className="text-xs text-muted-foreground">Total Applications</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">
                    {analytics.avgDaysToDecision !== null ? `${analytics.avgDaysToDecision}d` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Avg. Time to Decision</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">
                    {analytics.refCompletionRate !== null ? `${analytics.refCompletionRate}%` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Reference Completion</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
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
                          className="w-full rounded-t bg-primary/60 min-h-[2px]"
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
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground flex items-start gap-2">
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
        <div className="rounded-lg border bg-primary/5 border-primary/30 p-3 flex items-center gap-3">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <Select value={bulkStatus} onValueChange={setBulkStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Set status..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="waiting_for_references">Waiting for References</SelectItem>
              <SelectItem value="references_received">References Received</SelectItem>
              <SelectItem value="interview_scheduled">Interview Scheduled</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="waitlisted">Waitlisted</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
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
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  {!isRemovedView && (
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selectedIds.size === filteredResponses.length && filteredResponses.length > 0}
                      onChange={toggleSelectAll}
                    />
                  )}
                </TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                {referenceSlots.length > 0 && <TableHead>References</TableHead>}
                <TableHead>Assigned</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredResponses.map((resp) => (
                <TableRow key={resp.id} className={selectedIds.has(resp.id) ? "bg-primary/5" : ""}>
                  <TableCell>
                    {!isRemovedView && (
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedIds.has(resp.id)}
                        onChange={() => toggleSelect(resp.id)}
                      />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {respName(resp)}
                    {!resp.user_id && (
                      <Badge variant="secondary" className="ml-2 text-xs">Public</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {respEmail(resp)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(resp.submitted_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const refs = refRequestSummaries.filter((r) => r.application_id === resp.id);
                      const totalRefs = refs.length;
                      const submittedRefs = refs.filter((r) => r.status === "submitted").length;
                      const allRefsIn = totalRefs > 0 && submittedRefs === totalRefs;
                      const isComplete = allRefsIn && resp.status === "submitted";

                      if (isComplete) {
                        return (
                          <Badge style={{ background: "hsl(142 55% 25%)", color: "hsl(142 55% 75%)", border: "1px solid hsl(142 55% 35%)" }}>
                            Complete
                          </Badge>
                        );
                      }
                      return (
                        <Badge variant={responseStatusColors[resp.status] ?? "secondary"}>
                          {resp.status.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        </Badge>
                      );
                    })()}
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
                            <span className={`text-xs font-medium ${allIn ? "text-green-500" : "text-yellow-500"}`}>
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
                            setReviewingResponse(resp);
                            setReviewStatus(resp.status);
                            setReviewNotes(resp.admin_notes ?? "");
                            fetchReferences(resp.id);
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

      {/* Review Dialog */}
      <Dialog
        open={reviewingResponse !== null}
        onOpenChange={(open) => {
          if (!open) setReviewingResponse(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Application Review — {reviewingResponse && respName(reviewingResponse)}
            </DialogTitle>
          </DialogHeader>

          {reviewingResponse && (
            <div className="space-y-6">
              {/* Applicant Info */}
              <div className="text-sm text-muted-foreground space-y-1">
                <p>Email: {respEmail(reviewingResponse)}</p>
                <p>
                  Submitted:{" "}
                  {new Date(reviewingResponse.submitted_at).toLocaleDateString()}
                </p>
                {!reviewingResponse.user_id && reviewingResponse.applicant_info && (
                  <div className="mt-3 rounded-md bg-muted p-3 space-y-1">
                    <p className="text-xs font-medium text-foreground uppercase tracking-wider mb-2">Applicant Details</p>
                    {reviewingResponse.applicant_info.phone && (
                      <p>Phone: {reviewingResponse.applicant_info.phone}</p>
                    )}
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

              {/* Answers */}
              <div className="space-y-4">
                {reviewingResponse.answers.map((a, idx) => {
                  const isPhoto = isStoragePath(a.answer ?? "");
                  return (
                    <div key={idx} className="space-y-1">
                      <Label className="text-sm font-medium">
                        {a.question_label}
                      </Label>
                      <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
                        {!a.answer ? (
                          <span className="text-muted-foreground italic">No answer provided</span>
                        ) : isPhoto ? (
                          <StorageImage storagePath={a.answer} />
                        ) : (
                          a.answer
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* References */}
              {referenceSlots.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">References</h4>
                  {!refsLoading &&
                    referenceSlots.some(
                      (slot) =>
                        slot.is_required &&
                        !reviewReferences.some((ref) => ref.slot_id === slot.id)
                    ) && (
                      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
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
                            className="h-8 gap-1.5 border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
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
                        <div key={ref.id} className="rounded-lg border bg-muted/50 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">
                                {ref.reference_slots?.label ?? "Reference"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {ref.referee_name} · {ref.referee_email}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {ref.status !== "submitted" && editingRefId !== ref.id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-xs gap-1"
                                  onClick={() => startEditReference(ref)}
                                  title="Change reference name or email"
                                >
                                  <Edit2 className="h-3 w-3" />
                                  Edit
                                </Button>
                              )}
                              {ref.status !== "submitted" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-xs gap-1"
                                  disabled={sendingReminder === ref.id}
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
                              <Badge variant={ref.status === "submitted" ? "default" : "secondary"}>
                                {ref.status === "submitted" ? "Submitted" : "Pending"}
                              </Badge>
                            </div>
                          </div>

                          {/* Inline edit: swap a pending referee's name/email */}
                          {editingRefId === ref.id && (
                            <div className="rounded-md border bg-background p-3 space-y-3">
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
                                    trimmed === "Excellent" ? "text-green-500" :
                                    trimmed === "Good" ? "text-blue-400" :
                                    trimmed === "Fair" ? "text-yellow-500" :
                                    trimmed === "Poor" ? "text-red-400" : null;
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
                                          rating === "Excellent" ? "text-green-500" :
                                          rating === "Good" ? "text-blue-400" :
                                          rating === "Fair" ? "text-yellow-500" :
                                          "text-red-400"
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

              {/* Admin Notes */}
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Internal notes about this applicant (not visible to the applicant)"
                  rows={3}
                />
              </div>

              {/* Status Update */}
              <div className="flex items-center gap-4 pt-2">
                <Label>Decision:</Label>
                <Select value={reviewStatus} onValueChange={setReviewStatus}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="waiting_for_references">Waiting for References</SelectItem>
                    <SelectItem value="references_received">References Received</SelectItem>
                    <SelectItem value="interview_scheduled">Interview Scheduled</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="waitlisted">Waitlisted</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleReviewSave}
                  disabled={reviewLoading || (reviewStatus === reviewingResponse.status && (reviewNotes.trim() || "") === (reviewingResponse.admin_notes || ""))}
                  size="sm"
                >
                  {reviewLoading ? "Saving..." : "Save Decision"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// APPLICATION TAB
// ────────────────────────────────────────────────────────────

function ApplicationTab({
  programId,
  programCode,
  applicationOpen,
  applicationDeadline,
  acceptanceEmailSubject,
  acceptanceEmailBody,
  questions,
  referenceSlots,
  referenceQuestions,
}: {
  programId: string;
  programCode: string;
  applicationOpen: boolean;
  applicationDeadline: string | null;
  acceptanceEmailSubject: string | null;
  acceptanceEmailBody: string | null;
  questions: AppQuestion[];
  referenceSlots: ReferenceSlot[];
  referenceQuestions: TreeQuestion[];
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

  // Acceptance email state
  const [emailSubject, setEmailSubject] = useState(acceptanceEmailSubject ?? "");
  const [emailBody, setEmailBody] = useState(acceptanceEmailBody ?? "");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  async function handleSaveAcceptanceEmail() {
    setEmailSaving(true);
    setEmailError(null);
    setEmailSaved(false);
    try {
      const res = await fetch("/api/schools/programs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: programId,
          acceptance_email_subject: emailSubject.trim() || null,
          acceptance_email_body: emailBody.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailError(data.error || "Failed to save acceptance email");
        return;
      }
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 2500);
      router.refresh();
    } catch {
      setEmailError("Network error");
    } finally {
      setEmailSaving(false);
    }
  }

  function handleResetAcceptanceEmail() {
    setEmailSubject("");
    setEmailBody("");
  }

  function copyPublicLink() {
    const link = `${window.location.origin}/apply/${programId}`;
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
      if (res.ok) router.refresh();
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
      <div className="rounded-lg border p-4 space-y-4">
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
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <LinkIcon className="h-4 w-4" />
                Public Application Link
              </div>
              <p className="text-xs text-muted-foreground">
                Share this link with prospective students. They can apply without needing an account.
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border bg-background px-3 py-2 text-sm font-mono select-all truncate">
                  {`${window.location.origin}/apply/${programId}`}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-2"
                  onClick={copyPublicLink}
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 text-green-500" />
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
            <div className="rounded-lg border p-4 space-y-3">
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
        <div className="flex items-center justify-between">
          <h3 className="font-medium flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            Application Questions ({questions.length})
          </h3>
          <div className="flex gap-2">
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
            {questions.length > 0 && (
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
        </div>

        {/* Save as Template Dialog */}
        {showSaveTemplate && (
          <div className="rounded-lg border bg-card p-4 space-y-3">
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
          <div className="rounded-lg border bg-card p-4 space-y-3">
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
                  <div key={t.id} className="flex items-center gap-3 rounded-md border p-3">
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
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteTemplate(t.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
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
          <div className="rounded-lg border p-4">
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
                      className="rounded"
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
                <div className="rounded-md border bg-muted/30 p-3 space-y-3">
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

        {/* Questions List */}
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No questions yet. Add questions to build the application form.
          </p>
        ) : (
          <div className="space-y-2">
            <QuestionTree
              questions={questions}
              onEdit={startEdit}
              onDelete={handleDeleteQuestion}
              onReorder={handleReorderSiblings}
              onAddFollowUp={startAddFollowUp}
            />
          </div>
        )}
      </div>

      {/* ─── REFERENCE SLOTS ─── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Reference Slots ({referenceSlots.length})</h3>
          {!showAddSlot && !editingSlot && (
            <Button size="sm" variant="outline" onClick={() => setShowAddSlot(true)}>
              <Plus className="mr-1 h-3 w-3" /> Add Reference Slot
            </Button>
          )}
        </div>

        {(showAddSlot || editingSlot) && (
          <form onSubmit={handleSaveSlot} className="space-y-3 rounded-lg border bg-card p-4">
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
                className="rounded"
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

        {referenceSlots.length === 0 && !showAddSlot ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No reference slots configured. Add one to require references from applicants.
          </p>
        ) : (
          <div className="space-y-2">
            {referenceSlots.map((slot, idx) => (
              <div
                key={slot.id}
                className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {slot.label}
                    {slot.is_required && (
                      <span className="ml-2 text-xs text-muted-foreground">Required</span>
                    )}
                  </p>
                  {slot.description && (
                    <p className="text-xs text-muted-foreground truncate">{slot.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    disabled={idx === 0}
                    onClick={() => handleMoveSlot(slot.id, "up")}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    disabled={idx === referenceSlots.length - 1}
                    onClick={() => handleMoveSlot(slot.id, "down")}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => startEditSlot(slot)}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteSlot(slot.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── REFERENCE QUESTIONS ─── */}
      <ReferenceQuestionsBuilder
        programId={programId}
        questions={referenceQuestions}
      />

      {/* ─── ACCEPTANCE EMAIL ─── */}
      <div className="space-y-4">
        <div>
          <h3 className="font-medium">Acceptance Email</h3>
          <p className="text-xs text-muted-foreground mt-1">
            The message applicants receive when you accept them into this
            program. Leave blank to use the default. Use{" "}
            <code className="font-mono">{"{{first_name}}"}</code> for the
            applicant&apos;s name and{" "}
            <code className="font-mono">{"{{program_name}}"}</code> for this
            program&apos;s name &mdash; both get replaced when the email is
            sent. Common variants (
            <code className="font-mono">{"{{name}}"}</code>,{" "}
            <code className="font-mono">[Your Name]</code>,{" "}
            <code className="font-mono">{"{first_name}"}</code>) also work.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="space-y-1.5">
            <Label htmlFor="acceptance-subject">Subject Line</Label>
            <Input
              id="acceptance-subject"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder={`You've been accepted to {{program_name}}`}
            />
            <p className="text-xs text-muted-foreground">
              Default if blank:{" "}
              <span className="font-mono">
                You&apos;ve been accepted to {programCode}
              </span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acceptance-body">Message</Label>
            <Textarea
              id="acceptance-body"
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              rows={10}
              placeholder={`Hi {{first_name}},\n\nWe're thrilled to welcome you to {{program_name}}! Your application has been accepted and we can't wait to journey with you.\n\nLook out for a follow-up email with arrival details and a packing list.\n\nBlessings,\nThe FFSA Team`}
            />
            <p className="text-xs text-muted-foreground">
              Plain text. Blank lines become paragraph breaks. Paste any{" "}
              <span className="font-mono">https://</span> URL and it&apos;ll
              become clickable; for custom anchor text use{" "}
              <code className="font-mono">[click here](https://example.com)</code>
              . The FFSA branded header, footer, and the &ldquo;set up your
              account&rdquo; button are added automatically.
            </p>
          </div>

          {emailError && (
            <p className="text-sm text-destructive">{emailError}</p>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleSaveAcceptanceEmail}
              disabled={emailSaving}
            >
              {emailSaving ? "Saving..." : "Save Email"}
            </Button>
            {(emailSubject || emailBody) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleResetAcceptanceEmail}
                disabled={emailSaving}
              >
                Reset to default
              </Button>
            )}
            {emailSaved && (
              <span className="text-xs text-muted-foreground">Saved.</span>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

