"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { getSavedDecks } from "@/lib/storage";
import { buildTodaySession } from "@/lib/recallStorage";
import { daysUntilExam, soonestExamDate } from "@/lib/recallModel";
import { reminderFor } from "@/lib/studyReminder";
import { hasReminderPermission, scheduleReminder } from "@/lib/notifications";
import { readReminderPref } from "@/lib/reminderPref";

/** Keeps the one pending study reminder in step with what the engine actually knows.
 *
 * Renders nothing and blocks nothing, the same posture as SyncEngine. Lives in the
 * layout rather than on the account screen because the reminder has to be rewritten
 * whenever the schedule moves - which happens while the student is studying, not
 * while they are looking at their settings.
 *
 * Recomputed rather than incremented: the text is derived from the session the engine
 * would build right now, so a student who has just cleared tonight's work gets the
 * reminder cancelled instead of being told about cards they already answered.
 *
 * The budget is fixed at 20 minutes - the same middle chip TodaySession defaults to.
 * The reminder is an invitation, not a commitment to a particular session length, and
 * asking the student to configure two numbers to get one notification is worse than
 * picking the one they pick anyway. */

const BUDGET_MINUTES = 20;

export default function ReminderScheduler() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;

    let alive = true;
    const run = () => {
      void (async () => {
        const pref = readReminderPref();
        if (!pref.enabled) return;
        // Checked, never re-requested: asking outside a deliberate tap is how an app
        // gets permanently denied.
        if (!(await hasReminderPermission())) return;

        const decks = getSavedDecks();
        const plan = await buildTodaySession(userId, decks, BUDGET_MINUTES);
        if (!alive) return;
        const exam = daysUntilExam(soonestExamDate(decks) ?? undefined);
        await scheduleReminder(reminderFor(plan, exam), pref.hour);
      })().catch((error) => console.error("rescheduling the study reminder failed", error));
    };

    run();
    window.addEventListener("recall-engine-update", run);
    return () => {
      alive = false;
      window.removeEventListener("recall-engine-update", run);
    };
  }, [status, userId]);

  return null;
}
