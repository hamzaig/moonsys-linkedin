import type {NextApiRequest,NextApiResponse} from "next";
import {getDb} from "@/lib/db";
import {reserveReply,getReply,acknowledgeReply,publicReply} from "@/lib/linkedin/inbox/reply-store";
import {dispatchReply} from "@/lib/linkedin/inbox/reply-service";
import {createSessionReplyProvider} from "@/lib/linkedin/inbox/reply-session";
import {authorizeReplyRequest,parseReplyAction} from "@/lib/linkedin/inbox/reply-http";
import {ReplyError,validRequestId} from "@/lib/linkedin/inbox/reply-types";
export const config={api:{bodyParser:{sizeLimit:"16kb"}}};
export const maxDuration=60;
export default async function handler(req:NextApiRequest,res:NextApiResponse) {
 res.setHeader("Cache-Control","no-store");
 try{
  if(req.method!=="GET"&&req.method!=="POST"){res.setHeader("Allow",["GET","POST"]);return res.status(405).end()}
  await authorizeReplyRequest(req);const db=getDb();
  if(req.method==="GET"){
   if(!validRequestId(req.query.id))throw new ReplyError(400,"invalid","A reply request ID is required.");
   const op=getReply(db,req.query.id);if(!op)throw new ReplyError(404,"not_found","Reply request not found.");return res.json({operation:publicReply(op)});
  }
  const action=parseReplyAction(req.body);
  let op;
  switch(action.action){
   case "reserve":op=reserveReply(db,action);break;
   case "acknowledge":op=acknowledgeReply(db,action.requestId);break;
   case "dispatch":op=await dispatchReply(db,action.requestId,createSessionReplyProvider);break;
   default:throw new ReplyError(400,"invalid","Invalid reply action.");
  }
  return res.json({operation:publicReply(op)});
 }catch(error){
  if(error instanceof ReplyError)return res.status(error.status).json({error:error.message,code:error.code});
  return res.status(500).json({error:"Reply status could not be saved. Check the saved request before trying again.",code:"persistence"});
 }
}
