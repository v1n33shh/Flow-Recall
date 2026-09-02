"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { motion } from "motion/react";
import { getSavedDecks } from "@/lib/storage";
import { buildTodaySession } from "@/lib/recallStorage";
import { daysUntilExam, soonestExamDate } from "@/lib/recallModel";
import { reminderFor } from "@/lib/studyReminder";
import { cancelReminder, requestReminderPermission, scheduleReminder } from "@/lib/notifications";
import {
  DEFAULT_REMINDER_HOUR,
  readReminderPref,
  writeReminderPref,
  type ReminderPref,
} from "@/lib/reminderPref";
import { useIsNative } from "@/lib/useIsNative";
import { vibrateTap } from "@/lib/haptics";

/** Turn the nightly reminder on, and pick when.
 *
 * Renders only in the app: a browser tab that is closed cannot fire a local
 * notification, so offering the switch on the web would be offering something that
 * does not work.
 *
 * The permission is requested here and nowhere else, because this is the only place
 * the student has said they want it. Asking on launch is how an app gets denied
 * permanently - Android remembers the refusal, and a student who has not yet seen
 * what the app does has no reason to agree. */

const HOURS = [7, 9, 12, 17, 20, 22];

export default function StudyReminderSettings() {
  const isNative = useIsNative();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [pref, setPref] = useState<ReminderPref>({
    enabled: false,
    hour: DEFAULT_REMINDER_HOUR,
  });
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  // Read after mount: localStorage does not exist during the static export's
  // prerender, so reading it during render would hydrate mismatched. Deferred out of
  // the effect body through a microtask, the same shape the account screen's theme
  // read uses - the compiler lint rule treats a synchronous setState in an effect as
  // an error, not a warning.
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) setPref(readReminderPref());
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function apply(next: ReminderPref) {
    setBusy(true);
    setDenied(false);
    try {
      if (next.enabled && !(await requestReminderPermission())) {
        // Refused, so nothing is stored: leaving `enabled` true would show a switch
        // that is on while no notification can ever arrive.
        setDenied(true);
        return;
      }
      writeReminderPref(next);
      setPref(next);

      if (!next.enabled || !userId) {
        await cancelReminder();
        return;
      }
      const decks = getSavedDecks();
      const plan = await buildTodaySession(userId, decks, 20);
      const exam = daysUntilExam(soonestExamDate(decks) ?? undefined);
      await scheduleReminder(reminderFor(plan, exam), next.hour);
    } catch (error) {
      console.error("updating the study reminder failed", error);
    } finally {
      setBusy(false);
    }
  }

  if (!isNative) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Nightly reminder</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Only when something is actually due. Quiet on the nights the engine has
            decided you have nothing to review.
          </p>
        </div>
        {/* Identical to the account screen's ThemeSwitch, down to the pixel, because
            two switches on one settings screen that differ slightly read as a bug.
            The `on` track is a fixed #3b82f6 by inline style and NOT `bg-accent`,
            which is the same mistake ThemeSwitch documents having already made:
            `--accent` resolves to pure white in dark mode (globals.css sets
            `--accent: 0 0% 100%`), so an `on` switch painted with it was a white
            pill the student could not tell from the `off` state. `off` is
            `bg-foreground/15` rather than a white or black wash, so the track stays
            visible in BOTH themes - `foreground` flips with the theme. */}
        <button
          type="button"
          role="switch"
          aria-checked={pref.enabled}
          aria-label="Nightly reminder"
          disabled={busy}
          onClick={() => {
            vibrateTap();
            void apply({ ...pref, enabled: !pref.enabled });
          }}
          className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-60 ${
            pref.enabled ? "" : "bg-foreground/15"
          }`}
          style={{ background: pref.enabled ? "#3b82f6" : undefined }}
        >
          {/* Transform-only, per the same performance contract the rest of the
              native chrome follows - never left/width. */}
          <motion.span
            className="absolute top-[3px] left-[3px] h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
            animate={{ x: pref.enabled ? 20 : 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
          />
        </button>
      </div>

      {pref.enabled && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            At
          </span>
          {HOURS.map((hour) => (
            <button
              key={hour}
              type="button"
              disabled={busy}
              onClick={() => {
                vibrateTap();
                void apply({ ...pref, hour });
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium tabular-nums transition-colors duration-200 disabled:opacity-60 ${
                pref.hour === hour
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-foreground/5 text-foreground active:bg-foreground/10"
              }`}
            >
              {String(hour).padStart(2, "0")}:00
            </button>
          ))}
        </div>
      )}

      {denied && (
        <p className="mt-3 text-xs text-pending">
          Android is blocking notifications for FlowRecall. Turn them on in Settings →
          Apps → FlowRecall → Notifications, then try again.
        </p>
      )}
    </div>
  );
}
