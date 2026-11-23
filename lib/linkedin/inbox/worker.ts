import type Database from "better-sqlite3";
import { getInboxStatus } from "./sync.ts";

type SyncAccount=(db:Database.Database,accountId:string,options?:{force?:boolean})=>Promise<{status:string}>;
export function accountSyncDue(db:Database.Database,accountId:string,now=Date.now()):boolean {
  const state=getInboxStatus(db,accountId);
  if(state.lease_until_ms>now||state.retry_at_ms!==null&&state.retry_at_ms>now)return false;
  if(state.status==="partial"||state.status==="syncing")return !state.attempted_at_ms||now-state.attempted_at_ms>=30000;
  let hash=0;for(const char of accountId)hash=(hash*31+char.charCodeAt(0))>>>0;
  return state.success_at_ms===null||now-state.success_at_ms>=300000+hash%30000;
}
export async function runInboxWorkerTick(db:Database.Database,sync:SyncAccount,clock=Date.now,report:(message:string)=>void=()=>{}):Promise<void> {
  const accounts=db.prepare(`SELECT a.id FROM accounts a WHERE a.is_authenticated=1 AND EXISTS
    (SELECT 1 FROM runs r JOIN run_profiles rp ON rp.run_id=r.id WHERE r.account_id=a.id) ORDER BY a.id`).all() as {id:string}[];
  for(const account of accounts){
    if(!accountSyncDue(db,account.id,clock()))continue;
    try{await sync(db,account.id)}catch{report("A LinkedIn account could not be synced; other accounts will continue.")}
  }
}
export function ensureLinkedInInboxWorkerStarted(dependencies:{getDb:()=>Database.Database;sync:SyncAccount;report?:(message:string)=>void}):void {
  const global=globalThis as typeof globalThis&{__moonsysLinkedInInboxWorker?:{busy:boolean;timer:ReturnType<typeof setInterval>}};
  if(global.__moonsysLinkedInInboxWorker)return;
  const state={busy:false,timer:undefined as unknown as ReturnType<typeof setInterval>};
  const report=dependencies.report??((message:string)=>console.warn(`[linkedin-inbox] ${message}`));
  const tick=async()=>{if(state.busy)return;state.busy=true;try{await runInboxWorkerTick(dependencies.getDb(),dependencies.sync,Date.now,report)}catch{report("Inbox worker is waiting to retry.")}finally{state.busy=false}};
  state.timer=setInterval(()=>void tick(),30000);state.timer.unref();global.__moonsysLinkedInInboxWorker=state;void tick();
}
