import {messageIdentityMatches} from "./reply-identity.ts";
import {randomBytes} from "node:crypto";
import {createLinkedInProvider,ProviderError} from "./provider.ts";
import type {ReadTransport} from "./provider.ts";
import {profileKey} from "./store.ts";
import type {ReplyProvider,ReplyInput,ReplyAck} from "./reply-types.ts";
export type WriteTransport=(path:string,options:{body:string;headers:Record<string,string>},beforeWrite:()=>void)=>Promise<{status:number;json:unknown;retryAfterMs?:number}>;
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
function acknowledgment(json:unknown,input:ReplyInput):ReplyAck {
 const envelope=object(json),value=object(envelope.value);const urn=value.entityUrn??value.backendUrn,at=value.deliveredAt;
 if(typeof urn!=="string"||!messageIdentityMatches(urn,input.mailboxUrn,input.conversationUrn)||typeof at!=="number"||!Number.isSafeInteger(at)||at<=0||at>8640000000000000)throw new ProviderError("unsupported","Unsupported message acknowledgment");
 for(const row of [envelope,value,object(envelope.data),object(value.data),object(value.message)]){
  if(row.errors!==undefined&&(!Array.isArray(row.errors)||row.errors.length>0)||row.error!==undefined&&row.error!==null)throw new ProviderError("unsupported","Error-bearing message acknowledgment");
  if(row.entityUrn!==undefined&&row.backendUrn!==undefined&&row.entityUrn!==row.backendUrn)throw new ProviderError("unsupported","Contradictory message identities");
  if(row.conversation!==undefined&&object(row.conversation).entityUrn!==input.conversationUrn)throw new ProviderError("unsupported","Contradictory conversation acknowledgment");
  const ownerKey=profileKey(input.mailboxUrn);
  const ownerMatches=(candidate:unknown)=>typeof candidate==="string"&&profileKey(candidate.match(/urn:li:(?:fsd_profile|fs_miniProfile|member):[^():,]+$/)?.[0])===ownerKey;
  for(const field of ["senderUrn","ownerUrn","hostIdentityUrn"])if(row[field]!==undefined&&!ownerMatches(row[field]))throw new ProviderError("unsupported","Contradictory sender acknowledgment");
  if(row.sender!==undefined){const sender=typeof row.sender==="string"?row.sender:object(row.sender).hostIdentityUrn??object(row.sender).entityUrn;if(!ownerMatches(sender))throw new ProviderError("unsupported","Contradictory sender acknowledgment");}
  if(row.conversationUrn!==undefined&&row.conversationUrn!==input.conversationUrn)throw new ProviderError("unsupported","Contradictory conversation acknowledgment");
  if(row.mailboxUrn!==undefined&&(typeof row.mailboxUrn!=="string"||profileKey(row.mailboxUrn)!==profileKey(input.mailboxUrn)))throw new ProviderError("unsupported","Contradictory mailbox acknowledgment");
  if(row.originToken!==undefined&&row.originToken!==input.originToken)throw new ProviderError("unsupported","Contradictory operation acknowledgment");
 }
 return {messageUrn:urn,deliveredAt:at};
}
export function createReplyProvider(read:ReadTransport,write:WriteTransport,queryId?:string):ReplyProvider {
 const reader=createLinkedInProvider(read,queryId);
 return {identity:reader.identity,list:reader.list,async send(input,beforeWrite){
  const body=JSON.stringify({message:{body:{text:input.text,attributes:[]},renderContentUnions:[],conversationUrn:input.conversationUrn,originToken:input.originToken},mailboxUrn:input.mailboxUrn,trackingId:randomBytes(11).toString("base64"),dedupeByClientGeneratedToken:false});
  const result=await write("/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage",{body,headers:{"Content-Type":"text/plain;charset=UTF-8"}},beforeWrite);
  if(result.status===429)throw new ProviderError("rate_limit","LinkedIn requested a pause",429,result.retryAfterMs);
  if(result.status<200||result.status>=300)throw new ProviderError("delivery_unconfirmed","Message acknowledgment unavailable",result.status);
  return acknowledgment(result.json,input);
 }};
}
