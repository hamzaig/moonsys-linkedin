import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, conversation, message, timestamp } from './helpers/inbox-fixture.mjs';
import { ingestConversation } from '../lib/linkedin/inbox/store.ts';
import * as guards from '../lib/linkedin/inbox/guard.ts';
import { loadTsx } from './helpers/tsx-loader.mjs';
import fs from 'node:fs';

test('known legacy/email replies settle both tracks before a freshness hold',t=>{
 const db=fixture(t);db.exec("UPDATE targets SET email_replied_at='2026-11-23T11:00:00Z'");
 assert.equal(guards.checkQueuedOutreach(db,'li-a','a','message',timestamp),'replied');
 assert.throws(()=>guards.assertQueuedOutreach(db,'li-a','a','message',timestamp),/replied/);
 assert.equal(db.prepare("SELECT state FROM run_profile_tracks WHERE id='li-a'").get().state,'skipped');
 assert.equal(db.prepare("SELECT next_step_at FROM run_profile_tracks WHERE id='email-a'").get().next_step_at,null);
});
test('retrying failed outreach after a saved reply settles it instead of leaving it active',t=>{
 const db=fixture(t);ingestConversation(db,'a',conversation([message()]));db.exec("UPDATE run_profile_tracks SET state='in_progress' WHERE id='li-a'");
 assert.throws(()=>guards.assertQueuedOutreach(db,'li-a','a','connect'),/replied/);
 assert.equal(db.prepare("SELECT state FROM run_profile_tracks WHERE id='li-a'").get().state,'skipped');
});
test('a reply during LinkedIn composition prevents the actual send button click',async t=>{
 const db=fixture(t);db.prepare("INSERT INTO linkedin_inbox_sync(account_id,status,success_at_ms) VALUES('a','ok',?)").run(Date.now());let sends=0;
 const locator={first(){return this},waitFor:async()=>{},click:async()=>{},press:async()=>{},pressSequentially:async()=>{}};
 const send={...locator,first(){return this},waitFor:async()=>{ingestConversation(db,'a',conversation([message()]))},click:async()=>{sends++}};
 const page={goto:async()=>{},waitForTimeout:async()=>{},evaluate:async()=>{},locator:selector=>selector.includes('send-button')?send:locator};
 const {sendMessage}=loadTsx('lib/linkedin/message.ts');
 await assert.rejects(sendMessage(page,'Example Lead','Hello',conversation([]).participants[1].profileUrl,'urn:li:fsd_profile:PEER',()=>guards.assertQueuedOutreach(db,'li-a','a','message')),/replied/);
 assert.equal(sends,0);
});
test('post-dispatch completion, retries and failures cannot overwrite a reply cancellation',t=>{
 const db=fixture(t);db.exec("ALTER TABLE run_profile_tracks ADD COLUMN current_step INTEGER DEFAULT 0;ALTER TABLE run_profile_tracks ADD COLUMN last_step_at TEXT;");
 const tracks=loadTsx('lib/linkedin/track-state.ts');const tr={id:'li-a',current_step:0};ingestConversation(db,'a',conversation([message()]));
 tracks.trAdvance(db,tr,[{delay_seconds:0},{delay_seconds:60}]);tracks.trAdvance(db,tr,[{delay_seconds:0}]);tracks.trWait(db,tr,6);tracks.trReschedule(db,tr,'2026-11-25T00:00:00Z');tracks.trFail(db,tr,'late failure');tracks.trSkip(db,tr,'late skip');
 const row=db.prepare("SELECT state,next_step_at,current_step,error_message FROM run_profile_tracks WHERE id='li-a'").get();
 assert.deepEqual(row,{state:'skipped',next_step_at:null,current_step:0,error_message:'Lead replied via LinkedIn'});
});
test('HTTP 429 with malformed JSON preserves provider backoff without trying to parse the body',async()=>{
 const {readLinkedInResponse}=loadTsx('lib/linkedin/inbox/transport.ts');let disposed=0;let bodies=0;
 const response={status:()=>429,headers:()=>({'retry-after':'invalid','content-type':'application/json'}),body:async()=>{bodies++;return Buffer.from('{invalid')},dispose:async()=>{disposed++}};
 const result=await readLinkedInResponse(response);assert.equal(result.status,429);assert.equal(result.retryAfterMs,undefined);assert.equal(bodies,0);assert.equal(disposed,1);
});
test('new enrollment API writes preserve fractional seconds',t=>{
 const db=fixture(t);db.exec('ALTER TABLE run_profiles ADD COLUMN email_account_id TEXT');
 for(const file of ['pages/api/runs/index.ts','pages/api/runs/[id]/enroll.ts']){
  const source=fs.readFileSync(file,'utf8');const sql=source.match(/"(INSERT INTO run_profiles [^\n]+)"/)[1];
  db.prepare(sql).run(file,'ra','lead',null);
  const row=db.prepare('SELECT created_at FROM run_profiles WHERE id=?').get(file);assert.match(row.created_at,/\.\d{3}Z$/);
 }
});

