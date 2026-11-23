import type Database from "better-sqlite3";

export interface ScheduleConfig {
  active_hours_start: number;
  active_hours_end: number;
  timezone: string;
  working_days: string;
}

export function getLocalParts(tz: string, date = new Date()): { hour: number; minute: number; isoWeekday: number } {
  const safeZone = (() => { try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return tz; } catch { return "UTC"; } })();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone,
    hour: "numeric", minute: "numeric", weekday: "short", hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10),
    isoWeekday: weekdayMap[get("weekday")] ?? 1,
  };
}

export function zonedHourMs(tz: string, hourFrac: number, date = new Date()): number {
  const { hour, minute } = getLocalParts(tz, date);
  const minuteStart = Math.floor(date.getTime() / 60_000) * 60_000;
  return minuteStart + (hourFrac - (hour + minute / 60)) * 3600_000;
}

export function nextScheduledSlot(
  account: ScheduleConfig,
  notBeforeMs = Date.now(),
  random = Math.random,
): string {
  const tz = account.timezone || "UTC";
  const allowedDays = (account.working_days || "1,2,3,4,5").split(",").map(Number);
  const start = account.active_hours_start ?? 9;
  const end = account.active_hours_end ?? 18;
  // Noon stays on the intended local calendar day when crossing a DST change.
  const noon = zonedHourMs(tz, 12, new Date(notBeforeMs));
  for (let offset = 0; offset <= 14; offset++) {
    const day = new Date(noon + offset * 86_400_000);
    if (!allowedDays.includes(getLocalParts(tz, day).isoWeekday)) continue;
    const windowStart = Math.max(notBeforeMs, zonedHourMs(tz, start, day));
    const windowEnd = zonedHourMs(tz, end, day);
    if (windowEnd - windowStart <= 15 * 60_000) continue;
    return new Date(windowStart + random() * (windowEnd - windowStart)).toISOString();
  }
  throw new Error("No eligible working window in the next 14 days");
}

export function initialEnrollmentSlots(
  account: ScheduleConfig,
  count: number,
  firstDelaySeconds: number,
  nowMs = Date.now(),
  random = Math.random,
): string[] {
  if (count === 0) return [];
  const notBeforeMs = nowMs + Math.max(0, firstDelaySeconds) * 1000;
  const eligibleDate = new Date(notBeforeMs);
  const tz = account.timezone || "UTC";
  const allowedDays = (account.working_days || "1,2,3,4,5").split(",").map(Number);
  const windowStart = Math.max(notBeforeMs, zonedHourMs(tz, account.active_hours_start ?? 9, eligibleDate));
  const windowEnd = zonedHourMs(tz, account.active_hours_end ?? 18, eligibleDate);
  const usableDay = allowedDays.includes(getLocalParts(tz, eligibleDate).isoWeekday)
    && windowEnd - windowStart > 15 * 60_000;
  if (!usableDay) {
    return Array.from({ length: count }, () => nextScheduledSlot(account, notBeforeMs, random));
  }
  const bucketMs = (windowEnd - windowStart) / count;
  return Array.from({ length: count }, (_, index) => (
    new Date(windowStart + (index + random()) * bucketMs).toISOString()
  ));
}

interface PendingTrack {
  id: string;
  run_profile_id: string;
  track: string;
}

export function enrollInitialTracks(
  db: Database.Database,
  runId: string,
  pending: PendingTrack[],
  account: ScheduleConfig,
  track: string,
  nowMs = Date.now(),
  random = Math.random,
): Array<PendingTrack & { next_step_at: string }> {
  if (pending.length === 0) return [];
  const firstStep = db.prepare(
    `SELECT ws.delay_seconds FROM workflow_steps ws
     JOIN runs r ON r.workflow_id = ws.workflow_id
     WHERE r.id = ? AND ws.track = ? ORDER BY ws.step_order LIMIT 1`,
  ).get(runId, track) as { delay_seconds: number } | undefined;
  const slots = initialEnrollmentSlots(account, pending.length, firstStep?.delay_seconds ?? 0, nowMs, random);
  const claim = db.prepare(
    `UPDATE run_profile_tracks SET state = 'in_progress', next_step_at = ?
     WHERE id = ? AND state = 'pending' AND current_step = 0 AND track = ?
       AND run_profile_id IN (SELECT id FROM run_profiles WHERE run_id = ?)`,
  );
  return db.transaction(() => {
    const enrolled: Array<PendingTrack & { next_step_at: string }> = [];
    for (const [index, row] of pending.entries()) {
      const slot = slots[index];
      if (claim.run(slot, row.id, track, runId).changes === 0) continue;
      enrolled.push({ ...row, next_step_at: slot });
    }
    return enrolled;
  })();
}
