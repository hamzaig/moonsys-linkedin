import type { InboxReply } from "./types";
type Slot={current:AbortController|null};
type Callbacks={onData:(rows:InboxReply[])=>void;onError:()=>void;onSettled:()=>void};
export async function loadInboxReplies(url:string,slot:Slot,callbacks:Callbacks,fetcher:typeof fetch=fetch) {
  slot.current?.abort();const controller=new AbortController();slot.current=controller;
  const current=()=>slot.current===controller&&!controller.signal.aborted;
  try {
    const response=await fetcher(url,{signal:controller.signal});
    if(!response.ok)throw new Error("Could not load Inbox");
    const data=await response.json();if(current())callbacks.onData(data.replies??[]);
  }catch{if(current())callbacks.onError()}
  finally{if(current())callbacks.onSettled()}
}
