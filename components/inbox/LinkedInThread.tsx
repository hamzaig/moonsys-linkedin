import LinkedInReplyComposer from "./LinkedInReplyComposer";
import { ReplyDraftRegistry,getReplyThread,invalidateReplyThread } from "@/lib/inbox/reply-client";
import type { PublicReply,ReplyCapability } from "@/lib/linkedin/inbox/reply-types";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RiCloseLine, RiExternalLinkLine, RiLinkedinBoxLine } from "react-icons/ri";
import type { StoredConversation, StoredMessage } from "@/lib/linkedin/inbox/store";
import { linkedInConversationUrl } from "@/lib/linkedin/inbox/presentation";

type Thread={conversation:StoredConversation;messages:StoredMessage[];replyCapability:ReplyCapability;replySends:PublicReply[]};
export function LinkedInThreadContent({thread,onClose,composer}:{thread:Thread;onClose?:()=>void;composer?:ReactNode}) {
  const {conversation,messages}=thread;const url=linkedInConversationUrl(conversation.provider_urn);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-start justify-between gap-4 border-b border-base-300 p-5">
      <div><p className="mb-1 flex items-center gap-1.5 text-xs text-muted"><RiLinkedinBoxLine aria-hidden="true"/>LinkedIn · {conversation.account_name}</p><h2 id="linkedin-thread-title" className="text-lg font-semibold">{conversation.full_name??"Campaign conversation"}</h2>
        {conversation.last_incoming_at_ms!==null&&<p className="mt-1 text-xs text-success">Incoming reply saved</p>}
      </div>{onClose&&<button type="button" className="ms-icon-button" onClick={onClose} aria-label="Close conversation"><RiCloseLine size={20}/></button>}
    </div>
    <div className="flex-1 space-y-4 overflow-y-auto p-5">
      {messages.length===0?<p className="py-8 text-center text-sm text-muted">No campaign-period messages stored yet.</p>:messages.map(message=><article key={message.id} className={`rounded-xl border p-4 ${message.direction==="in"?"border-base-300 bg-base-200":"ml-5 border-primary/20 bg-primary/5"}`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{message.direction==="in"?conversation.full_name??"Contact":"You"}</span><time dateTime={new Date(message.delivered_at_ms).toISOString()}>{new Date(message.delivered_at_ms).toLocaleString()}</time></div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text||"[Unsupported LinkedIn content]"}</p>
      </article>)}
    </div>
    {composer}
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-base-300 p-5"><p className="text-xs text-muted">Campaign conversations · checked periodically</p>{url&&<a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-content">Reply on LinkedIn <RiExternalLinkLine aria-hidden="true"/></a>}</div>
  </div>;
}
export default function LinkedInThread({id,onClose,drafts}:{id:string;onClose:()=>void;drafts:ReplyDraftRegistry}) {
  const dialog=useRef<HTMLDialogElement>(null),request=useRef<AbortController|null>(null),lifecycle=useRef<AbortController|null>(null);
  const [thread,setThread]=useState<Thread|null>(null),[error,setError]=useState("");
  const load=useCallback(async()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;
    try{
      const data=await getReplyThread<Thread>(id,controller.signal);
      if(controller.signal.aborted)return;
      for(const operation of data.replySends??[])drafts.apply(id,operation);
      setThread(data);setError("");
    }catch(reason){
      if(controller.signal.aborted)return;
      if(invalidateReplyThread(drafts,id,reason)){lifecycle.current?.abort();lifecycle.current=new AbortController();setThread(null);}
      setError(reason instanceof Error?reason.message:"Could not load conversation");
    }
  },[id,drafts]);
  useEffect(()=>{
    const controller=new AbortController();lifecycle.current=controller;dialog.current?.showModal();queueMicrotask(()=>{if(!controller.signal.aborted)void load()});
    return()=>{controller.abort();request.current?.abort()};
  },[load]);
  const active=thread?.replySends.some(op=>op.status==="preparing"||op.status==="sending");
  useEffect(()=>{const timer=setInterval(()=>void load(),active?2000:15000);return()=>clearInterval(timer)},[load,active]);
  const close=()=>{lifecycle.current?.abort();request.current?.abort();onClose()};
  return <dialog ref={dialog} className="ms-thread-dialog" aria-labelledby="linkedin-thread-title" onClose={close} onCancel={close}>
    {thread?<><LinkedInThreadContent thread={thread} onClose={close} composer={<LinkedInReplyComposer conversationId={id} sender={thread.conversation.account_name} capability={thread.replyCapability} operations={thread.replySends} drafts={drafts} getSignal={()=>lifecycle.current?.signal??null} onChanged={()=>void load()}/>}/>{error&&<p role="alert" className="px-5 pb-3 text-xs text-error">{error}</p>}</>:<div className="p-6"><div className="flex items-center justify-between"><h2 id="linkedin-thread-title" className="text-lg font-semibold">LinkedIn conversation</h2><button type="button" className="ms-icon-button" onClick={close} aria-label="Close conversation"><RiCloseLine size={20}/></button></div><p role={error?"alert":"status"} className={`py-12 text-center text-sm ${error?"text-error":"text-muted"}`}>{error||"Loading stored conversation…"}</p></div>}
  </dialog>;
}
