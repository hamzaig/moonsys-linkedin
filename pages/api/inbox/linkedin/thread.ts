import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { getStoredThread } from "@/lib/linkedin/inbox/store";
export default function handler(req:NextApiRequest,res:NextApiResponse) {
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).end()}
  if(typeof req.query.id!=="string"||!req.query.id)return res.status(400).json({error:"Conversation ID required"});
  const thread=getStoredThread(getDb(),req.query.id);
  if(!thread)return res.status(404).json({error:"Conversation not found"});
  res.setHeader("Cache-Control","no-store");return res.json(thread);
}
