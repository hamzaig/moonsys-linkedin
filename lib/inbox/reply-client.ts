import type {PublicReply} from "../linkedin/inbox/reply-types.ts";
export interface ReplyIntent {requestId:string;conversationId:string;text:string}
export interface ReplyDraft {text:string;requestId?:string}
type Phase="reserve"|"dispatch"|"status"|"acknowledge"|"thread";
export class ReplyClientError extends Error {
 phase:Phase;status:number;code:string;
 constructor(message:string,phase:Phase,status=0,code="network"){super(message);this.name="ReplyClientError";this.phase=phase;this.status=status;this.code=code}
}
function active(signal:AbortSignal):void {if(signal.aborted)throw new DOMException("Reply request aborted","AbortError")}
async function request(id:string,phase:Phase,signal:AbortSignal,fetcher:typeof fetch,body?:object):Promise<PublicReply> {
 active(signal);
 try{
  const response=await fetcher(phase==="status"?`/api/inbox/linkedin/reply?id=${encodeURIComponent(id)}`:"/api/inbox/linkedin/reply",{method:phase==="status"?"GET":"POST",headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined,signal,cache:"no-store"});
  const data=await response.json();active(signal);
  if(!response.ok)throw new ReplyClientError(typeof data.error==="string"?data.error:"Reply request could not be checked.",phase,response.status,typeof data.code==="string"?data.code:"request");
  const op=data.operation as PublicReply|undefined;
  if(!op||op.id!==id||!["preparing","sending","sent","failed","unknown"].includes(op.status))throw new ReplyClientError("The saved reply response could not be verified. Check its status.",phase);
  return op;
 }catch(error){if(signal.aborted)active(signal);if(error instanceof ReplyClientError)throw error;throw new ReplyClientError("Connection interrupted. Check this saved request before another reply.",phase)}
}
export async function reserveAndDispatchReply(intent:ReplyIntent,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<PublicReply> {
 const reserved=await request(intent.requestId,"reserve",signal,fetcher,{action:"reserve",...intent});
 if(reserved.conversation_id!==intent.conversationId&&!reserved.details_removed)throw new ReplyClientError("The saved conversation does not match this reply.","reserve");
 if(reserved.text!==intent.text&&!reserved.details_removed)throw new ReplyClientError("The saved text does not match this reply.","reserve");
 active(signal);return reserved.status==="preparing"&&reserved.can_dispatch?dispatchSavedReply(intent.requestId,signal,fetcher):reserved;
}
export const dispatchSavedReply=(id:string,signal:AbortSignal,fetcher:typeof fetch=fetch)=>request(id,"dispatch",signal,fetcher,{action:"dispatch",requestId:id});
export const getReplyStatus=(id:string,signal:AbortSignal,fetcher:typeof fetch=fetch)=>request(id,"status",signal,fetcher);
export const acknowledgeUnknownReply=(id:string,signal:AbortSignal,fetcher:typeof fetch=fetch)=>request(id,"acknowledge",signal,fetcher,{action:"acknowledge",requestId:id});
export async function getReplyThread<T>(id:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<T> {
 active(signal);
 try{
  const response=await fetcher(`/api/inbox/linkedin/thread?id=${encodeURIComponent(id)}`,{signal,cache:"no-store"});const data=await response.json();active(signal);
  if(!response.ok)throw new ReplyClientError(typeof data.error==="string"?data.error:"Conversation could not be loaded.","thread",response.status);
  if(data.conversation?.id!==id)throw new ReplyClientError("The conversation response could not be verified.","thread");
  return data as T;
 }catch(error){if(signal.aborted)active(signal);if(error instanceof ReplyClientError)throw error;throw new ReplyClientError("Conversation refresh was interrupted.","thread")}
}
export function invalidateReplyThread(drafts:ReplyDraftRegistry,id:string,error:unknown):boolean {
 if(!(error instanceof ReplyClientError)||error.phase!=="thread"||![401,403,404].includes(error.status))return false;
 if(error.status===404)drafts.set(id,{text:""});else drafts.clear();return true;
}
const empty:ReplyDraft=Object.freeze({text:""});
export class ReplyDraftRegistry {
 private values=new Map<string,ReplyDraft>();private listeners=new Set<()=>void>();
 get(id:string):ReplyDraft{return this.values.get(id)??empty}
 set(id:string,value:ReplyDraft):void {const old=this.get(id);if(old.text===value.text&&old.requestId===value.requestId)return;this.values.set(id,{...value});for(const notify of this.listeners)notify()}
 clear():void {this.values.clear();for(const notify of this.listeners)notify()}
 rejectReservation(id:string,requestId:string,error:unknown):void {
  const draft=this.get(id);
  if(draft.requestId===requestId&&error instanceof ReplyClientError&&error.phase==="reserve"&&error.status>=400&&error.status<500)this.set(id,{text:draft.text});
 }
 subscribe(notify:()=>void):()=>void {this.listeners.add(notify);return()=>{this.listeners.delete(notify)}}
 apply(id:string,op:PublicReply):void {
  const draft=this.get(id);if(draft.requestId!==op.id||(op.conversation_id!==null&&op.conversation_id!==id))return;
  if(op.details_removed||op.status==="sent"||op.status==="unknown"&&op.acknowledged_at_ms!==null&&op.acknowledged_at_ms!==undefined)this.set(id,empty);
  else if(op.status==="failed")this.set(id,{text:draft.text});
 }
}
