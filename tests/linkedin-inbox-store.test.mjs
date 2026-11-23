import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initInboxSchema, ingestConversation, getStoredThread, hasRunReply, listConversations } from '../lib/linkedin/inbox/store.ts';

const enrollment = '2026-11-23 10:00:00';
const self = { urn: 'urn:li:fsd_profile:SELF', profileUrl: 'https://www.linkedin.com/in/owner/' };
const peer = { urn: 'urn:li:fsd_profile:PEER', profileUrl: 'https://www.linkedin.com/in/example-lead/' };
const timestamp = Date.parse('2026-11-23T11:00:00Z');
function fixture(t) {
 const db = new Database(':memory:');t.after(()=>db.close());db.pragma('foreign_keys = ON');
 db.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE targets(id TEXT PRIMARY KEY,full_name TEXT,linkedin_url TEXT,linkedin_member_urn TEXT,messaging_urn TEXT);
 CREATE TABLE workflows(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE runs(id TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),workflow_id TEXT,status TEXT);
 CREATE TABLE run_profiles(id TEXT PRIMARY KEY,run_id TEXT,target_id TEXT,created_at TEXT);
 CREATE TABLE run_profile_tracks(id TEXT PRIMARY KEY,run_profile_id TEXT,state TEXT,next_step_at TEXT,pending_reply_context TEXT,error_message TEXT);
 CREATE TABLE logs(id TEXT PRIMARY KEY,run_id TEXT,target_id TEXT,level TEXT,message TEXT);
 INSERT INTO accounts VALUES ('a','Account A'),('b','Account B');
 INSERT INTO targets VALUES ('lead','Example Lead','https://www.linkedin.com/in/example-lead/',NULL,'urn:li:fsd_profile:UNTRUSTED');
 INSERT INTO workflows VALUES ('w','Campaign');INSERT INTO runs VALUES ('ra','a','w','running'),('rb','b','w','running');
 INSERT INTO run_profiles VALUES ('pa','ra','lead','${enrollment}'),('pb','rb','lead','${enrollment}');
 INSERT INTO run_profile_tracks VALUES ('li-a','pa','in_progress','2026-11-25T12:00:00Z','queued',NULL),('email-a','pa','pending','2026-11-25T12:00:00Z','queued',NULL),('done-a','pa','completed',NULL,NULL,NULL),('li-b','pb','in_progress','2026-11-25T12:00:00Z','queued',NULL);`);
 initInboxSchema(db);return db;
}
function conversation(messages,extra={}) {return {urn:'thread-1',self,participants:[self,peer],isGroup:false,messages,...extra};}
function message(id='incoming',extra={}) {return {urn:id,senderUrn:peer.urn,text:'Can we discuss this?',deliveredAt:timestamp,...extra};}

test('incoming reply stops both tracks only on the receiving account and preserves completed history',t=>{
 const db=fixture(t);const result=ingestConversation(db,'a',conversation([message()]));
 assert.equal(result.messagesAdded,1);assert.equal(result.tracksStopped,2);
 assert.deepEqual(db.prepare('SELECT id,state,next_step_at,pending_reply_context FROM run_profile_tracks ORDER BY id').all(),[
  {id:'done-a',state:'completed',next_step_at:null,pending_reply_context:null},
  {id:'email-a',state:'skipped',next_step_at:null,pending_reply_context:null},
  {id:'li-a',state:'skipped',next_step_at:null,pending_reply_context:null},
  {id:'li-b',state:'in_progress',next_step_at:'2026-11-25T12:00:00Z',pending_reply_context:'queued'}]);
 assert.equal(hasRunReply(db,'pa'),true);assert.equal(hasRunReply(db,'pb'),false);
 assert.equal(listConversations(db,'a').length,1);assert.equal(listConversations(db,'b').length,0);
});
test('repeated migration and sync do not duplicate messages or reply effects',t=>{
 const db=fixture(t);initInboxSchema(db);ingestConversation(db,'a',conversation([message()]));
 const again=ingestConversation(db,'a',conversation([message()]));assert.equal(again.messagesAdded,0);assert.equal(again.tracksStopped,0);
 assert.equal(db.prepare('SELECT count(*) n FROM linkedin_messages').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM linkedin_reply_effects').get().n,1);
});
test('pre-enrollment private history is not persisted and cannot stop an active run',t=>{
 const db=fixture(t);const result=ingestConversation(db,'a',conversation([message('old',{deliveredAt:Date.parse('2026-11-22T10:00:00Z')})]));
 assert.equal(result.messagesAdded,0);assert.equal(hasRunReply(db,'pa'),false);assert.equal(listConversations(db).length,0);
});
test('own outgoing messages are stored without cancelling follow-ups',t=>{
 const db=fixture(t);const result=ingestConversation(db,'a',conversation([message('sent',{senderUrn:self.urn})]));
 assert.equal(result.messagesAdded,1);assert.equal(result.tracksStopped,0);assert.equal(hasRunReply(db,'pa'),false);
 const row=listConversations(db)[0];assert.equal(getStoredThread(db,row.id).messages[0].direction,'out');
});
test('groups, system events and unverified identities cannot create a reply',t=>{
 const db=fixture(t);
 for(const input of [conversation([message()],{isGroup:true}),conversation([message('system',{senderUrn:'system'})]),conversation([message()],{participants:[self,{...peer,profileUrl:null,urn:'urn:li:fsd_profile:UNTRUSTED'}]})]) {
  const result=ingestConversation(db,'a',input);assert.equal(result.messagesAdded,0);assert.equal(result.tracksStopped,0);
 }
 assert.equal(hasRunReply(db,'pa'),false);
});
test('exact canonical profile matching accepts query/trailing slash variants but rejects lookalike domains',t=>{
 const db=fixture(t);const candidate={...peer,profileUrl:'https://www.linkedin.com/in/EXAMPLE-LEAD?tracking=1'};
 assert.equal(ingestConversation(db,'a',conversation([message()],{participants:[self,candidate]})).messagesAdded,1);
 assert.equal(ingestConversation(db,'b',conversation([message()],{participants:[self,{...peer,profileUrl:'https://linkedin.com.attacker.test/in/example-lead'}]})).messagesAdded,0);
});
test('an old campaign reply cannot cancel a newer enrollment for the same account/contact',t=>{
 const db=fixture(t);db.exec(`INSERT INTO runs VALUES ('new','a','w','running');INSERT INTO run_profiles VALUES ('new-profile','new','lead','2026-11-24 10:00:00');INSERT INTO run_profile_tracks VALUES ('new-track','new-profile','pending','2026-11-25T12:00:00Z',NULL,NULL);`);
 ingestConversation(db,'a',conversation([message()]));assert.equal(hasRunReply(db,'pa'),true);assert.equal(hasRunReply(db,'new-profile'),false);assert.equal(db.prepare("SELECT state FROM run_profile_tracks WHERE id='new-track'").get().state,'pending');
});
test('out-of-order messages keep a chronological thread and newest incoming summary',t=>{
 const db=fixture(t);ingestConversation(db,'a',conversation([message('new',{deliveredAt:timestamp+60000,text:'Newest'}),message('older',{text:'Older'})]));
 const row=listConversations(db)[0];assert.equal(row.last_message,'Newest');assert.deepEqual(getStoredThread(db,row.id).messages.map(m=>m.text),['Older','Newest']);
});
test('a failure while recording the reply effect rolls back message storage and cancellation together',t=>{
 const db=fixture(t);db.exec("CREATE TRIGGER break_effect BEFORE INSERT ON linkedin_reply_effects BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
 assert.throws(()=>ingestConversation(db,'a',conversation([message()])),/fixture failure/);
 assert.equal(db.prepare('SELECT count(*) n FROM linkedin_messages').get().n,0);assert.equal(db.prepare("SELECT state FROM run_profile_tracks WHERE id='li-a'").get().state,'in_progress');
});
