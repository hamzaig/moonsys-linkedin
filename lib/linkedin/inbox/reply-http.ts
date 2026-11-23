import type {NextApiRequest} from "next";
import {getToken} from "next-auth/jwt";
import {timingSafeEqual} from "node:crypto";
import {ReplyError,validRequestId} from "./reply-types";
function internal(req:NextApiRequest):boolean {
 const expected=process.env.INTERNAL_API_SECRET,provided=req.headers["x-internal-secret"];
 if(!expected||typeof provided!=="string")return false;
 const a=Buffer.from(expected),b=Buffer.from(provided);return a.length===b.length&&timingSafeEqual(a,b);
}
export async function authorizeReplyRequest(req:NextApiRequest):Promise<void> {
 const trusted=internal(req);
 if(!trusted&&!await getToken({req,secret:process.env.NEXTAUTH_SECRET}))throw new ReplyError(401,"unauthenticated","Not authenticated");
 if(req.method!=="POST")return;
 if(typeof req.headers["content-type"]!=="string"||!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"]))throw new ReplyError(415,"media_type","JSON content type is required.");
 if(!trusted){
  const origin=req.headers.origin;let expected:string|null=null;
  try{expected=new URL(process.env.NEXTAUTH_URL??"").origin}catch{/* Missing trusted origin must not relax protection. */}
  if(typeof origin!=="string"||!expected||origin!==expected)throw new ReplyError(403,"origin","Request origin is not allowed.");
 }
}
export type ReplyAction={action:"reserve";requestId:string;conversationId:string;text:string}|{action:"dispatch"|"acknowledge";requestId:string};
export function parseReplyAction(value:unknown):ReplyAction {
 if(!value||typeof value!=="object"||Array.isArray(value))throw new ReplyError(400,"invalid","Invalid reply request.");
 const row=value as Record<string,unknown>;const allowed=row.action==="reserve"?["action","requestId","conversationId","text"]:["action","requestId"];
 if(typeof row.action!=="string"||!["reserve","dispatch","acknowledge"].includes(row.action)||!validRequestId(row.requestId)||Object.keys(row).some(key=>!allowed.includes(key)))throw new ReplyError(400,"invalid","Invalid reply request.");
 if(row.action==="reserve"&&(typeof row.conversationId!=="string"||typeof row.text!=="string"))throw new ReplyError(400,"invalid","Conversation and reply text are required.");
 return row as ReplyAction;
}
