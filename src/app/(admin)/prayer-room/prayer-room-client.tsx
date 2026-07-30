"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, User, BookOpen, Settings, ClipboardCheck, DoorOpen } from "lucide-react";
import ScheduleView from "./components/schedule-view";
import MySets from "./components/my-sets";
import ApplyForm from "./components/apply-form";
import Directory from "./components/directory";
import Evaluations from "./components/evaluations";
import AdminPanel from "./components/admin-panel";

interface Props {
  userId: string;
  isStaff: boolean;
  isMember: boolean;
  isEvaluator: boolean;
  canViewDirectory: boolean;
  pendingCount: number;
}

export default function PrayerRoomClient({ userId, isStaff, isMember, isEvaluator, canViewDirectory, pendingCount }: Props) {
  const [activeTab, setActiveTab] = useState("schedule");
  const showEvaluations = isEvaluator || isStaff;
  const showDirectory = isMember || isStaff || canViewDirectory;

  return (
    <div>
      <div className="mb-6">
        <p className="page-eyebrow">DEVOTIONAL SETS</p>
        <h1 className="page-title">Prayer Room</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="schedule" className="gap-1.5">
            <CalendarDays className="h-4 w-4" />
            Schedule
          </TabsTrigger>

          {isMember ? (
            <TabsTrigger value="my-sets" className="gap-1.5">
              <User className="h-4 w-4" />
              My Sets
            </TabsTrigger>
          ) : (
            <TabsTrigger value="apply" className="gap-1.5">
              <DoorOpen className="h-4 w-4" />
              Join the Room
            </TabsTrigger>
          )}

          {showDirectory && (
            <TabsTrigger value="directory" className="gap-1.5">
              <BookOpen className="h-4 w-4" />
              Directory
            </TabsTrigger>
          )}

          {showEvaluations && (
            <TabsTrigger value="evaluations" className="gap-1.5">
              <ClipboardCheck className="h-4 w-4" />
              Evaluations
            </TabsTrigger>
          )}

          {isStaff && (
            <TabsTrigger value="manage" className="gap-1.5">
              <Settings className="h-4 w-4" />
              Manage
              {pendingCount > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                  {pendingCount}
                </span>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="schedule" className="mt-4">
          <ScheduleView userId={userId} isStaff={isStaff} isMember={isMember} />
        </TabsContent>

        {isMember ? (
          <TabsContent value="my-sets" className="mt-4">
            <MySets userId={userId} isStaff={isStaff} />
          </TabsContent>
        ) : (
          <TabsContent value="apply" className="mt-4">
            <ApplyForm />
          </TabsContent>
        )}

        {showDirectory && (
          <TabsContent value="directory" className="mt-4">
            <Directory />
          </TabsContent>
        )}

        {showEvaluations && (
          <TabsContent value="evaluations" className="mt-4">
            <Evaluations userId={userId} />
          </TabsContent>
        )}

        {isStaff && (
          <TabsContent value="manage" className="mt-4">
            <AdminPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
