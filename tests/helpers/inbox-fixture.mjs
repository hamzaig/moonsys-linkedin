import Database from 'better-sqlite3';
import { initInboxSchema } from '../../lib/linkedin/inbox/store.ts';
export const enrollment = '2026-11-23 10:00:00';
export const self = { urn: 'urn:li:fsd_profile:SELF', profileUrl: 'https://www.linkedin.com/in/owner/' };
export const peer = { urn: 'urn:li:fsd_profile:PEER', profileUrl: 'https://www.linkedin.com/in/example-lead/' };
export const timestamp = Date.parse('2026-11-23T11:00:00Z');
export function fixture(t) {
 const db = new Database(':memory:');t.after(()=>db.close());db.pragma('foreign_keys = ON');
 db.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT,is_authenticated INTEGER DEFAULT 1);CREATE TABLE targets(id TEXT PRIMARY KEY,full_name TEXT,linkedin_url TEXT,linkedin_member_urn TEXT,messaging_urn TEXT);
 CREATE TABLE workflows(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE runs(id TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id),workflow_id TEXT,status TEXT);
 CREATE TABLE run_profiles(id TEXT PRIMARY KEY,run_id TEXT,target_id TEXT,created_at TEXT);
 CREATE TABLE run_profile_tracks(id TEXT PRIMARY KEY,run_profile_id TEXT,state TEXT,next_step_at TEXT,pending_reply_context TEXT,error_message TEXT);
 CREATE TABLE logs(id TEXT PRIMARY KEY,run_id TEXT,target_id TEXT,level TEXT,message TEXT);
 INSERT INTO accounts(id,name) VALUES ('a','Account A'),('b','Account B');
 INSERT INTO targets VALUES ('lead','Example Lead','https://www.linkedin.com/in/example-lead/',NULL,'urn:li:fsd_profile:UNTRUSTED');
 INSERT INTO workflows VALUES ('w','Campaign');INSERT INTO runs VALUES ('ra','a','w','running'),('rb','b','w','running');
 INSERT INTO run_profiles VALUES ('pa','ra','lead','${enrollment}'),('pb','rb','lead','${enrollment}');
 INSERT INTO run_profile_tracks VALUES ('li-a','pa','in_progress','2026-11-25T12:00:00Z','queued',NULL),('email-a','pa','pending','2026-11-25T12:00:00Z','queued',NULL),('done-a','pa','completed',NULL,NULL,NULL),('li-b','pb','in_progress','2026-11-25T12:00:00Z','queued',NULL);`);
 initInboxSchema(db);return db;
}
export function conversation(messages,extra={}) {return {urn:'thread-1',self,participants:[self,peer],isGroup:false,messages,...extra};}
export function message(id='incoming',extra={}) {return {urn:id,senderUrn:peer.urn,text:'Can we discuss this?',deliveredAt:timestamp,...extra};}

