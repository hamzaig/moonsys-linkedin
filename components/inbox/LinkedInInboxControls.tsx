import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RiRefreshLine, RiLinkedinBoxLine } from "react-icons/ri";
import type { InboxAccountStatus } from "@/lib/linkedin/inbox/view";

export function SyncStatusText({account}:{account:Pick<InboxAccountStatus,"status"|"campaign_contacts"|"success_at_ms"> & Partial<Pick<InboxAccountStatus,"is_fresh">>}) {
  if(account.status==="auth_required")return <span className="text-error">Reconnect LinkedIn to check messages</span>;
  if(!account.campaign_contacts)return <span className="text-muted">No campaign contacts yet</span>;
  if(account.status==="never")return <span className="text-muted">Not checked yet</span>;
  if(account.status==="syncing")return <span className="text-primary">Checking messages…</span>;
  if(account.status==="partial")return <span className="text-primary">Reading conversation history…</span>;
  if(account.status==="rate_limited")return <span className="text-warning">LinkedIn requested a pause</span>;
  if(account.status!=="ok")return <span className="text-error">Inbox check failed · retry needed</span>;
  if(account.is_fresh===false)return <span className="text-warning">Last check is out of date · LinkedIn messages on hold</span>;
  return <span className="text-success">Last checked {account.success_at_ms?new Date(account.success_at_ms).toLocaleString():"recently"}</span>;
}
export default function LinkedInInboxControls({accountId,onAccountChange,onSynced}:{accountId:string;onAccountChange:(id:string)=>void;onSynced:()=>void}) {
  const [accounts,setAccounts]=useState<InboxAccountStatus[]>([]);const [loaded,setLoaded]=useState(false);const [error,setError]=useState("");const [requesting,setRequesting]=useState<string|null>(null);
  const refresh=useCallback(async()=>{try{const response=await fetch("/api/inbox/linkedin/sync");if(!response.ok)throw new Error("Could not load LinkedIn sync status");const data=await response.json();setAccounts(data.accounts);setLoaded(true);setError("")}catch{setError("LinkedIn sync status is unavailable. Please retry.")}},[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer)},[refresh]);
  async function sync(id:string){setRequesting(id);try{const response=await fetch("/api/inbox/linkedin/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountId:id})});const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not request a sync");await refresh();onSynced()}catch(reason){setError(reason instanceof Error?reason.message:"Could not request a sync")}finally{setRequesting(null)}}
  const visible=accounts.filter(account=>!accountId||account.id===accountId);
  return <section className="ms-panel mb-5 p-4" aria-label="LinkedIn inbox sync">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm font-semibold"><RiLinkedinBoxLine aria-hidden="true"/>LinkedIn inbox</p><div className="flex items-center gap-2"><label htmlFor="inbox-sender" className="text-xs text-muted">Sender</label><select id="inbox-sender" value={accountId} onChange={event=>onAccountChange(event.target.value)} className="select select-bordered select-sm w-full max-w-64"><option value="">All senders</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></div></div>
    {error&&<p role="alert" className="mb-3 text-xs text-error">{error}</p>}
    {!loaded&&!error?<p className="text-xs text-muted">Loading LinkedIn account status…</p>:!accounts.length&&!error?<p className="text-xs text-muted">Add a LinkedIn account in <Link href="/settings" className="underline">Settings</Link> to check campaign messages.</p>:<div className="space-y-3">{visible.map(account=><div key={account.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-3"><div className="min-w-0"><p className="text-xs font-medium">{account.name}</p><p className="mt-0.5 text-xs"><SyncStatusText account={account}/></p>{account.last_error&&account.status!=="ok"&&<p className="mt-1 max-w-xl text-xs text-muted">{account.last_error}</p>}</div><div className="flex items-center gap-3">{account.status==="auth_required"&&<Link href="/settings" className="text-xs font-medium underline">Reconnect</Link>}<button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-base-300 bg-base-200 px-3 py-2 text-xs font-medium" onClick={()=>void sync(account.id)} disabled={requesting===account.id||account.status==="syncing"||!account.campaign_contacts||account.last_error_code==="rate_limit"&&!!account.retry_at_ms&&account.retry_at_ms>Date.now()}><RiRefreshLine aria-hidden="true" className={requesting===account.id||account.status==="syncing"?"animate-spin":""}/>{requesting===account.id?"Requesting…":"Sync now"}</button></div></div>)}</div>}
    <p className="mt-3 text-xs text-muted">Campaign-period messages only. Automatic checks run about every 5 minutes.</p>
  </section>;
}