test('a reply received during asynchronous email composition prevents SMTP delivery',async t=>{
 const db=fixture(t);db.exec(`ALTER TABLE targets ADD COLUMN apollo_enriched_at TEXT;ALTER TABLE targets ADD COLUMN email TEXT;ALTER TABLE targets ADD COLUMN sales_nav_url TEXT;
 ALTER TABLE targets ADD COLUMN email_status TEXT;ALTER TABLE targets ADD COLUMN enriched_profile_at TEXT;
 ALTER TABLE run_profiles ADD COLUMN email_account_id TEXT;ALTER TABLE logs ADD COLUMN created_at TEXT;
 ALTER TABLE run_profile_tracks ADD COLUMN current_step INTEGER DEFAULT 0;ALTER TABLE run_profile_tracks ADD COLUMN last_step_at TEXT;
 CREATE TABLE integrations(key TEXT,api_key TEXT);INSERT INTO integrations VALUES('openrouter','fixture-key');
 CREATE TABLE email_accounts(id TEXT,password TEXT,signature TEXT);INSERT INTO email_accounts VALUES('smtp','fixture',NULL);
 UPDATE targets SET email='fixture@example.invalid';UPDATE run_profile_tracks SET state='in_progress' WHERE id='email-a';`);
 let sends=0;
 const ai={getAgentConfig:()=>({default_model:'fixture-only'}),getContactWithCompany:()=>({contact:{},company:{}}),writeEmail:async()=>{await Promise.resolve();ingestConversation(db,'a',conversation([message()]));return {subject:'Fixture',body:'Fixture body'}}};
 const {executeStep}=loadTsx('lib/linkedin/runner.ts',{'@/lib/db':{getDb:()=>db},'@/lib/linkedin/inbox/guard':guards,'@/lib/premium':{premium:{ai}},'@/lib/crypto':{decryptSecret:value=>value},'@/lib/email/sender':{sendEmail:async()=>{sends++}},'@/lib/linkedin/session':{}});
 const tr={...db.prepare("SELECT * FROM run_profile_tracks WHERE id='email-a'").get(),track:'email'};
 const target=db.prepare("SELECT * FROM targets WHERE id='lead'").get();const limits={timezone:'UTC',active_hours_start:0,active_hours_end:24,working_days:'1,2,3,4,5,6,7',daily_email_limit:100};
 await executeStep(db,'ra',tr,target,[{id:'step',step_type:'email',ai_enabled:1,email_signature:null}], 'a',limits,'smtp',limits);
 assert.equal(sends,0);assert.equal(db.prepare("SELECT state FROM run_profile_tracks WHERE id='email-a'").get().state,'skipped');
});
test('an InMail adapter without a delivery-time reply guard is held instead of sending',async t=>{
 const db=fixture(t);db.exec(`ALTER TABLE targets ADD COLUMN apollo_enriched_at TEXT;ALTER TABLE targets ADD COLUMN enriched_profile_at TEXT;ALTER TABLE targets ADD COLUMN sales_nav_url TEXT;
 ALTER TABLE targets ADD COLUMN inmail_sent_at TEXT;ALTER TABLE targets ADD COLUMN message_sent_at TEXT;
 ALTER TABLE run_profile_tracks ADD COLUMN current_step INTEGER DEFAULT 0;ALTER TABLE run_profile_tracks ADD COLUMN last_step_at TEXT;ALTER TABLE run_profile_tracks ADD COLUMN last_linkedin_message TEXT;
 CREATE TABLE workflow_step_templates(step_id TEXT,template_id TEXT);UPDATE targets SET enriched_profile_at='2026-11-23',sales_nav_url='https://www.linkedin.com/sales/lead/fixture';`);
 let sends=0;const page={close:async()=>{}};
 const {executeStep}=loadTsx('lib/linkedin/runner.ts',{'@/lib/db':{getDb:()=>db},'@/lib/linkedin/inbox/guard':guards,'@/lib/premium':{premium:{inmail:{sendInMail:async()=>{sends++}}}},'@/lib/linkedin/session':{getSessionPage:async()=>page,saveSessionState:async()=>{}}});
 const tr={...db.prepare("SELECT * FROM run_profile_tracks WHERE id='li-a'").get(),track:'linkedin'};
 const limits={timezone:'UTC',active_hours_start:0,active_hours_end:24,working_days:'1,2,3,4,5,6,7'};
 await executeStep(db,'ra',tr,db.prepare("SELECT * FROM targets WHERE id='lead'").get(),[{id:'step',step_type:'sales_inmail',message_body:'Fixture',email_subject:'Fixture',ai_enabled:0}],'a',limits);
 assert.equal(sends,0);assert.equal(db.prepare("SELECT state FROM run_profile_tracks WHERE id='li-a'").get().state,'in_progress');
});
