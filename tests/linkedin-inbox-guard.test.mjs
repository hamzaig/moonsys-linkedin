import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,conversation,message,timestamp } from './helpers/inbox-fixture.mjs';
import { ingestConversation } from '../lib/linkedin/inbox/store.ts';
import { checkQueuedOutreach, holdForInbox } from '../lib/linkedin/inbox/guard.ts';
import { runInboxWorkerTick, accountSyncDue } from '../lib/linkedin/inbox/worker.ts';
const now=timestamp+3600000;
function healthy(db,id='a') {db.prepare("INSERT INTO linkedin_inbox_sync(account_id,status,success_at_ms) VALUES(?,'ok',?)").run(id,now);}

test('every regular LinkedIn message waits for fresh inbox state, while connection timing stays intact',t=>{
 const db=fixture(t);const before=db.prepare("SELECT next_step_at FROM run_profile_tracks WHERE id='li-a'").get();
 for(const type of ['message','message'])assert.equal(checkQueuedOutreach(db,'li-a','a',type,now),'sync_stale');
 assert.equal(checkQueuedOutreach(db,'li-a','a','connect',now),null);assert.deepEqual(db.prepare("SELECT next_step_at FROM run_profile_tracks WHERE id='li-a'").get(),before);
 healthy(db);assert.equal(checkQueuedOutreach(db,'li-a','a','message',now),null);
 assert.equal(checkQueuedOutreach(db,'li-a','a','message',now+600001),'sync_stale');
});
test('failed sync holds regular LinkedIn messages even with a recent previous success',t=>{
 const db=fixture(t);healthy(db);db.exec("UPDATE linkedin_inbox_sync SET status='auth_required'");
 assert.equal(checkQueuedOutreach(db,'li-a','a','message',now),'sync_stale');assert.equal(checkQueuedOutreach(db,'li-b','b','email',now),null);
});
test('a reply detected after the send queue was loaded blocks that contact across both tracks',t=>{
 const db=fixture(t);healthy(db);ingestConversation(db,'a',conversation([message()]));
 assert.equal(checkQueuedOutreach(db,'li-a','a','message',now),'replied');assert.equal(checkQueuedOutreach(db,'email-a','a','email',now),'replied');assert.equal(checkQueuedOutreach(db,'li-b','b','connect',now),null);
});
test('paused or skipped work cannot be sent from a stale queue snapshot',t=>{
 const db=fixture(t);healthy(db);db.exec("UPDATE runs SET status='paused' WHERE id='ra'");assert.equal(checkQueuedOutreach(db,'li-a','a','message',now),'inactive');
 assert.equal(checkQueuedOutreach(db,'li-a','b','message',now),'inactive');
});
test('a hold reschedules only an active message and cannot overwrite a reply cancellation',t=>{
 const db=fixture(t);assert.equal(holdForInbox(db,'li-a',now),true);assert.equal(db.prepare("SELECT next_step_at FROM run_profile_tracks WHERE id='li-a'").get().next_step_at,'2026-11-23T12:01:00.000Z');
 ingestConversation(db,'a',conversation([message()]));assert.equal(holdForInbox(db,'li-a',now+60000),false);assert.equal(db.prepare("SELECT next_step_at FROM run_profile_tracks WHERE id='li-a'").get().next_step_at,null);
});
test('the worker honors freshness, leases and provider backoff independently per account',t=>{
 const db=fixture(t);assert.equal(accountSyncDue(db,'a',now),true);healthy(db);assert.equal(accountSyncDue(db,'a',now+1000),false);assert.equal(accountSyncDue(db,'a',now+360000),true);
 db.prepare("UPDATE linkedin_inbox_sync SET status='rate_limited',retry_at_ms=? WHERE account_id='a'").run(now+900000);assert.equal(accountSyncDue(db,'a',now+360000),false);assert.equal(accountSyncDue(db,'b',now+360000),true);
});
test('an account sync failure does not prevent the worker checking the next account',async t=>{
 const db=fixture(t);const seen=[];await runInboxWorkerTick(db,async(_,accountId)=>{seen.push(accountId);if(accountId==='a')throw new Error('fixture network failure');return {status:'ok'}},()=>now);
 assert.deepEqual(seen,['a','b']);
});
