import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { databaseTimeMs, ingestConversation, matchCampaignContact, profileKey } from "./store.ts";
import { ProviderError } from "./provider.ts";
import type { InboxProvider, ConversationSummary } from "./provider.ts";

export interface InboxSyncState { account_id:string; status:string; attempted_at_ms:number|null; success_at_ms:number|null; retry_at_ms:number|null; last_error_code:string|null; last_error:string|null; continuation:string|null; self_urn:string|null; lease_owner:string|null; lease_until_ms:number }
interface Continuation { cursor: string|null; queue:ConversationSummary[]; messageCursor:string|null; listed:boolean; started:number; boundary:number|null }
export function getInboxStatus(db:Database.Database,accountId:string):InboxSyncState {
  return db.prepare("SELECT * FROM linkedin_inbox_sync WHERE account_id=?").get(accountId) as InboxSyncState
    ?? {account_id:accountId,status:"never",attempted_at_ms:null,success_at_ms:null,retry_at_ms:null,last_error_code:null,last_error:null,continuation:null,self_urn:null,lease_owner:null,lease_until_ms:0};
}
export function inboxIsFresh(db:Database.Database,accountId:string,now=Date.now()):boolean {
  const state=getInboxStatus(db,accountId);return state.status==="ok"&&state.success_at_ms!==null&&now-state.success_at_ms<=600000&&now>=state.success_at_ms;
}
export async function syncLinkedInInbox(db:Database.Database,accountId:string,provider:InboxProvider,clock=Date.now,options:{maxRequests?:number;force?:boolean}={}) {
  let messagesAdded=0;let tracksStopped=0;const at=clock();
  if(!db.prepare("SELECT id FROM accounts WHERE id=?").get(accountId))throw new Error("Account not found");
  db.prepare("INSERT INTO linkedin_inbox_sync(account_id) VALUES(?) ON CONFLICT(account_id) DO NOTHING").run(accountId);
  const before=getInboxStatus(db,accountId);
  if(before.lease_until_ms>at)return {status:"busy",messagesAdded,tracksStopped};
  if(before.retry_at_ms&&before.retry_at_ms>at&&(!options.force||before.last_error_code==="rate_limit"))return {status:"backoff",messagesAdded,tracksStopped};
  const owner=randomUUID();const claim=db.prepare(`UPDATE linkedin_inbox_sync SET lease_owner=?,lease_until_ms=?,attempted_at_ms=?,status='syncing'
    WHERE account_id=? AND lease_until_ms<=?`).run(owner,at+180000,at,accountId,at);
  if(!claim.changes)return {status:"busy",messagesAdded,tracksStopped};
  const save=(status:string,continuation:string|null,success:number|null,retry:number|null,errorCode:string|null,error:string|null)=>{
    db.prepare(`UPDATE linkedin_inbox_sync SET status=?,continuation=?,success_at_ms=?,retry_at_ms=?,last_error_code=?,last_error=?
      WHERE account_id=? AND lease_owner=?`).run(status,continuation,success,retry,errorCode,error,accountId,owner);
  };
  let state:Continuation={cursor:null,queue:[],messageCursor:null,listed:false,started:at,boundary:before.success_at_ms===null?null:before.success_at_ms-300000};
  try {
    if(before.continuation)state=JSON.parse(before.continuation) as Continuation;
    const self=await provider.identity();db.prepare("UPDATE linkedin_inbox_sync SET self_urn=? WHERE account_id=? AND lease_owner=?").run(self.urn,accountId,owner);
    const enrollments=db.prepare(`SELECT rp.created_at FROM run_profiles rp JOIN runs r ON r.id=rp.run_id WHERE r.account_id=?`).all(accountId) as {created_at:string}[];
    const earliest=Math.min(...enrollments.map(row=>databaseTimeMs(row.created_at)));
    const maxRequests=Math.max(1,Math.min(options.maxRequests??5,10));
    let requests=0;
    while(requests<maxRequests){
      const lease=getInboxStatus(db,accountId);if(lease.lease_owner!==owner||lease.lease_until_ms<=clock())throw new ProviderError("lease","Sync lease expired");
      if(state.queue.length){
        const conversation=state.queue[0];const page=await provider.messages(conversation,state.messageCursor);requests++;
        const currentLease=getInboxStatus(db,accountId);if(currentLease.lease_owner!==owner||currentLease.lease_until_ms<=clock())throw new ProviderError("lease","Sync lease expired");
        const participants=conversation.participants.some(person=>profileKey(person.urn)===profileKey(self.urn))?conversation.participants:[self,...conversation.participants];
        const result=ingestConversation(db,accountId,{...conversation,self,participants,messages:page.messages});messagesAdded+=result.messagesAdded;tracksStopped+=result.tracksStopped;
        const oldPage=page.messages.length>0&&page.messages.every(message=>message.deliveredAt<earliest);
        if(page.nextCursor&&!oldPage){if(page.nextCursor===state.messageCursor)throw new ProviderError("unsupported","LinkedIn message pagination did not advance");state.messageCursor=page.nextCursor;}
        else{state.queue.shift();state.messageCursor=null;}
      }else if(!state.listed||state.cursor){
        const cursor=state.cursor;const page=await provider.list(cursor);requests++;
        if(page.nextCursor&&page.nextCursor===cursor)throw new ProviderError("unsupported","LinkedIn inbox pagination did not advance");
        state.queue=page.conversations.filter(conversation=>!conversation.isGroup&&conversation.lastActivityAt>=earliest&&conversation.participants.some(person=>profileKey(person.urn)!==profileKey(self.urn)&&matchCampaignContact(db,accountId,person).length));
        const boundary=state.boundary===null?earliest:Math.max(earliest,state.boundary);
        const reached=page.conversations.length>0&&page.conversations.every(conversation=>conversation.lastActivityAt<boundary);
        state.cursor=reached?null:page.nextCursor;state.listed=true;
      }else break;
      save("syncing",JSON.stringify(state),before.success_at_ms,null,null,null);
    }
    const finalLease=getInboxStatus(db,accountId);
    if(finalLease.lease_owner!==owner||finalLease.lease_until_ms<=clock())throw new ProviderError("lease","Sync lease expired");
    const complete=state.listed&&!state.cursor&&!state.queue.length;
    save(complete?"ok":"partial",complete?null:JSON.stringify(state),complete?state.started:before.success_at_ms,null,null,null);
    return {status:complete?"ok":"partial",messagesAdded,tracksStopped};
  }catch(error){
    const code=error instanceof ProviderError?error.code:"network";
    const status=code==="auth"?"auth_required":code==="rate_limit"?"rate_limited":"error";
    const delay=code==="rate_limit"?Math.min(86400000,Math.max(60000,error instanceof ProviderError?error.retryAfterMs??900000:900000)):code==="unsupported"?1800000:300000;
    const message=code==="auth"?"Reconnect LinkedIn to read messages.":code==="rate_limit"?"LinkedIn requested a pause. Sync will retry later.":code==="unsupported"?"LinkedIn returned an unsupported inbox response. No complete sync was recorded.":"LinkedIn inbox could not be checked. Sync will retry later.";
    save(status,JSON.stringify(state),before.success_at_ms,clock()+delay,code,message);return {status,messagesAdded,tracksStopped};
  }finally{db.prepare("UPDATE linkedin_inbox_sync SET lease_owner=NULL,lease_until_ms=0 WHERE account_id=? AND lease_owner=?").run(accountId,owner);}
}
