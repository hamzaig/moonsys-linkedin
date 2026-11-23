import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { enrollInitialTracks, getLocalParts, initialEnrollmentSlots, nextScheduledSlot } from "../lib/linkedin/schedule.ts";

const schedule = {
  active_hours_start: 9,
  active_hours_end: 18,
  timezone: "UTC",
  working_days: "1,2,3,4,5",
};
const now = Date.parse("2026-11-23T10:03:39.000Z");
const day = 86_400_000;

function fixture(context) {
  const db = new Database(":memory:");
  context.after(() => db.close());
  db.exec(`
    CREATE TABLE runs (id TEXT PRIMARY KEY, workflow_id TEXT);
    CREATE TABLE workflow_steps (workflow_id TEXT, track TEXT, step_order INTEGER, delay_seconds INTEGER);
    CREATE TABLE run_profiles (id TEXT PRIMARY KEY, run_id TEXT);
    CREATE TABLE run_profile_tracks (
      id TEXT PRIMARY KEY, run_profile_id TEXT, track TEXT,
      state TEXT DEFAULT 'pending', current_step INTEGER DEFAULT 0, next_step_at TEXT
    );
    INSERT INTO runs VALUES ('run', 'workflow'), ('other-run', 'other-workflow');
    INSERT INTO workflow_steps VALUES
      ('workflow', 'linkedin', 2, 0),
      ('workflow', 'linkedin', 1, 86400),
      ('workflow', 'email', 1, 7200);
    INSERT INTO run_profiles VALUES ('other-profile', 'other-run');
    INSERT INTO run_profile_tracks (id, run_profile_id, track)
      VALUES ('other-track', 'other-profile', 'linkedin');
  `);
  const pending = [];
  for (let index = 0; index < 5; index++) {
    const profile = `profile-${index}`;
    const id = `linkedin-${index}`;
    db.prepare("INSERT INTO run_profiles VALUES (?, 'run')").run(profile);
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track) VALUES (?, ?, 'linkedin')").run(id, profile);
    db.prepare("INSERT INTO run_profile_tracks (id, run_profile_id, track) VALUES (?, ?, 'email')").run(`email-${index}`, profile);
    pending.push({ id, run_profile_id: profile, track: "linkedin" });
  }
  return { db, pending };
}

function assertInWindow(slot, config, notBefore) {
  assert.ok(Date.parse(slot) >= notBefore, `${slot} precedes the initial delay`);
  const local = getLocalParts(config.timezone, new Date(slot));
  assert.ok(config.working_days.split(",").map(Number).includes(local.isoWeekday));
  const hour = local.hour + local.minute / 60;
  assert.ok(hour >= config.active_hours_start && hour < config.active_hours_end);
}

test("database enrollment honors the first step's 24-hour delay and spreads the batch", context => {
  const { db, pending } = fixture(context);
  const enrolled = enrollInitialTracks(db, "run", pending, schedule, "linkedin", now, () => 0.5);
  assert.equal(enrolled.length, 5);
  for (const row of enrolled) {
    assertInWindow(row.next_step_at, schedule, now + day);
    assert.equal(row.next_step_at.slice(0, 10), "2026-11-24");
  }
  assert.equal(new Set(enrolled.map(row => row.next_step_at)).size, 5);
  const stored = db.prepare("SELECT state, current_step, next_step_at FROM run_profile_tracks WHERE id = ?").get(pending[0].id);
  assert.equal(stored.state, "in_progress");
  assert.equal(stored.current_step, 0);
  assert.equal(stored.next_step_at, enrolled[0].next_step_at);
});

test("email enrollment uses its own first-step delay", context => {
  const { db } = fixture(context);
  const pending = [{ id: "email-0", run_profile_id: "profile-0", track: "email" }];
  const [row] = enrollInitialTracks(db, "run", pending, schedule, "email", now, () => 0);
  assert.equal(Date.parse(row.next_step_at), now + 2 * 3600_000);
});

