import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/api-auth";
import {
  createProgramGroup,
  updateProgramGroup,
  deleteProgramGroup,
} from "@/services/school-billing";

async function guard(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      user: null,
      res: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  if (!(await canManageFinance(supabase, user.id))) {
    return {
      user: null,
      res: NextResponse.json(
        { error: "You don't have permission to manage finance settings" },
        { status: 403 }
      ),
    };
  }
  return { user, res: null };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { user, res } = await guard(supabase);
  if (res) return res;

  const body = await request.json();
  const { name, code } = body;
  if (!name || !code) {
    return NextResponse.json(
      { error: "name and code are required" },
      { status: 400 }
    );
  }

  const { data, error } = await createProgramGroup(supabase, {
    name,
    code,
    year: body.year ?? null,
    description: body.description ?? null,
    created_by: user!.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, data });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { user, res } = await guard(supabase);
  if (res) return res;

  const body = await request.json();
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await updateProgramGroup(supabase, id, {
    name: body.name,
    code: body.code,
    year: body.year,
    description: body.description,
    status: body.status,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { user, res } = await guard(supabase);
  if (res) return res;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await deleteProgramGroup(supabase, id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
