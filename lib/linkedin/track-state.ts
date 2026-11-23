import type Database from "better-sqlite3";
type Track={id:string;current_step:number};
const active=" WHERE id=? AND state='in_progress' AND current_step=?";
export function trAdvance(db:Database.Database,tr:Track,steps:{delay_seconds:number}[]) {
  const nextIndex=tr.current_step+1;
  if(nextIndex>=steps.length)db.prepare("UPDATE run_profile_tracks SET state='completed',current_step=?,last_step_at=datetime('now'),next_step_at=NULL"+active).run(nextIndex,tr.id,tr.current_step);
  else {
    const delay=steps[nextIndex].delay_seconds;
    db.prepare("UPDATE run_profile_tracks SET current_step=?,last_step_at=datetime('now'),next_step_at=?"+active).run(nextIndex,delay>0?new Date(Date.now()+delay*1000).toISOString():null,tr.id,tr.current_step);
  }
}
export function trWait(db:Database.Database,tr:Track,hours:number) {trReschedule(db,tr,new Date(Date.now()+hours*3600000).toISOString())}
export function trReschedule(db:Database.Database,tr:Track,time:string) {db.prepare("UPDATE run_profile_tracks SET next_step_at=?"+active).run(time,tr.id,tr.current_step)}
export function trSkip(db:Database.Database,tr:Track,reason:string) {db.prepare("UPDATE run_profile_tracks SET state='skipped',error_message=?,next_step_at=NULL,pending_reply_context=NULL"+active).run(reason,tr.id,tr.current_step)}
export function trFail(db:Database.Database,tr:Track,reason:string) {db.prepare("UPDATE run_profile_tracks SET state='failed',error_message=?"+active).run(reason,tr.id,tr.current_step)}
