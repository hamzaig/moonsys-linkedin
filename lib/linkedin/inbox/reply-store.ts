import {conversationIdentity} from "./reply-identity.ts";
import type Database from "better-sqlite3";
import { createHash,randomUUID } from "node:crypto";
import { matchCampaignContact,profileKey } from "./store.ts";
import type { Participant } from "./store.ts";
import { ReplyError,validRequestId } from "./reply-types.ts";
import type { ReplyOperation,ReplyBinding,ReplyAck,ReplyCapability,PublicReply } from "./reply-types.ts";
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const LEASE=120000;
const active="(status IN ('preparing','sending') OR (status='unknown' AND acknowledged_at_ms IS NULL))";
export function initReplySchema(db:Database.Database):void {
 const accountColumns=db.prepare("PRAGMA table_info(accounts)").all() as {name:string}[];
 if(!accountColumns.some(column=>column.name==="linkedin_session_revision"))db.exec("ALTER TABLE accounts ADD COLUMN linkedin_session_revision INTEGER NOT NULL DEFAULT 0");
 db.exec(`CREATE TRIGGER IF NOT EXISTS linkedin_reply_session_revision AFTER UPDATE OF is_authenticated ON accounts
  BEGIN UPDATE accounts SET linkedin_session_revision=OLD.linkedin_session_revision+1 WHERE id=NEW.id; END;`);
 db.exec(`CREATE TABLE IF NOT EXISTS linkedin_reply_sends (
  id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES linkedin_conversations(id) ON DELETE SET NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,binding_hash TEXT NOT NULL,body_hash TEXT NOT NULL,text TEXT,
  status TEXT NOT NULL CHECK(status IN ('preparing','sending','sent','failed','unknown')),
  created_at_ms INTEGER NOT NULL,updated_at_ms INTEGER NOT NULL,expires_at_ms INTEGER NOT NULL,attempt_token TEXT,
  expected_session_revision INTEGER,expected_self_urn TEXT,expected_peer_urn TEXT,expected_conversation_urn TEXT,expected_target_id TEXT,
  provider_urn TEXT,provider_at_ms INTEGER,error_code TEXT,error_message TEXT,acknowledged_at_ms INTEGER,details_removed INTEGER NOT NULL DEFAULT 0);
 CREATE UNIQUE INDEX IF NOT EXISTS idx_linkedin_reply_active ON linkedin_reply_sends(conversation_id) WHERE ${active};
 CREATE INDEX IF NOT EXISTS idx_linkedin_reply_thread ON linkedin_reply_sends(conversation_id,created_at_ms);
 CREATE TABLE IF NOT EXISTS linkedin_reply_accounts(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  lease_owner TEXT,lease_until_ms INTEGER NOT NULL DEFAULT 0,retry_at_ms INTEGER);
 `);
 if(!(db.prepare("PRAGMA table_info(linkedin_reply_sends)").all() as {name:string}[]).some(column=>column.name==="expected_session_revision"))db.exec("ALTER TABLE linkedin_reply_sends ADD COLUMN expected_session_revision INTEGER");
 const purge=`UPDATE linkedin_reply_sends SET text=NULL,expected_self_urn=NULL,expected_peer_urn=NULL,expected_conversation_urn=NULL,expected_target_id=NULL,
  provider_urn=NULL,provider_at_ms=NULL,conversation_id=NULL,account_id=NULL,details_removed=1,
  status=CASE WHEN status='preparing' THEN 'failed' WHEN status='sending' THEN 'unknown' ELSE status END,
  error_code='deleted',error_message='Conversation details were removed.'`;
 db.exec(`CREATE TRIGGER IF NOT EXISTS linkedin_reply_delete_conversation BEFORE DELETE ON linkedin_conversations BEGIN ${purge} WHERE conversation_id=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS linkedin_reply_delete_account BEFORE DELETE ON accounts BEGIN ${purge} WHERE account_id=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS linkedin_reply_delete_target BEFORE DELETE ON targets BEGIN ${purge} WHERE expected_target_id=OLD.id; END;`);
}
function raw(db:Database.Database,id:string):ReplyOperation|null{return db.prepare("SELECT * FROM linkedin_reply_sends WHERE id=?").get(id) as ReplyOperation??null}
function recover(db:Database.Database,now:number):void {
 db.prepare(`UPDATE linkedin_reply_sends SET status=CASE WHEN status='sending' THEN 'unknown' ELSE 'failed' END,
  error_code=CASE WHEN status='sending' THEN 'uncertain' ELSE 'expired' END,
  error_message=CASE WHEN status='sending' THEN 'Delivery could not be confirmed. Check LinkedIn before another reply.' ELSE 'This reply expired before dispatch. You can retry explicitly.' END,
  updated_at_ms=? WHERE status IN ('preparing','sending') AND expires_at_ms<=?`).run(now,now);
 db.prepare("UPDATE linkedin_reply_accounts SET lease_owner=NULL,lease_until_ms=0 WHERE lease_until_ms<=?").run(now);
}
export function getReplyBinding(db:Database.Database,id:string):ReplyBinding|null {
 return db.prepare(`SELECT c.id,c.account_id,c.target_id,c.provider_urn,c.peer_urn,a.name AS account_name,a.is_authenticated,a.linkedin_session_revision AS session_revision,s.self_urn
  FROM linkedin_conversations c JOIN accounts a ON a.id=c.account_id JOIN targets t ON t.id=c.target_id
  LEFT JOIN linkedin_inbox_sync s ON s.account_id=c.account_id WHERE c.id=?`).get(id) as ReplyBinding??null;
}
function checkBinding(binding:ReplyBinding|null,op?:ReplyOperation):asserts binding is ReplyBinding {
 if(!binding)throw new ReplyError(404,"deleted","Conversation is no longer available.");
 if(!binding.is_authenticated)throw new ReplyError(409,"auth","Reconnect LinkedIn to send a reply.");
 if(!binding.self_urn||!profileKey(binding.self_urn)||!profileKey(binding.peer_urn))throw new ReplyError(409,"identity","Read and verify this account's conversation before replying.");
 const conversation=conversationIdentity(binding.provider_urn);
 if(!conversation)throw new ReplyError(409,"unsupported","Open this conversation on LinkedIn; its identity is not supported for sending.");
 if(profileKey(conversation.ownerUrn)!==profileKey(binding.self_urn))throw new ReplyError(409,"identity","The conversation mailbox does not match the verified owner.");
 if(op&&(binding.session_revision!==op.expected_session_revision||binding.account_id!==op.account_id||binding.provider_urn!==op.expected_conversation_urn||binding.target_id!==op.expected_target_id||profileKey(binding.peer_urn)!==profileKey(op.expected_peer_urn)||profileKey(binding.self_urn)!==profileKey(op.expected_self_urn)))throw new ReplyError(409,"identity","The conversation or account identity changed. No reply was sent.");
}
function backoff(db:Database.Database,accountId:string,now:number):number|null {
 const manual=db.prepare("SELECT retry_at_ms FROM linkedin_reply_accounts WHERE account_id=?").get(accountId) as {retry_at_ms:number|null}|undefined;
 const reader=db.prepare("SELECT retry_at_ms,last_error_code FROM linkedin_inbox_sync WHERE account_id=?").get(accountId) as {retry_at_ms:number|null;last_error_code:string|null}|undefined;
 const until=Math.max(manual?.retry_at_ms??0,reader?.last_error_code==="rate_limit"?reader.retry_at_ms??0:0);
 return until>now?until:null;
}
function requireNoBackoff(db:Database.Database,accountId:string,now:number):void {if(backoff(db,accountId,now))throw new ReplyError(429,"rate_limit","LinkedIn requested a pause. Retry after the pause ends.")}
export function getReply(db:Database.Database,id:string,now=Date.now()):ReplyOperation|null {recover(db,now);return raw(db,id)}
export function listReplySends(db:Database.Database,conversationId:string,now=Date.now()):ReplyOperation[] {
 recover(db,now);return db.prepare(`SELECT * FROM linkedin_reply_sends WHERE conversation_id=? ORDER BY ${active} DESC,created_at_ms DESC,id DESC LIMIT 11`).all(conversationId) as ReplyOperation[];
}
export function reserveReply(db:Database.Database,input:{requestId:string;conversationId:string;text:string},now=Date.now()):ReplyOperation {
 if(!validRequestId(input.requestId)||typeof input.conversationId!=="string"||!input.conversationId||input.conversationId.length>128||typeof input.text!=="string"||!input.text.trim()||input.text.length>3000)throw new ReplyError(400,"invalid","A valid request ID, conversation and reply of 1–3000 characters are required.");
 return db.transaction(()=>{
  recover(db,now);const prior=raw(db,input.requestId);
  if(prior){if(prior.binding_hash!==hash(input.conversationId)||prior.body_hash!==hash(input.text))throw new ReplyError(409,"conflict","This request ID belongs to a different reply.");return prior;}
  const binding=getReplyBinding(db,input.conversationId);checkBinding(binding);requireNoBackoff(db,binding.account_id,now);
  if(db.prepare(`SELECT id FROM linkedin_reply_sends WHERE conversation_id=? AND ${active}`).get(binding.id))throw new ReplyError(409,"conversation_busy","A reply in this conversation still needs attention. Refresh its send status.");
  db.prepare(`INSERT INTO linkedin_reply_sends(id,conversation_id,account_id,binding_hash,body_hash,text,status,created_at_ms,updated_at_ms,expires_at_ms,expected_self_urn,expected_peer_urn,expected_conversation_urn,expected_target_id,expected_session_revision)
   VALUES(?,?,?,?,?,?,'preparing',?,?,?,?,?,?,?,?)`).run(input.requestId,binding.id,binding.account_id,hash(binding.id),hash(input.text),input.text,now,now,now+LEASE,binding.self_urn,binding.peer_urn,binding.provider_urn,binding.target_id,binding.session_revision);
  return raw(db,input.requestId)!;
 })();
}
export function claimReply(db:Database.Database,id:string,now=Date.now()):{operation:ReplyOperation;claimed:boolean;token?:string} {
 return db.transaction(()=>{
  recover(db,now);const op=raw(db,id);if(!op)throw new ReplyError(404,"not_found","Reply request not found.");
  if(op.status!=="preparing"||op.attempt_token)return {operation:op,claimed:false};
  try{const binding=getReplyBinding(db,op.conversation_id!);checkBinding(binding,op);requireNoBackoff(db,binding.account_id,now)}catch(error){if(!(error instanceof ReplyError))throw error;db.prepare("UPDATE linkedin_reply_sends SET status='failed',error_code=?,error_message=?,updated_at_ms=? WHERE id=?").run(error.code,error.message,now,id);return {operation:raw(db,id)!,claimed:false};}
  const accountId=op.account_id!;db.prepare("INSERT INTO linkedin_reply_accounts(account_id) VALUES(?) ON CONFLICT(account_id) DO NOTHING").run(accountId);
  const lease=db.prepare("SELECT lease_until_ms FROM linkedin_reply_accounts WHERE account_id=?").get(accountId) as {lease_until_ms:number};
  if(lease.lease_until_ms>now)throw new ReplyError(409,"account_busy","Another manual reply is being sent from this account. Try this saved reply shortly.");
  const token=randomUUID();db.prepare("UPDATE linkedin_reply_accounts SET lease_owner=?,lease_until_ms=? WHERE account_id=?").run(token,now+LEASE,accountId);
  db.prepare("UPDATE linkedin_reply_sends SET attempt_token=?,updated_at_ms=?,expires_at_ms=? WHERE id=?").run(token,now,now+LEASE,id);
  return {operation:raw(db,id)!,claimed:true,token};
 })();
}
export function markReplySending(db:Database.Database,id:string,token:string,peer:Participant,now=Date.now()):void {
 db.transaction(()=>{
  const op=raw(db,id);if(!op||op.status!=="preparing"||op.attempt_token!==token||op.expires_at_ms<=now)throw new ReplyError(409,"expired","This send attempt is no longer active.");
  const binding=getReplyBinding(db,op.conversation_id!);checkBinding(binding,op);requireNoBackoff(db,binding.account_id,now);
  const lease=db.prepare("SELECT lease_owner,lease_until_ms FROM linkedin_reply_accounts WHERE account_id=?").get(binding.account_id) as {lease_owner:string;lease_until_ms:number}|undefined;
  if(lease?.lease_owner!==token||lease.lease_until_ms<=now)throw new ReplyError(409,"expired","This send attempt is no longer active.");
  if(profileKey(peer.urn)!==profileKey(binding.peer_urn)||!matchCampaignContact(db,binding.account_id,peer).some(row=>row.target_id===binding.target_id))throw new ReplyError(409,"identity","The contact binding changed. No reply was sent.");
  db.prepare("UPDATE linkedin_reply_sends SET status='sending',updated_at_ms=? WHERE id=?").run(now,id);
 })();
}
function release(db:Database.Database,token:string):void {db.prepare("UPDATE linkedin_reply_accounts SET lease_owner=NULL,lease_until_ms=0 WHERE lease_owner=?").run(token)}
export function finishReply(db:Database.Database,id:string,token:string,ack:ReplyAck,now=Date.now()):void {
 db.transaction(()=>{
  const op=raw(db,id);if(!op||op.attempt_token!==token||!["sending","unknown"].includes(op.status))return;
  db.prepare(`UPDATE linkedin_reply_sends SET status='sent',updated_at_ms=?,provider_urn=?,provider_at_ms=?,error_code=?,error_message=? WHERE id=?`)
   .run(now,op.details_removed?null:ack.messageUrn,op.details_removed?null:ack.deliveredAt,op.details_removed?"deleted":null,op.details_removed?"Conversation details were removed.":null,id);release(db,token);
 })();
}
export function failReply(db:Database.Database,id:string,token:string,code:string,now=Date.now(),retryAfterMs?:number,originalAccountId?:string):void {
 db.transaction(()=>{
  const op=raw(db,id);if(!op||op.attempt_token!==token)return;
  const lease=db.prepare("SELECT account_id FROM linkedin_reply_accounts WHERE lease_owner=?").get(token) as {account_id:string}|undefined;
  const accountId=lease?.account_id??originalAccountId??op.account_id;
  if(code==="rate_limit"&&accountId&&db.prepare("SELECT 1 FROM accounts WHERE id=?").get(accountId)){
   const delay=Number.isFinite(retryAfterMs)?Math.max(60000,Math.min(86400000,retryAfterMs!)):900000;
   db.prepare(`INSERT INTO linkedin_reply_accounts(account_id,retry_at_ms) VALUES(?,?)
    ON CONFLICT(account_id) DO UPDATE SET retry_at_ms=MAX(COALESCE(retry_at_ms,0),excluded.retry_at_ms)`).run(accountId,now+delay);
  }
  if(["preparing","sending","unknown"].includes(op.status)){
   const uncertain=op.status!=="preparing";
   const message=op.details_removed?"Conversation details were removed.":uncertain?"Delivery could not be confirmed. Check LinkedIn before another reply.":code==="auth"?"Reconnect LinkedIn to send a reply.":code==="rate_limit"?"LinkedIn requested a pause. Retry after the pause ends.":code==="identity"?"The account or conversation could not be verified. No reply was sent.":"This reply could not be prepared. No reply was sent; you can retry explicitly.";
   db.prepare("UPDATE linkedin_reply_sends SET status=?,error_code=?,error_message=?,updated_at_ms=? WHERE id=?").run(uncertain?"unknown":"failed",op.details_removed?"deleted":code,message,now,id);
  }
  // A deletion may have already made the tombstone terminal; its surviving
  // account lease/backoff still needs cleanup, fenced by this attempt token.
  release(db,token);
 })();
}
export function acknowledgeReply(db:Database.Database,id:string,now=Date.now()):ReplyOperation {
 recover(db,now);const op=raw(db,id);if(!op)throw new ReplyError(404,"not_found","Reply request not found.");
 if(op.status!=="unknown")throw new ReplyError(409,"invalid_state","Only an unconfirmed delivery needs this acknowledgment.");
 db.prepare("UPDATE linkedin_reply_sends SET acknowledged_at_ms=COALESCE(acknowledged_at_ms,?),updated_at_ms=? WHERE id=?").run(now,now,id);return raw(db,id)!;
}
export function replyCapability(db:Database.Database,id:string,now=Date.now()):ReplyCapability {
 recover(db,now);const binding=getReplyBinding(db,id);let code:string|null=null;let reason:string|null=null;let retry:number|null=null;
 try{checkBinding(binding);retry=backoff(db,binding.account_id,now);if(retry)throw new ReplyError(429,"rate_limit","LinkedIn requested a pause. Retry after the pause ends.")}catch(error){if(!(error instanceof ReplyError))throw error;code=error.code;reason=error.message;}
 const pending=db.prepare(`SELECT id,status FROM linkedin_reply_sends WHERE conversation_id=? AND ${active} LIMIT 1`).get(id) as {id:string;status:string}|undefined;
 if(!code&&pending){code="conversation_busy";reason=pending.status==="unknown"?"Check the unconfirmed reply on LinkedIn before another reply.":"A saved reply is still in progress.";}
 return {can_reply:!code,code,reason,retry_at_ms:retry,active_request_id:pending?.id??null};
}
export function publicReply(op:ReplyOperation):PublicReply {
 const {id,conversation_id,account_id,text,status,created_at_ms,updated_at_ms,provider_urn,provider_at_ms,error_code,error_message,acknowledged_at_ms,details_removed}=op;
 return {id,conversation_id,account_id,text,status,created_at_ms,updated_at_ms,provider_urn,provider_at_ms,error_code,error_message,acknowledged_at_ms,details_removed,can_dispatch:status==="preparing"&&!op.attempt_token&&!details_removed};
}
