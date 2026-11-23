import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getInboxAccounts } from "@/lib/linkedin/inbox/view";
import { getInboxStatus } from "@/lib/linkedin/inbox/sync";
import { syncAccountInbox } from "@/lib/linkedin/inbox/session-provider";
export default function handler(req:NextApiRequest,res:NextApiResponse) {
  const db=getDb();res.setHeader("Cache-Control","no-store");
  if(req.method==="GET")return res.json({accounts:getInboxAccounts(db)});
  if(req.method!=="POST"){res.setHeader("Allow",["GET","POST"]);return res.status(405).end()}
  const id=req.body?.accountId;
  if(typeof id!=="string"||!id)return res.status(400).json({error:"LinkedIn account ID required"});
  if(!db.prepare("SELECT id FROM accounts WHERE id=?").get(id))return res.status(404).json({error:"Account not found"});
  const state=getInboxStatus(db,id);
  if(state.last_error_code==="rate_limit"&&state.retry_at_ms&&state.retry_at_ms>Date.now()){
    res.setHeader("Retry-After",String(Math.ceil((state.retry_at_ms-Date.now())/1000)));
    return res.status(429).json({error:"LinkedIn requested a pause. Please wait before retrying.",retryAt:state.retry_at_ms});
  }
  // The core claims its account lease synchronously before the first network await.
  // Return promptly; the persisted status is the source of truth for completion.
  void syncAccountInbox(db,id,{force:true}).catch(()=>console.warn("[linkedin-inbox] Requested sync could not finish"));
  return res.status(202).json({status:"requested"});
}
