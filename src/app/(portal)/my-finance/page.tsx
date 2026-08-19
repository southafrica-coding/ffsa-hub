import { createClient } from "@/lib/supabase/server";
import { getMyOutreachTeams } from "@/services/outreach-finance";
import { getMyStudentFees } from "@/services/school-fees";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, Wallet, GraduationCap } from "lucide-react";
import Link from "next/link";
import { SchoolFeesCard } from "./school-fees-card";
import { Masthead } from "@/components/ffsa";

export default async function MyFinancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <p>Not authenticated.</p>;
  }

  const [{ data: teamMemberships }, { data: studentFees }] = await Promise.all([
    getMyOutreachTeams(supabase, user.id),
    getMyStudentFees(supabase, user.id),
  ]);

  const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
    planning: "secondary",
    active: "default",
    review: "secondary",
    closed: "destructive",
  };

  return (
    <div className="ffsa-screen">
      <Masthead context="Personal" title="My Finance" />
      <div className="space-y-6 px-5 py-6 md:px-8">
        {/* Outreach Teams */}
        {teamMemberships && teamMemberships.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Globe className="h-5 w-5" />
              My Outreach Teams
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {teamMemberships.map(
                (membership: {
                  id: string;
                  role: string;
                  outreach_teams: {
                    id: string;
                    team_name: string;
                    location: string | null;
                    status: string;
                    people_count: number;
                    programs: { name: string; code: string };
                  };
                }) => {
                  const team = membership.outreach_teams;
                  return (
                    <Link
                      key={membership.id}
                      href={`/my-finance/outreach/${team.id}`}
                    >
                      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">
                              {team.team_name}
                            </CardTitle>
                            <Badge
                              variant={statusColors[team.status] ?? "secondary"}
                            >
                              {team.status}
                            </Badge>
                          </div>
                          <CardDescription>
                            {team.programs?.name} · {team.location ?? "TBD"}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>
                              Role:{" "}
                              {membership.role.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                            </span>
                            <span>{team.people_count} people</span>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                }
              )}
            </div>
          </div>
        )}

        {/* School Fees */}
        {studentFees && studentFees.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <GraduationCap className="h-5 w-5" />
              My School Fees
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {studentFees.map(
                (fee: {
                  id: string;
                  tier: string;
                  tuition_zar: number;
                  accommodation_zar: number;
                  meals_zar: number;
                  materials_zar: number;
                  total_due_zar: number;
                  discount_zar: number;
                  scholarship_zar: number;
                  final_amount_zar: number;
                  amount_paid_zar: number;
                  status: string;
                  programs: { id: string; name: string; code: string };
                  student_payments: {
                    id: string;
                    payment_date: string;
                    amount_zar: number;
                    payment_method: string;
                    reference: string | null;
                  }[];
                }) => (
                  <SchoolFeesCard key={fee.id} fee={fee} />
                )
              )}
            </div>
          </div>
        )}

        {/* Other finance placeholder */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
              <Wallet className="h-5 w-5" />
              Other Finance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Staff fees, rent payments, and support level tracking coming soon.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
