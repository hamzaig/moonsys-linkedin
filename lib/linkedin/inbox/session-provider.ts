import type Database from "better-sqlite3";
import { getSessionContext, saveSessionState } from "@/lib/linkedin/session";
import { createLinkedInProvider, ProviderError } from "./provider";
import { syncLinkedInInbox } from "./sync";

export async function syncAccountInbox(db:Database.Database,accountId:string,options:{force?:boolean}={}) {
  const account=db.prepare("SELECT is_authenticated FROM accounts WHERE id=?").get(accountId) as {is_authenticated:number}|undefined;
  if(!account)throw new Error("Account not found");
  const provider=createLinkedInProvider(async path=>{
    if(!account.is_authenticated)throw new ProviderError("auth","Reconnect LinkedIn");
    const context=await getSessionContext(accountId);
    const url=new URL(path,"https://www.linkedin.com");
    if(url.origin!=="https://www.linkedin.com")throw new ProviderError("unsupported","Invalid provider origin");
    // API requests only: no page navigation, clicking, mark-read calls or sends.
    for(let attempt=0;attempt<2;attempt++){
      const cookies=await context.cookies("https://www.linkedin.com");
      const csrf=(cookies.find(cookie=>cookie.name==="JSESSIONID")?.value??"").replaceAll('"',"");
      if(!csrf)throw new ProviderError("auth","Reconnect LinkedIn");
      let response;
      try{response=await context.request.get(url.href,{timeout:20000,maxRedirects:0,headers:{"csrf-token":csrf,accept:"application/vnd.linkedin.normalized+json+2.1","x-restli-protocol-version":"2.0.0","x-li-lang":"en_US"}})}catch{throw new ProviderError("timeout","LinkedIn read timed out")}
      const headers=response.headers();const location=headers.location;
      if(attempt===0&&[301,302,307,308].includes(response.status())&&location){
        const redirect=new URL(location,url);if(redirect.origin===url.origin&&redirect.pathname===url.pathname&&redirect.search===url.search){await response.dispose();continue;}
      }
      const retryValue=headers["retry-after"];const retryAfterMs=retryValue?(/^[\d.]+$/.test(retryValue)?Number(retryValue)*1000:Math.max(0,Date.parse(retryValue)-Date.now())):undefined;
      let json:unknown=null;
      try{if(headers["content-type"]?.includes("json")){const body=await response.body();if(body.length>5000000)throw new ProviderError("unsupported","LinkedIn response too large");json=JSON.parse(body.toString("utf8"));}}finally{await response.dispose()}
      return {status:response.status(),json,retryAfterMs};
    }
    throw new ProviderError("auth","Reconnect LinkedIn");
  },process.env.LINKEDIN_CONVERSATIONS_QUERY_ID||undefined);
  const result=await syncLinkedInInbox(db,accountId,provider,Date.now,options);
  if(result.status==="ok"||result.status==="partial")try{await saveSessionState(accountId)}catch{/* Sync results remain valid if session persistence needs retry. */}
  return result;
}
