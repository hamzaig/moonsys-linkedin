import type Database from "better-sqlite3";
import { profileKey,matchCampaignContact } from "./store.ts";
import type { Participant } from "./store.ts";
import { ProviderError } from "./provider.ts";
import { claimReply,getReply,getReplyBinding,markReplySending,finishReply,failReply } from "./reply-store.ts";
import { ReplyError } from "./reply-types.ts";
import type { ReplyProviderFactory,ReplyOperation,ReplyProvider } from "./reply-types.ts";

async function bounded<T>(action:()=>Promise<T>,deadline:number,clock:()=>number):Promise<T> {
 const remaining=deadline-clock();if(remaining<=0)throw new ProviderError("timeout","Reply verification timed out");
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const value=await Promise.race([action(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ProviderError("timeout","Reply verification timed out")),remaining)})]);
  if(clock()>deadline)throw new ProviderError("timeout","Reply verification timed out");return value;
 }finally{if(timer)clearTimeout(timer)}
}
async function verify(db:Database.Database,op:ReplyOperation,provider:ReplyProvider,deadline:number,clock:()=>number):Promise<Participant> {
 const self=await bounded(()=>provider.identity(),deadline,clock);
 if(profileKey(self.urn)!==profileKey(op.expected_self_urn))throw new ReplyError(409,"identity","The LinkedIn owner changed.");
 const seen=new Set<string>();let cursor:string|null=null;
 for(let pageIndex=0;pageIndex<5;pageIndex++){
  const page=await bounded(()=>provider.list(cursor),deadline,clock);
  const exact=page.conversations.filter(row=>row.urn===op.expected_conversation_urn);
  if(exact.length>1)throw new ReplyError(409,"identity","Conversation metadata is contradictory.");
  const thread=exact[0];
  if(thread){
   if(thread.isGroup||thread.oneToOneVerified!==true||thread.participants.length!==2)throw new ReplyError(409,"identity","The conversation is no longer one-to-one.");
   const owners=thread.participants.filter(person=>profileKey(person.urn)===profileKey(self.urn));
   const peers=thread.participants.filter(person=>profileKey(person.urn)!==profileKey(self.urn));
   if(owners.length!==1||peers.length!==1||profileKey(peers[0].urn)!==profileKey(op.expected_peer_urn))throw new ReplyError(409,"identity","The conversation participants changed.");
   if(!matchCampaignContact(db,op.account_id!,peers[0]).some(row=>row.target_id===op.expected_target_id))throw new ReplyError(409,"identity","The target could not be verified.");
   return peers[0];
  }
  if(!page.nextCursor)break;
  if(seen.has(page.nextCursor))throw new ProviderError("unsupported","Conversation pagination did not advance");
  seen.add(page.nextCursor);cursor=page.nextCursor;
 }
 throw new ReplyError(409,"identity","Conversation could not be verified; open it on LinkedIn.");
}
export async function dispatchReply(db:Database.Database,id:string,factory:ReplyProviderFactory,clock=Date.now):Promise<ReplyOperation> {
 const claim=claimReply(db,id,clock());if(!claim.claimed)return claim.operation;
 const op=claim.operation,token=claim.token!;let marked=false;
 try {
  const deadline=clock()+30000;
  const provider=await bounded(()=>factory(op.account_id!,deadline),deadline,clock);
  const peer=await verify(db,op,provider,deadline,clock);
  // The captured session remains the same through verification and delivery.
  // Transport invokes this synchronous fence after cookie preparation, at its POST boundary.
  const ack=await provider.send({conversationUrn:op.expected_conversation_urn!,mailboxUrn:op.expected_self_urn!,text:op.text!,originToken:op.id},()=>{
   if(marked)throw new ReplyError(409,"duplicate","This operation already dispatched.");
   if(clock()>deadline)throw new ProviderError("timeout","Reply verification timed out");
   const current=getReplyBinding(db,op.conversation_id!);
   if(!current)throw new ReplyError(404,"deleted","Conversation was removed.");
   markReplySending(db,id,token,peer,clock());marked=true;
  });
  if(!marked)throw new ProviderError("unsupported","Delivery adapter omitted its dispatch fence");
  finishReply(db,id,token,ack,clock());
 }catch(error){
  const code=error instanceof ReplyError||error instanceof ProviderError?error.code:"network";
  try{failReply(db,id,token,code,clock(),error instanceof ProviderError?error.retryAfterMs:undefined,op.account_id??undefined)}catch{/* A committed sending marker stays non-replayable when persistence fails. */}
 }
 const result=getReply(db,id,clock());if(!result)throw new ReplyError(404,"not_found","Reply request not found.");return result;
}
