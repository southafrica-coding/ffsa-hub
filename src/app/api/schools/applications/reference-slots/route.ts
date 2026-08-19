import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createReferenceSlot,
  updateReferenceSlot,
  deleteReferenceSlot,
  getReferenceSlotById,
  countRequiredReferenceSlots,
} from "@/services/schools";
import { MIN_REQUIRED_REFERENCE_SLOTS } from "@/lib/references/minimum-slots";

// A program can't be taken below the floor, by deletion or by demoting a slot
// to optional — see minimum-slots.ts for why the number matters. Both guards
// live here rather than in a DB constraint because the rule counts sibling
// rows, which a CHECK can't see.
const MIN_SLOTS_ERROR = `Every school asks for at least ${MIN_REQUIRED_REFERENCE_SLOTS} references. Add another reference first if you want to replace this one.`;

async function wouldDropBelowMinimum(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  slotId: string
): Promise<boolean> {
  const { data: slot } = await getReferenceSlotById(supabase, slotId);
  // Slot missing, or already optional → removing it changes no requirement.
  if (!slot?.is_required) return false;
  const { count } = await countRequiredReferenceSlots(supabase, slot.program_id);
  // `count` includes the slot being removed, so losing it lands one lower.
  return (count ?? 0) - 1 < MIN_REQUIRED_REFERENCE_SLOTS;
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
  if (is_required === false && (await wouldDropBelowMinimum(supabase, id))) {
    return NextResponse.json({ error: MIN_SLOTS_ERROR }, { status: 409 });
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

  if (await wouldDropBelowMinimum(supabase, id)) {
    return NextResponse.json({ error: MIN_SLOTS_ERROR }, { status: 409 });
  }

  const { error } = await deleteReferenceSlot(supabase, id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
