import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/services/users";
import { getAttendanceForContact } from "@/services/attendance";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Masthead } from "@/components/ffsa";

export default async function MyAttendancePage() {
  const supabase = await createClient();
  const { data: user } = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const contactId = user.contact_id;
  const { data: attendance } = contactId
    ? await getAttendanceForContact(supabase, contactId)
    : { data: [] };

  const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    present: "default",
    absent: "destructive",
    late: "secondary",
    excused: "outline",
  };

  return (
    <div className="ffsa-screen">
      <Masthead context="Personal" title="My Attendance" />
      <div className="space-y-6 px-5 py-6 md:px-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance Records</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Checked In</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!attendance || attendance.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-muted-foreground py-8"
                    >
                      No attendance records found
                    </TableCell>
                  </TableRow>
                ) : (
                  attendance.map(
                    (att: {
                      id: string;
                      status: string;
                      checked_in_at: string | null;
                      events: {
                        id: string;
                        title: string;
                        start_date: string;
                        location: string | null;
                      } | null;
                    }) => (
                      <TableRow key={att.id}>
                        <TableCell className="font-medium">
                          {att.events?.title ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {att.events?.start_date ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={statusColors[att.status]}
                            className="capitalize"
                          >
                            {att.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {att.checked_in_at
                            ? new Date(att.checked_in_at).toLocaleString()
                            : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  )
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
