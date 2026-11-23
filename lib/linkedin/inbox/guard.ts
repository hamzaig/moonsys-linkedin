import type Database from "better-sqlite3";
import { hasRunReply } from "./store.ts";
import { inboxIsFresh } from "./sync.ts";
type Gate="replied"|"inactive"|"sync_stale";
export class OutreachHeldError extends Error {
  reason:Gate;
  constructor(reason:Gate){super(`Outreach held: ${reason}`);this.reason=reason;this.name="OutreachHeldError"}
}
export function checkQueuedOutreach(db:Database.Database,trackId:string,accountId:string,stepType:string,now=Date.now()):Gate|null {
  const row=db.prepare(`SELECT rt.run_profile_id,rt.state,r.status,r.account_id,t.last_replied_at,t.email_replied_at FROM run_profile_tracks rt
    JOIN run_profiles rp ON rp.id=rt.run_profile_id JOIN runs r ON r.id=rp.run_id JOIN targets t ON t.id=rp.target_id WHERE rt.id=?`).get(trackId) as
    {run_profile_id:string;state:string;status:string;account_id:string;last_replied_at:string|null;email_replied_at:string|null}|undefined;
  if(!row||row.account_id!==accountId)return "inactive";
  if(hasRunReply(db,row.run_profile_id)||row.last_replied_at||row.email_replied_at)return "replied";
  if(row.state!=="in_progress"||row.status!=="running")return "inactive";
  return stepType==="message"&&!inboxIsFresh(db,accountId,now)?"sync_stale":null;
}
export function assertQueuedOutreach(db:Database.Database,trackId:string,accountId:string,stepType:string,now=Date.now()):void {
  const reason=checkQueuedOutreach(db,trackId,accountId,stepType,now);if(!reason)return;
  if(reason==="replied")db.prepare(`UPDATE run_profile_tracks SET state='skipped',next_step_at=NULL,pending_reply_context=NULL,error_message='Lead replied'
    WHERE run_profile_id=(SELECT run_profile_id FROM run_profile_tracks WHERE id=?) AND state IN ('pending','in_progress')`).run(trackId);
  if(reason==="sync_stale")holdForInbox(db,trackId,now);
  throw new OutreachHeldError(reason);
}
export function holdForInbox(db:Database.Database,trackId:string,now=Date.now()):boolean {
  return db.prepare(`UPDATE run_profile_tracks SET next_step_at=? WHERE id=? AND state='in_progress'
    AND NOT EXISTS(SELECT 1 FROM linkedin_reply_effects e WHERE e.run_profile_id=run_profile_tracks.run_profile_id)
    AND EXISTS(SELECT 1 FROM run_profiles rp JOIN runs r ON r.id=rp.run_id JOIN targets t ON t.id=rp.target_id
      WHERE rp.id=run_profile_tracks.run_profile_id AND r.status='running' AND t.last_replied_at IS NULL AND t.email_replied_at IS NULL)`)
    .run(new Date(now+60000).toISOString(),trackId).changes>0;
}
