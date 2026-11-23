import type Database from "better-sqlite3";
import { hasRunReply } from "./store.ts";
import { inboxIsFresh } from "./sync.ts";

export function checkQueuedOutreach(db:Database.Database,trackId:string,accountId:string,stepType:string,now=Date.now()):"replied"|"inactive"|"sync_stale"|null {
  const row=db.prepare(`SELECT rt.run_profile_id,rt.state,r.status,r.account_id FROM run_profile_tracks rt
    JOIN run_profiles rp ON rp.id=rt.run_profile_id JOIN runs r ON r.id=rp.run_id WHERE rt.id=?`).get(trackId) as
    {run_profile_id:string;state:string;status:string;account_id:string}|undefined;
  if(!row||row.account_id!==accountId)return "inactive";
  if(hasRunReply(db,row.run_profile_id))return "replied";
  if(row.state!=="in_progress"||row.status!=="running")return "inactive";
  return stepType==="message"&&!inboxIsFresh(db,accountId,now)?"sync_stale":null;
}
export function holdForInbox(db:Database.Database,trackId:string,now=Date.now()):boolean {
  return db.prepare(`UPDATE run_profile_tracks SET next_step_at=? WHERE id=? AND state='in_progress'
    AND NOT EXISTS(SELECT 1 FROM linkedin_reply_effects e WHERE e.run_profile_id=run_profile_tracks.run_profile_id)
    AND EXISTS(SELECT 1 FROM run_profiles rp JOIN runs r ON r.id=rp.run_id WHERE rp.id=run_profile_tracks.run_profile_id AND r.status='running')`)
    .run(new Date(now+60000).toISOString(),trackId).changes>0;
}
