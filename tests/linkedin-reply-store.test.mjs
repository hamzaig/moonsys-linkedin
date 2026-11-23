import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture,conversation,message,self,peer,timestamp } from './helpers/inbox-fixture.mjs';
import { ingestConversation } from '../lib/linkedin/inbox/store.ts';
import { initReplySchema,reserveReply,getReply,listReplySends,claimReply,markReplySending,finishReply,failReply,acknowledgeReply,replyCapability } from '../lib/linkedin/inbox/reply-store.ts';
const now=timestamp+3600000;
function setup(t){const db=fixture(t);initReplySchema(db);ingestConversation(db,'a',conversation([message()],{urn:`urn:li:msg_conversation:(${self.urn},thread-1)`}));db.prepare("INSERT INTO linkedin_inbox_sync(account_id,self_urn) VALUES('a',?)").run(self.urn);const id=db.prepare('SELECT id FROM linkedin_conversations').get().id;return {db,id};}
const reserve=(db,id,requestId=randomUUID(),text='Hello\n  preserved ')=>(reserveReply(db,{requestId,conversationId:id,text},now));
const ack={messageUrn:`urn:li:msg_message:(${self.urn},message-1)`,deliveredAt:now+1000};

test('reservation is durable and idempotent without claiming a write',t=>{
 const {db,id}=setup(t);const op=reserve(db,id);assert.equal(op.status,'preparing');assert.equal(op.text,'Hello\n  preserved ');assert.equal(op.attempt_token,null);
 assert.equal(reserve(db,id,op.id).id,op.id);assert.equal(listReplySends(db,id,now).length,1);
 assert.throws(()=>reserve(db,id,op.id,'different'),e=>e.status===409);assert.throws(()=>reserve(db,id,op.id,' '),e=>e.status===400);
});
test('strict body and UUID validation cannot create invalid operations',t=>{
 const {db,id}=setup(t);for(const input of [{requestId:'bad',text:'Hi'},{requestId:randomUUID(),text:' '.repeat(2)},{requestId:randomUUID(),text:'x'.repeat(3001)}])assert.throws(()=>reserveReply(db,{conversationId:id,...input},now),e=>e.status===400);
 assert.equal(listReplySends(db,id,now).length,0);
});
test('one active or unacknowledged unknown operation gates every tab on a conversation',t=>{
 const {db,id}=setup(t);const op=reserve(db,id);assert.throws(()=>reserve(db,id),e=>e.status===409);
 const claim=claimReply(db,op.id,now);markReplySending(db,op.id,claim.token,peer,now);failReply(db,op.id,claim.token,'network',now+1);
 assert.equal(getReply(db,op.id,now+1).status,'unknown');assert.throws(()=>reserve(db,id),e=>e.status===409);
 acknowledgeReply(db,op.id,now+2);assert.equal(reserve(db,id).status,'preparing');assert.equal(getReply(db,op.id,now+2).status,'unknown');
});
test('claim fences a single manual attempt and existing results never restart',t=>{
 const {db,id}=setup(t);const op=reserve(db,id);const one=claimReply(db,op.id,now);assert.equal(one.claimed,true);assert.equal(claimReply(db,op.id,now).claimed,false);
 assert.throws(()=>markReplySending(db,op.id,'wrong',peer,now));markReplySending(db,op.id,one.token,peer,now);
 finishReply(db,op.id,one.token,ack,now+1000);assert.equal(getReply(db,op.id,now+1000).status,'sent');assert.equal(claimReply(db,op.id,now+1001).claimed,false);
});
test('account serialization preserves an unattempted reservation for a later explicit dispatch',t=>{
 const {db,id}=setup(t);ingestConversation(db,'a',conversation([message('second')],{urn:`urn:li:msg_conversation:(${self.urn},thread-2)`}));const id2=db.prepare('SELECT id FROM linkedin_conversations WHERE id<>?').get(id).id;
 const one=reserve(db,id);const two=reserve(db,id2);const c=claimReply(db,one.id,now);assert.throws(()=>claimReply(db,two.id,now),e=>e.code==='account_busy');assert.equal(getReply(db,two.id,now).attempt_token,null);
 failReply(db,one.id,c.token,'auth',now+1);assert.equal(claimReply(db,two.id,now+1).claimed,true);
});
test('reservation/preflight expiry fails safely and dispatched expiry becomes unknown',t=>{
 const {db,id}=setup(t);const first=reserve(db,id);assert.equal(getReply(db,first.id,now+120000).status,'failed');assert.equal(claimReply(db,first.id,now+120001).claimed,false);
 const next=reserveReply(db,{requestId:randomUUID(),conversationId:id,text:'Next'},now+120002);const c=claimReply(db,next.id,now+120002);markReplySending(db,next.id,c.token,peer,now+120002);
 assert.equal(getReply(db,next.id,now+240002).status,'unknown');finishReply(db,next.id,c.token,ack,now+240003);assert.equal(getReply(db,next.id,now+240003).status,'sent');
});
test('final local binding/auth/backoff check can prevent a write after preparation',t=>{
 const {db,id}=setup(t);const op=reserve(db,id);const c=claimReply(db,op.id,now);db.exec("UPDATE accounts SET is_authenticated=0 WHERE id='a'");assert.throws(()=>markReplySending(db,op.id,c.token,peer,now),e=>e.code==='auth');assert.equal(getReply(db,op.id,now).status,'preparing');
 assert.equal(replyCapability(db,id,now).can_reply,false);
});
test('finite manual backoff cannot be bypassed and does not alter reader state',t=>{
 const {db,id}=setup(t);const op=reserve(db,id);const c=claimReply(db,op.id,now);failReply(db,op.id,c.token,'rate_limit',now,NaN);
 assert.equal(getReply(db,op.id,now).status,'failed');assert.equal(replyCapability(db,id,now).code,'rate_limit');assert.equal(db.prepare("SELECT status FROM linkedin_inbox_sync WHERE account_id='a'").get().status,'never');
});
test('account and target deletion purge private fields while retaining replay-safe operation IDs',t=>{
 for(const table of ['accounts','targets']){const {db,id}=setup(t);const op=reserve(db,id);const c=claimReply(db,op.id,now);markReplySending(db,op.id,c.token,peer,now);
 if(table==='accounts')db.exec("DELETE FROM runs WHERE account_id='a'");
 db.prepare(`DELETE FROM ${table} WHERE id=?`).run(table==='accounts'?'a':'lead');const removed=getReply(db,op.id,now);assert.equal(removed.status,'unknown');assert.equal(removed.text,null);assert.equal(removed.expected_self_urn,null);assert.equal(removed.expected_peer_urn,null);assert.equal(removed.expected_conversation_urn,null);assert.equal(removed.details_removed,1);
 finishReply(db,op.id,c.token,ack,now+1);const late=getReply(db,op.id,now+1);assert.equal(late.status,'sent');assert.equal(late.provider_urn,null);assert.equal(claimReply(db,op.id,now+2).claimed,false);}
});
test('a transaction failure cannot reserve a half-written intent or dispatch marker',t=>{
 const {db,id}=setup(t);db.exec("CREATE TRIGGER fail_reserve BEFORE INSERT ON linkedin_reply_sends BEGIN SELECT RAISE(ABORT,'fixture');END");assert.throws(()=>reserve(db,id),/fixture/);assert.equal(listReplySends(db,id,now).length,0);
});

test('different accounts can claim manual replies independently',t=>{
 const {db,id}=setup(t);ingestConversation(db,'b',conversation([message()],{urn:`urn:li:msg_conversation:(${self.urn},thread-b)`}));db.prepare("INSERT INTO linkedin_inbox_sync(account_id,self_urn) VALUES('b',?)").run(self.urn);const other=db.prepare("SELECT id FROM linkedin_conversations WHERE account_id='b'").get().id;
 const a=reserve(db,id);const b=reserve(db,other);assert.equal(claimReply(db,a.id,now).claimed,true);assert.equal(claimReply(db,b.id,now).claimed,true);
});
