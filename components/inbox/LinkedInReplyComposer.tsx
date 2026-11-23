import {useRef,useState,useSyncExternalStore} from "react";
import {RiLoader4Line,RiSendPlaneLine} from "react-icons/ri";
import {ReplyClientError,ReplyDraftRegistry,reserveAndDispatchReply,dispatchSavedReply,getReplyStatus,acknowledgeUnknownReply} from "@/lib/inbox/reply-client";
import type {PublicReply,ReplyCapability} from "@/lib/linkedin/inbox/reply-types";

interface ViewProps {sender:string;text:string;disabled:boolean;busy:boolean;busyLabel?:string;error:string;onText:(text:string)=>void;onSend:()=>void}
export function LinkedInReplyComposerView({sender,text,disabled,busy,busyLabel="Sending…",error,onText,onSend}:ViewProps){
 return <div className="space-y-2" aria-busy={busy}>
  <label htmlFor="linkedin-reply-text" className="block text-sm font-medium">Reply as {sender}</label>
  <textarea id="linkedin-reply-text" value={text} onChange={event=>onText(event.target.value)} maxLength={3000} rows={3} disabled={disabled||busy} aria-describedby="linkedin-reply-help linkedin-reply-count" className="w-full rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content placeholder:text-muted focus:border-primary/40 focus:outline-none disabled:opacity-60" placeholder="Write your reply…"/>
  <div className="flex items-center justify-between gap-3"><span id="linkedin-reply-count" className="text-xs text-muted">{text.length} / 3000</span><button type="button" onClick={onSend} disabled={disabled||busy||!text.trim()||text.length>3000} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-content disabled:opacity-50">{busy?<RiLoader4Line className="animate-spin" aria-hidden="true"/>:<RiSendPlaneLine aria-hidden="true"/>}{busy?busyLabel:"Send"}</button></div>
  <p id="linkedin-reply-help" className={`text-xs ${error?"text-error":"text-muted"}`}>{error||"Send a text reply to this conversation. Enter adds a new line."}</p>
 </div>;
}
export function ReplySendStatus({operation,onAcknowledge,onSavedSend,onRestore,busy=false,canSend=true,canRestore=true}:{operation:PublicReply;onAcknowledge:()=>void;onSavedSend:()=>void;onRestore?:()=>void;busy?:boolean;canSend?:boolean;canRestore?:boolean}){
 const title=operation.status==="unknown"?"Delivery unconfirmed":operation.status==="sent"?"Sent":operation.status==="failed"?"Failed":operation.status==="sending"?"Sending":"Reply saved";
 return <div className="rounded-lg border border-base-300 bg-base-200 p-3 text-xs">
  <p className="font-medium">Last reply: {title}{operation.status==="unknown"&&operation.acknowledged_at_ms?" · checked by you":""}</p>
  {operation.text&&<p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-muted">{operation.text}</p>}
  {operation.error_message&&<p className="mt-1 text-muted">{operation.error_message}</p>}
  {operation.status==="sent"&&<p className="mt-1 text-muted">LinkedIn acknowledged this message. Recipient read status is unavailable.</p>}
  {operation.status==="unknown"&&!operation.acknowledged_at_ms&&<div className="mt-2"><p className="mb-2">Check this conversation on LinkedIn before composing another reply. Acknowledging does not resend or confirm delivery.</p><button type="button" disabled={busy} onClick={onAcknowledge} className="min-h-11 rounded-lg border border-base-300 px-3 py-2 font-medium disabled:opacity-50">I checked LinkedIn</button></div>}
  {operation.status==="failed"&&operation.text&&!operation.details_removed&&onRestore&&<button type="button" disabled={busy||!canRestore} onClick={onRestore} className="mt-2 min-h-11 rounded-lg border border-base-300 px-3 py-2 font-medium disabled:opacity-50">Use failed reply</button>}
  {operation.status==="preparing"&&operation.can_dispatch&&<button type="button" disabled={busy||!canSend} onClick={onSavedSend} className="mt-2 min-h-11 rounded-lg border border-base-300 px-3 py-2 font-medium disabled:opacity-50">Send saved reply</button>}
 </div>;
}
type Mode="new"|"same"|"saved"|"status"|"ack";
function recent(operations:PublicReply[],local:PublicReply|null):PublicReply[] {
 const values=[...operations];const rank={preparing:0,sending:1,failed:2,unknown:3,sent:4};
 if(local){
  const at=values.findIndex(op=>op.id===local.id);
  if(at<0)values.push(local);
  else if(local.updated_at_ms>values[at].updated_at_ms||local.updated_at_ms===values[at].updated_at_ms&&rank[local.status]>rank[values[at].status])values[at]=local;
 }
 const active=(op:PublicReply)=>Number(op.status==="preparing"||op.status==="sending"||op.status==="unknown"&&!op.acknowledged_at_ms);
 return values.sort((a,b)=>active(b)-active(a)||b.created_at_ms-a.created_at_ms||b.updated_at_ms-a.updated_at_ms);
}
export function replyActivityText(mode:Mode|null,error:string,operation:PublicReply|null|undefined):string {
 if(mode==="status")return "Checking saved reply status…";
 if(mode==="ack")return "Recording your LinkedIn check…";
 if(mode)return "Verifying and sending this reply…";
 if(error)return error;
 if(!operation)return "";
 return operation.status==="unknown"?"Reply delivery is unconfirmed.":operation.status==="sent"?"Reply sent.":operation.status==="sending"?"Reply sending…":operation.status==="failed"?"Reply was not sent; restore its text to retry.":"Reply saved; check its status.";
}
export function ReplySendHistory({operations,busy,canSend,canRestore,onAcknowledge,onSavedSend,onRestore}:{operations:PublicReply[];busy:boolean;canSend:boolean;canRestore:boolean;onAcknowledge:(op:PublicReply)=>void;onSavedSend:(op:PublicReply)=>void;onRestore:(op:PublicReply)=>void}){
 const render=(op:PublicReply)=><ReplySendStatus key={op.id} operation={op} busy={busy} canSend={canSend} canRestore={canRestore} onAcknowledge={()=>onAcknowledge(op)} onSavedSend={()=>onSavedSend(op)} onRestore={()=>onRestore(op)}/>;
 if(!operations.length)return null;
 return <div className="space-y-2">{render(operations[0])}{operations.length>1&&<details className="rounded-lg border border-base-300 p-3"><summary className="cursor-pointer text-xs font-medium">Recent replies ({operations.length-1})</summary><div className="mt-3 max-h-48 space-y-2 overflow-y-auto">{operations.slice(1).map(render)}</div></details>}</div>;
}
export default function LinkedInReplyComposer({conversationId,sender,capability,operations,drafts,getSignal,onChanged}:{conversationId:string;sender:string;capability:ReplyCapability;operations:PublicReply[];drafts:ReplyDraftRegistry;getSignal:()=>AbortSignal|null;onChanged:()=>void}){
 const draft=useSyncExternalStore(notify=>drafts.subscribe(notify),()=>drafts.get(conversationId),()=>drafts.get(conversationId));
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[local,setLocal]=useState<PublicReply|null>(null),[missing,setMissing]=useState(false);const busyRef=useRef(false);
 const history=recent(operations,local),operation=history[0];
 const [mode,setMode]=useState<Mode|null>(null);
 const blocked=capability.code!==null&&capability.code!=="conversation_busy";
 const unresolved=!!draft.requestId||!!operation&&(operation.status==="preparing"||operation.status==="sending"||operation.status==="unknown"&&!operation.acknowledged_at_ms);
 async function perform(mode:Mode,selected:PublicReply|undefined=operation){
  const signal=getSignal();if(!signal||signal.aborted||busyRef.current)return;
  if((mode==="new"||mode==="same"||mode==="saved")&&blocked)return;
  busyRef.current=true;setBusy(true);setMode(mode);setError("");setMissing(false);
  let attemptId:string|undefined;
  try{
   let result:PublicReply;
   if(mode==="ack"){
    if(!selected)return;result=await acknowledgeUnknownReply(selected.id,signal);
    // Only the acknowledged operation's draft may be discarded.
    if(drafts.get(conversationId).requestId===result.id)drafts.set(conversationId,{text:""});
   }else if(mode==="status"){
    const id=drafts.get(conversationId).requestId??operation?.id;if(!id)return;result=await getReplyStatus(id,signal);
   }else if(mode==="saved"){
    if(!selected?.can_dispatch||!selected.text)return;
    attemptId=selected.id;drafts.set(conversationId,{text:selected.text,requestId:selected.id});result=await dispatchSavedReply(selected.id,signal);
   }else{
    const current=drafts.get(conversationId);if(!current.text.trim()||current.text.length>3000)return;
    const id=mode==="same"?current.requestId:crypto.randomUUID();if(!id)return;
    attemptId=id;drafts.set(conversationId,{text:current.text,requestId:id});result=await reserveAndDispatchReply({conversationId,requestId:id,text:current.text},signal);
   }
   if(signal.aborted)return;
   if(result.conversation_id!==null&&result.conversation_id!==conversationId)throw new Error("Reply response belongs to another conversation.");
   drafts.apply(conversationId,result);setLocal(result);onChanged();
  }catch(reason){
   if(signal.aborted)return;
   if(attemptId)drafts.rejectReservation(conversationId,attemptId,reason);
   setError(reason instanceof Error?reason.message:"Reply status could not be checked.");
   if(reason instanceof ReplyClientError&&reason.phase==="status"&&reason.status===404)setMissing(true);
   onChanged();
  }finally{busyRef.current=false;if(!signal.aborted){setBusy(false);setMode(null)}}
 }
 return <div className="space-y-3 border-t border-base-300 p-5">
  <LinkedInReplyComposerView sender={sender} text={draft.text} disabled={blocked||unresolved} busy={busy} busyLabel={mode==="status"?"Checking…":mode==="ack"?"Saving check…":"Sending…"} error={error||capability.reason||""} onText={text=>drafts.set(conversationId,{text})} onSend={()=>void perform("new")}/>
  <div role="status" aria-live="polite" aria-atomic="true" className="text-xs text-muted">{replyActivityText(busy?mode:null,error,operation)}</div>
  {draft.requestId&&(!operation||operation.id!==draft.requestId)&&<div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={()=>void perform("status")} className="min-h-11 rounded-lg border border-base-300 px-3 py-2 text-xs">Check saved request</button>{missing&&<button type="button" disabled={busy||blocked} onClick={()=>void perform("same")} className="min-h-11 rounded-lg border border-base-300 px-3 py-2 text-xs">Retry and send same reply</button>}</div>}
  <ReplySendHistory operations={history} busy={busy} canSend={!blocked} canRestore={!unresolved} onAcknowledge={op=>void perform("ack",op)} onSavedSend={op=>void perform("saved",op)} onRestore={op=>{if(!busyRef.current&&!unresolved&&op.text){drafts.set(conversationId,{text:op.text});setError("");}}}/>
 </div>;
}
