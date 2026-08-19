import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createReferenceSlot,
  updateReferenceSlot,
  deleteReferenceSlot,
  getReferenceSlotById,
  countRequiredReferenceSlots,
} from "@/services/schools";

// Every FFSA school requires its references, and the whole applicant-facing
// story is built on that: the apply form blocks submission without them, the
// confirmation email says the review waits for them, and the status tracker
// counts them in. A program left with no required slot would quietly break all
// three — applications would sail through with nobody to vouch for anyone.
//
// So the last required slot can't be deleted or made optional. Both guards live
// here rather than in a DB constraint because the rule is "not fewer than one",
// which a CHECK on a single row can't see.
const LAST_SLOT_ERROR =
  "This is the program's last required reference. A school can't take applications without at least one, so add another reference first if you want to replace this one.";

async function wouldLeaveNoRequiredSlot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  slotId: string
): Promise<boolean> {
  const { data: slot } = await getReferenceSlotById(supabase, slotId);
  // Slot missing, or already optional → removing it changes no requirement.
  if (!slot?.is_required) return false;
  const { count } = await countRequiredReferenceSlots(supabase, slot.program_id);
  return (count ?? 0) <= 1;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { program_id, label, description, sort_order, is_required } = body;

  if (!program_id || !label) {
    return NextResponse.json(
      { error: "program_id and label are required" },
      { status: 400 }
    );
  }

  const { data, error } = await createReferenceSlot(supabase, {
    program_id,
    label,
    description: description || null,
    sort_order: sort_order ?? 0,
    is_required: is_required ?? true,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, slot: data });
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
  const { id, label, description, sort_order, is_required } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Demoting the last required reference is the same loss as deleting it.
  if (is_required === false && (await wouldLeaveNoRequiredSlot(supabase, id))) {
    return NextResponse.json({ error: LAST_SLOT_ERROR }, { status: 409 });
  }

  const updateData: Record<string, unknown> = {};
  if (label !== undefined) updateData.label = label;
  if (description !== undefined) updateData.description = description;
  if (sort_order !== undefined) updateData.sort_order = sort_order;
  if (is_required !== undefined) updateData.is_required = is_required;

  const { data, error } = await updateReferenceSlot(supabase, id, updateData);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, slot: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (await wouldLeaveNoRequiredSlot(supabase, id)) {
    return NextResponse.json({ error: LAST_SLOT_ERROR }, { status: 409 });
  }

  const { error } = await deleteReferenceSlot(supabase, id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
