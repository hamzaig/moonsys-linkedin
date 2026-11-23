// Run against an isolated production server with a fresh, empty fixture database only.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ingestConversation } from "../lib/linkedin/inbox/store.ts";

const base = process.env.NEXTAUTH_URL;
const dbPath = process.env.MOONSYS_DB_PATH;
const secret = process.env.INTERNAL_API_SECRET;
assert.ok(base && dbPath && secret, "NEXTAUTH_URL, MOONSYS_DB_PATH and INTERNAL_API_SECRET are required");
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Fixture server must be on loopback");
const headers = { "x-internal-secret": secret };
const first = await fetch(base + "/api/inbox/linkedin/sync", { headers });
assert.equal(first.status, 200);
const db = new Database(dbPath, { fileMustExist: true });
db.pragma("foreign_keys=ON");
for (const table of ["accounts", "targets", "runs"]) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, "Refusing to modify a non-empty database");

db.transaction(() => {
  for (const [id, name] of [["fixture-a", "Sender A"], ["fixture-b", "Sender B"]]) db.prepare("INSERT INTO accounts(id,name,email,is_authenticated) VALUES(?,?,?,0)").run(id, name, id + "@example.invalid");
  db.prepare("INSERT INTO targets(id,full_name,linkedin_url,email,email_replied_at) VALUES(?,?,?,?,?)").run("fixture-lead", "Fixture Lead", "https://www.linkedin.com/in/fixture-lead/", "lead@example.invalid", "2026-11-23 11:00:00");
  db.prepare("INSERT INTO workflows(id,name) VALUES(?,?)").run("fixture-workflow", "Fixture campaign");
  for (const [run, account, profile] of [["fixture-run-a", "fixture-a", "fixture-profile-a"], ["fixture-run-b", "fixture-b", "fixture-profile-b"]]) {
    db.prepare("INSERT INTO runs(id,workflow_id,account_id,status) VALUES(?,?,?,'paused')").run(run, "fixture-workflow", account);
    db.prepare("INSERT INTO run_profiles(id,run_id,target_id,created_at) VALUES(?,?,?,?)").run(profile, run, "fixture-lead", "2026-11-23 10:00:00");
    db.prepare("INSERT INTO run_profile_tracks(id,run_profile_id,track,state,current_step,next_step_at) VALUES(?,?,'linkedin','in_progress',0,'2026-11-25T11:00:00Z')").run(profile + "-track", profile);
  }
})();
const self = { urn: "urn:li:fsd_profile:SELF", profileUrl: "https://www.linkedin.com/in/fixture-owner/" };
const peer = { urn: "urn:li:fsd_profile:PEER", profileUrl: "https://www.linkedin.com/in/fixture-lead/" };
for (const account of ["fixture-a", "fixture-b"]) ingestConversation(db, account, {
  urn: "urn:li:msg_conversation:(urn:li:fsd_profile:SELF,fixture-thread)", self, participants: [self, peer], isGroup: false,
  messages: [{ urn: "fixture-message", senderUrn: peer.urn, text: "<script>fixture text must stay plain</script>", deliveredAt: Date.parse("2026-11-23T11:30:00Z") }],
});
const checks = [];
async function request(route, method = "GET", body, expected = 200, authenticated = true) {
  const response = await fetch(base + route, { method, headers: { ...(authenticated ? headers : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${route}`);
  checks.push({ route, method, status: response.status });
  return data;
}
try {
  const inbox = await request("/api/inbox?channel=linkedin");
  assert.equal(inbox.replies.length, 2);
  assert.equal(new Set(inbox.replies.map(row => row.inbox_key)).size, 2);
  const filtered = await request("/api/inbox?channel=linkedin&accountId=fixture-b");
  assert.equal(filtered.replies.length, 1); assert.equal(filtered.replies[0].linkedin_account_id, "fixture-b");
  const email = await request("/api/inbox?channel=email"); assert.equal(email.replies.length, 1); assert.equal(email.replies[0].channel, "email");
  const thread = await request("/api/inbox/linkedin/thread?id=" + inbox.replies[0].linkedin_conversation_id);
  assert.equal(thread.messages.length, 1); assert.ok(thread.messages[0].text.includes("<script>"));
  await request("/api/inbox/linkedin/thread?id=unknown", "GET", undefined, 404);
  await request("/api/inbox/linkedin/thread", "GET", undefined, 400);
  await request("/api/inbox/linkedin/thread?id=unknown", "POST", {}, 405);
  await request("/api/inbox/linkedin/sync", "POST", {}, 400);
  await request("/api/inbox/linkedin/sync", "POST", { accountId: "unknown" }, 404);
  await request("/api/inbox/linkedin/sync", "DELETE", undefined, 405);
  await request("/api/inbox/linkedin/sync", "GET", undefined, 401, false);
  await request("/api/inbox/linkedin/thread?id=unknown", "GET", undefined, 401, false);
  await request("/api/inbox/linkedin/sync", "POST", { accountId: "fixture-a" }, 202);
  const health = await request("/api/inbox/linkedin/sync");
  assert.equal(health.accounts.find(account => account.id === "fixture-a").status, "auth_required");
  assert.ok(!JSON.stringify(health).includes("lease_owner"));
  db.prepare("UPDATE linkedin_inbox_sync SET last_error_code='rate_limit',retry_at_ms=? WHERE account_id='fixture-a'").run(Date.now() + 900000);
  await request("/api/inbox/linkedin/sync", "POST", { accountId: "fixture-a" }, 429);
  assert.equal(db.prepare("SELECT count(*) n FROM accounts WHERE is_authenticated=1").get().n, 0);
  const report = { checks, distinctSenderThreads: 2, emailReplyRegressionPassed: true, realOutreachAccounts: 0 };
  if (process.env.INBOX_HTTP_REPORT_PATH) fs.writeFileSync(path.resolve(process.env.INBOX_HTTP_REPORT_PATH), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ httpChecks: checks.length, senderIsolation: true, emailReplyRegression: true, authenticationRequired: true, noLiveAccounts: true }));
} finally { db.close(); }
