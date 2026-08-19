import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/services/users";
import { getRegistrationsForContact } from "@/services/registrations";
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

export default async function MyEventsPage() {
  const supabase = await createClient();
  const { data: user } = await getCurrentUser(supabase);
  if (!user) redirect("/login");

  const contactId = user.contact_id;
  const { data: registrations } = contactId
    ? await getRegistrationsForContact(supabase, contactId)
    : { data: [] };

  const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    confirmed: "default",
    waitlisted: "secondary",
    cancelled: "destructive",
  };

  return (
    <div className="ffsa-screen">
      <Masthead context="Personal" title="My Events" />
      <div className="space-y-6 px-5 py-6 md:px-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrations</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Registration Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!registrations || registrations.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-muted-foreground py-8"
                    >
                      No event registrations found
                    </TableCell>
                  </TableRow>
                ) : (
                  registrations.map(
                    (reg: {
                      id: string;
                      status: string;
                      events: {
                        id: string;
                        title: string;
                        start_date: string;
                        end_date: string | null;
                        location: string | null;
                        status: string;
                      } | null;
                    }) => (
                      <TableRow key={reg.id}>
                        <TableCell className="font-medium">
                          {reg.events?.title ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {reg.events?.start_date ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {reg.events?.location ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={statusColors[reg.status]}
                            className="capitalize"
                          >
                            {reg.status}
                          </Badge>
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
