import {getSessionContext} from "@/lib/linkedin/session";
import {createReplyProvider} from "./reply-provider";
import {ProviderError} from "./provider";
import {readLinkedInResponse} from "./transport";
import type {ReplyProvider} from "./reply-types";

export async function createSessionReplyProvider(accountId:string,deadlineAt:number):Promise<ReplyProvider> {
 // Capture once: reconnecting must not silently swap the mailbox after verification.
 const context=await getSessionContext(accountId);
 const headers=async()=>{
  const cookies=await context.cookies("https://www.linkedin.com");const csrf=(cookies.find(cookie=>cookie.name==="JSESSIONID")?.value??"").replaceAll('"',"");
  if(!csrf)throw new ProviderError("auth","Reconnect LinkedIn");
  return {"csrf-token":csrf,accept:"application/vnd.linkedin.normalized+json+2.1","x-restli-protocol-version":"2.0.0","x-li-lang":"en_US"};
 };
 const urlFor=(path:string)=>{const url=new URL(path,"https://www.linkedin.com");if(url.origin!=="https://www.linkedin.com"||!path.startsWith("/voyager/api/"))throw new ProviderError("unsupported","Invalid provider path");return url};
 return createReplyProvider(async path=>{
  const url=urlFor(path);
  for(let attempt=0;attempt<2;attempt++){
   const remaining=deadlineAt-Date.now();if(remaining<=0)throw new ProviderError("timeout","Reply verification timed out");
   const response=await context.request.get(url.href,{timeout:Math.min(20000,remaining),maxRedirects:0,maxRetries:0,headers:await headers()});
   const location=response.headers().location;
   if(attempt===0&&location&&[301,302,307,308].includes(response.status())){
    const redirect=new URL(location,url);if(redirect.origin===url.origin&&redirect.pathname===url.pathname&&redirect.search===url.search){await response.dispose();continue;}
   }
   return readLinkedInResponse(response);
  }
  throw new ProviderError("auth","Reconnect LinkedIn");
 },async(path,options,beforeWrite)=>{
  const url=urlFor(path);const requestHeaders={...await headers(),...options.headers};
  beforeWrite();
  // One POST only. A redirect, lost response or malformed success is never replayed.
  const response=await context.request.post(url.href,{data:options.body,headers:requestHeaders,timeout:20000,maxRedirects:0,maxRetries:0});
  return readLinkedInResponse(response);
 },process.env.LINKEDIN_CONVERSATIONS_QUERY_ID||undefined);
}