test("a workflow without an initial delay can still start today", () => {
  const slots = initialEnrollmentSlots(schedule, 3, 0, now, () => 0.5);
  for (const slot of slots) {
    assertInWindow(slot, schedule, now);
    assert.equal(slot.slice(0, 10), "2026-11-23");
  }
});

test("a delay expiring before opening waits until the working window", () => {
  const early = Date.parse("2026-11-23T05:00:00Z");
  assert.equal(initialEnrollmentSlots(schedule, 1, 3600, early, () => 0)[0], "2026-11-23T09:00:00.000Z");
});

test("a delay expiring over the weekend moves to Monday", () => {
  const friday = Date.parse("2026-11-27T12:00:00Z");
  const slots = initialEnrollmentSlots(schedule, 4, 86400, friday, () => 0.5);
  for (const slot of slots) {
    assertInWindow(slot, schedule, friday + day);
    assert.equal(slot.slice(0, 10), "2026-11-30");
  }
});

test("the last fifteen minutes move enrollment to the next working day", () => {
  const late = Date.parse("2026-11-23T17:50:00Z");
  assert.equal(nextScheduledSlot(schedule, late, () => 0), "2026-11-24T09:00:00.000Z");
});

test("account timezone controls the window regardless of the server timezone", () => {
  const config = { ...schedule, timezone: "Asia/Karachi" };
  const morning = Date.parse("2026-11-23T05:00:00Z");
  const slots = initialEnrollmentSlots(config, 3, 86400, morning, () => 0.5);
  for (const slot of slots) assertInWindow(slot, config, morning + day);
  assert.ok(slots.every(slot => Date.parse(slot) < Date.parse("2026-11-24T13:00:00Z")));
});

test("weekend scheduling across a DST change retains the next local working day", () => {
  const config = { ...schedule, timezone: "America/New_York" };
  const friday = Date.parse("2026-10-30T19:00:00Z");
  assert.equal(initialEnrollmentSlots(config, 1, 172800, friday, () => 0)[0], "2026-11-02T14:00:00.000Z");
});

test("repeating enrollment does not reset an already claimed track or its delay", context => {
  const { db, pending } = fixture(context);
  const first = enrollInitialTracks(db, "run", pending, schedule, "linkedin", now, () => 0.5);
  assert.deepEqual(enrollInitialTracks(db, "run", pending, schedule, "linkedin", now + day, () => 0), []);
  for (const row of first) {
    assert.equal(db.prepare("SELECT next_step_at FROM run_profile_tracks WHERE id = ?").get(row.id).next_step_at, row.next_step_at);
  }
});

test("enrollment cannot claim another run, another track, or an advanced step", context => {
  const { db, pending } = fixture(context);
  db.prepare("UPDATE run_profile_tracks SET current_step = 1 WHERE id = ?").run(pending[0].id);
  const extra = [
    { id: "other-track", run_profile_id: "other-profile", track: "linkedin" },
    { id: "email-0", run_profile_id: "profile-0", track: "email" },
  ];
  assert.equal(enrollInitialTracks(db, "run", [...pending, ...extra], schedule, "linkedin", now, () => 0.5).length, 4);
  for (const id of [pending[0].id, "other-track", "email-0"]) {
    const row = db.prepare("SELECT state, next_step_at FROM run_profile_tracks WHERE id = ?").get(id);
    assert.equal(row.state, "pending");
    assert.equal(row.next_step_at, null);
  }
});

test("a failed batch rolls back both claims and timestamps", context => {
  const { db, pending } = fixture(context);
  db.exec(`CREATE TRIGGER reject_second BEFORE UPDATE ON run_profile_tracks
    WHEN NEW.id = 'linkedin-1' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
  assert.throws(() => enrollInitialTracks(db, "run", pending, schedule, "linkedin", now, () => 0.5), /fixture failure/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM run_profile_tracks WHERE state <> 'pending' OR next_step_at IS NOT NULL").get().count, 0);
});
