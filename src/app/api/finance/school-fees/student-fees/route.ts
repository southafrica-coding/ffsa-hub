import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createStudentFee,
  updateStudentFee,
  getCountryTiers,
  getFeeStructuresByProgram,
} from "@/services/school-fees";
import {
  createAndSendInvoice,
  getStoredTokens,
  voidInvoice,
  getXeroRegionForStudent,
} from "@/services/xero";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  // ── Bulk assign: { bulk: true, program_id, students: [...] } ──
  if (body.bulk) {
    const { program_id, students } = body as {
      bulk: true;
      program_id: string;
      students: {
        enrollment_id: string;
        user_id: string;
        nationality: string | null;
      }[];
    };

    if (!program_id || !students?.length) {
      return NextResponse.json(
        { error: "program_id and students[] are required" },
        { status: 400 }
      );
    }

    // Load country tiers + fee structures for this program
    const [{ data: tiers }, { data: structures }] = await Promise.all([
      getCountryTiers(supabase),
      getFeeStructuresByProgram(supabase, program_id),
    ]);

    const tierMap = new Map<string, string>(
      (tiers ?? []).map((t: { country_name: string; tier: string }) => [
        t.country_name.toLowerCase(),
        t.tier,
      ])
    );
    type Structure = {
      tier: string;
      tuition_zar: number;
      accommodation_zar: number;
      meals_zar: number;
      materials_zar: number;
      total_zar: number;
    };
    const structureMap = new Map<string, Structure>(
      ((structures ?? []) as Structure[]).map((s) => [s.tier, s])
    );

    let assigned = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const s of students) {
      const lookupTier = tierMap.get((s.nationality ?? "").toLowerCase());
      const detectedTier: string = lookupTier ?? "A";
      const structure = structureMap.get(detectedTier);

      if (!structure) {
        skipped++;
        continue;
      }

      const { error } = await createStudentFee(supabase, {
        enrollment_id: s.enrollment_id,
        user_id: s.user_id,
        program_id,
        tier: detectedTier,
        tuition_zar: Number(structure.tuition_zar),
        accommodation_zar: Number(structure.accommodation_zar),
        meals_zar: Number(structure.meals_zar),
        materials_zar: Number(structure.materials_zar),
        total_due_zar: Number(structure.total_zar),
      });

      if (error) {
        errors.push(`${s.user_id}: ${error.message}`);
      } else {
        assigned++;
      }
    }

    return NextResponse.json({
      success: true,
      assigned,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  // ── Single assign ──
  const { enrollment_id, user_id, program_id, tier } = body;

  if (!enrollment_id || !user_id || !program_id || !tier) {
    return NextResponse.json(
      { error: "enrollment_id, user_id, program_id, and tier are required" },
      { status: 400 }
    );
  }

  const { data, error } = await createStudentFee(supabase, {
    enrollment_id,
    user_id,
    program_id,
    tier,
    tier_override: body.tier_override ?? false,
    tuition_zar: body.tuition_zar ?? 0,
    accommodation_zar: body.accommodation_zar ?? 0,
    meals_zar: body.meals_zar ?? 0,
    materials_zar: body.materials_zar ?? 0,
    total_due_zar: body.total_due_zar ?? 0,
    discount_zar: body.discount_zar ?? 0,
    scholarship_zar: body.scholarship_zar ?? 0,
    notes: body.notes ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── Auto-create Xero invoice if connected ──
  let xeroResult: { invoiceId?: string; invoiceNumber?: string; error?: string; region?: string } | null = null;

  // Fetch student details (email + nationality) to determine Xero region
  const { data: studentData } = await supabase
    .from("users")
    .select("email, first_name, last_name, preferred_name, nationality")
    .eq("id", user_id)
    .single();

  const region = getXeroRegionForStudent(studentData?.nationality ?? null);
  const xeroTokens = await getStoredTokens(supabase, region);

  console.log("=== XERO INVOICE CHECK ===");
  console.log("Student nationality:", studentData?.nationality);
  console.log("Xero region:", region);
  console.log("Xero tokens found:", !!xeroTokens);
  console.log("Student fee data ID:", data?.id);

  if (xeroTokens && data?.id) {
    const { data: programData } = await supabase
      .from("programs")
      .select("name")
      .eq("id", program_id)
      .single();

    console.log("Student email:", studentData?.email);
    console.log("Program name:", programData?.name);

    if (studentData?.email) {
      const sName =
        (studentData.first_name || "") +
        " " +
        (studentData.last_name || "");

      console.log("Creating Xero invoice for:", sName, studentData.email, `(${region})`);
      xeroResult = await createAndSendInvoice(supabase, {
        studentFeeId: data.id,
        studentEmail: studentData.email,
        studentName: sName.trim() || "Student",
        programName: programData?.name ?? "Program",
        tier,
        tuition: body.tuition_zar ?? 0,
        accommodation: body.accommodation_zar ?? 0,
        meals: body.meals_zar ?? 0,
        materials: body.materials_zar ?? 0,
        totalDue: body.total_due_zar ?? 0,
        discount: body.discount_zar ?? 0,
        scholarship: body.scholarship_zar ?? 0,
        finalAmount:
          (body.total_due_zar ?? 0) -
          (body.discount_zar ?? 0) -
          (body.scholarship_zar ?? 0),
        region,
      });
    }
  }

  return NextResponse.json({
    success: true,
    data,
    xero: xeroResult ?? undefined,
  });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { id, ...updateData } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Fetch the existing student fee BEFORE updating (to get old Xero invoice ID + student nationality)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingFee } = await (supabase as any)
    .from("student_fees")
    .select("*, users!student_fees_user_id_fkey(id, email, first_name, last_name, preferred_name, nationality)")
    .eq("id", id)
    .single();

  const { data, error } = await updateStudentFee(supabase, id, updateData);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── Void old Xero invoice + create new one if tier changed ──
  let xeroResult: {
    invoiceId?: string;
    invoiceNumber?: string;
    error?: string;
    voidedOld?: boolean;
    region?: string;
  } | null = null;

  const tierChanged = updateData.tier && existingFee && updateData.tier !== existingFee.tier;

  // Determine Xero region from student nationality
  const studentUser = existingFee?.users;
  const region = getXeroRegionForStudent(studentUser?.nationality ?? null);
  const xeroTokens = await getStoredTokens(supabase, region);

  console.log("=== XERO TIER CHANGE CHECK ===");
  console.log("Student nationality:", studentUser?.nationality);
  console.log("Xero region:", region);
  console.log("Xero tokens found:", !!xeroTokens);
  console.log("Tier changed:", tierChanged, `(${existingFee?.tier} → ${updateData.tier})`);
  console.log("Old Xero invoice:", existingFee?.xero_invoice_id);

  if (xeroTokens && tierChanged && data) {
    // 1. Void the old invoice if one exists
    let voidedOld = false;
    if (existingFee?.xero_invoice_id) {
      console.log("Voiding old Xero invoice:", existingFee.xero_invoice_id);
      // Try voiding in the same region first; if the student's nationality changed,
      // the old invoice might be in a different region — try both
      const voidResult = await voidInvoice(supabase, existingFee.xero_invoice_id, region);
      if (!voidResult.success) {
        // Try the other region
        const otherRegion = region === "za" ? "us" : "za";
        const voidResult2 = await voidInvoice(supabase, existingFee.xero_invoice_id, otherRegion);
        voidedOld = voidResult2.success;
        if (!voidResult2.success) {
          console.error("Failed to void old invoice in both regions:", voidResult.error);
        }
      } else {
        voidedOld = true;
      }

      // Clear old invoice references
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("student_fees")
        .update({
          xero_invoice_id: null,
          xero_invoice_number: null,
          xero_invoice_url: null,
        })
        .eq("id", id);
    }

    // 2. Create new invoice with updated amounts
    const studentEmail = studentUser?.email;

    if (studentEmail) {
      // Fetch program name
      const { data: programData } = await supabase
        .from("programs")
        .select("name")
        .eq("id", existingFee.program_id)
        .single();

      const sName =
        (studentUser.first_name || "") +
        " " +
        (studentUser.last_name || "");

      console.log("Creating new Xero invoice for:", sName.trim(), studentEmail, `(${region})`);
      const invoiceResult = await createAndSendInvoice(supabase, {
        studentFeeId: id,
        studentEmail,
        studentName: sName.trim() || "Student",
        programName: programData?.name ?? "Program",
        tier: updateData.tier,
        tuition: updateData.tuition_zar ?? existingFee.tuition_zar ?? 0,
        accommodation: updateData.accommodation_zar ?? existingFee.accommodation_zar ?? 0,
        meals: updateData.meals_zar ?? existingFee.meals_zar ?? 0,
        materials: updateData.materials_zar ?? existingFee.materials_zar ?? 0,
        totalDue: updateData.total_due_zar ?? existingFee.total_due_zar ?? 0,
        discount: updateData.discount_zar ?? existingFee.discount_zar ?? 0,
        scholarship: updateData.scholarship_zar ?? existingFee.scholarship_zar ?? 0,
        finalAmount:
          (updateData.total_due_zar ?? existingFee.total_due_zar ?? 0) -
          (updateData.discount_zar ?? existingFee.discount_zar ?? 0) -
          (updateData.scholarship_zar ?? existingFee.scholarship_zar ?? 0),
        region,
      });

      xeroResult = {
        invoiceId: invoiceResult.invoiceId,
        invoiceNumber: invoiceResult.invoiceNumber,
        error: invoiceResult.error,
        voidedOld,
        region,
      };
    } else {
      console.log("No student email found — skipping Xero invoice");
    }
  }

  return NextResponse.json({ success: true, data, xero: xeroResult ?? undefined });
}
