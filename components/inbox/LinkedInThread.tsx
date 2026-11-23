import { useEffect, useRef, useState } from "react";
import { RiCloseLine, RiExternalLinkLine, RiLinkedinBoxLine } from "react-icons/ri";
import type { StoredConversation, StoredMessage } from "@/lib/linkedin/inbox/store";
import { linkedInConversationUrl } from "@/lib/linkedin/inbox/presentation";

type Thread={conversation:StoredConversation;messages:StoredMessage[]};
export function LinkedInThreadContent({thread,onClose}:{thread:Thread;onClose?:()=>void}) {
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
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-base-300 p-5"><p className="text-xs text-muted">Campaign conversations · checked periodically</p>{url&&<a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-content">Reply on LinkedIn <RiExternalLinkLine aria-hidden="true"/></a>}</div>
  </div>;
}
export default function LinkedInThread({id,onClose}:{id:string;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);const [thread,setThread]=useState<Thread|null>(null);const [error,setError]=useState("");
  useEffect(()=>{dialog.current?.showModal()},[]);
  useEffect(()=>{const controller=new AbortController();fetch(`/api/inbox/linkedin/thread?id=${encodeURIComponent(id)}`,{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not load conversation");setThread(data)}).catch(reason=>{if(reason.name!=="AbortError")setError(reason.message)});return()=>controller.abort()},[id]);
  return <dialog ref={dialog} className="ms-thread-dialog" aria-labelledby="linkedin-thread-title" onClose={onClose} onCancel={onClose}>
    {thread?<LinkedInThreadContent thread={thread} onClose={onClose}/>:<div className="p-6"><div className="flex items-center justify-between"><h2 id="linkedin-thread-title" className="text-lg font-semibold">LinkedIn conversation</h2><button type="button" className="ms-icon-button" onClick={onClose} aria-label="Close conversation"><RiCloseLine size={20}/></button></div><p role={error?"alert":"status"} className={`py-12 text-center text-sm ${error?"text-error":"text-muted"}`}>{error||"Loading stored conversation…"}</p></div>}
  </dialog>;
}
