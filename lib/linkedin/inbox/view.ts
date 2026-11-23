import type Database from "better-sqlite3";
import type { InboxReply } from "../../inbox/types.ts";
import { listConversations } from "./store.ts";
import { getInboxStatus, inboxIsFresh } from "./sync.ts";
export { linkedInConversationUrl } from "./presentation.ts";

export interface InboxAccountStatus { id:string; name:string; is_authenticated:number; campaign_contacts:number; is_fresh:boolean; status:string; attempted_at_ms:number|null; success_at_ms:number|null; retry_at_ms:number|null; last_error_code:string|null; last_error:string|null }
export function getInboxAccounts(db:Database.Database):InboxAccountStatus[] {
  const rows=db.prepare(`SELECT a.id,a.name,a.is_authenticated,
    (SELECT count(DISTINCT rp.target_id) FROM run_profiles rp JOIN runs r ON r.id=rp.run_id WHERE r.account_id=a.id) AS campaign_contacts
    FROM accounts a ORDER BY a.name`).all() as {id:string;name:string;is_authenticated:number;campaign_contacts:number}[];
  return rows.map(account=>{
    const state=getInboxStatus(db,account.id);
    return {...account,is_fresh:inboxIsFresh(db,account.id),status:account.is_authenticated?state.status:"auth_required",attempted_at_ms:state.attempted_at_ms,success_at_ms:state.success_at_ms,retry_at_ms:state.retry_at_ms,last_error_code:state.last_error_code,last_error:state.last_error};
  });
}
export function getLinkedInInboxRows(db:Database.Database,accountId?:string):InboxReply[] {
  return listConversations(db,accountId).map(row=>({
    id:row.target_id,inbox_key:`linkedin:${row.id}`,linkedin_conversation_id:row.id,linkedin_account_id:row.account_id,linkedin_account_name:row.account_name,
    full_name:row.full_name,linkedin_url:row.linkedin_url,email:null,headline:null,company:null,channel:"linkedin",
    replied_at:new Date(row.last_message_at_ms).toISOString(),email_replied_at:null,last_replied_at:row.last_incoming_at_ms===null?null:new Date(row.last_incoming_at_ms).toISOString(),
    run_id:row.run_id,workflow_id:row.workflow_id,workflow_name:row.workflow_name,email_account_id:null,email_account_name:null,email_account_from:null,
    reply_id:null,reply_kind:null,reply_summary:null,reply_body:null,classified_at:null,classification_error:null,dispatched_at:null,dispatch_result_json:null,manually_edited:0,last_message:row.last_message,
  }));
}
