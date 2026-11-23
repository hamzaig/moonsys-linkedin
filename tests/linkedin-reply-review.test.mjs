import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {replyFixture,self,peer,replyNow as now} from './helpers/reply-fixture.mjs';
import {reserveReply,getReply,claimReply,replyCapability} from '../lib/linkedin/inbox/reply-store.ts';
import {dispatchReply} from '../lib/linkedin/inbox/reply-service.ts';
import {parseConversationPage,ProviderError} from '../lib/linkedin/inbox/provider.ts';
const opFor=f=>reserveReply(f.db,{requestId:randomUUID(),conversationId:f.id,text:'Review reply'},now);
const summary=f=>({urn:f.urn,participants:[self,peer],isGroup:false,oneToOneVerified:true,lastActivityAt:now});
const provider=(f,overrides={})=>({identity:async()=>self,list:async()=>({conversations:[summary(f)],nextCursor:null}),send:async(_,before)=>{before();return {messageUrn:`urn:li:msg_message:(${self.urn},m1)`,deliveredAt:now}},...overrides});
function otherThread(f){
 f.db.prepare("INSERT INTO targets(id,full_name,linkedin_url) VALUES('other-lead','Other lead','https://www.linkedin.com/in/other-lead/')").run();
 f.db.prepare("INSERT INTO run_profiles(id,run_id,target_id,created_at) VALUES('other-profile','ra','other-lead','2026-11-23 10:00:00')").run();
 f.db.prepare("INSERT INTO linkedin_conversations(id,account_id,provider_urn,target_id,peer_urn) VALUES('other-thread','a',?,'other-lead','urn:li:fsd_profile:OTHER_PEER')").run(`urn:li:msg_conversation:(${self.urn},thread-2)`);
 return 'other-thread';
}

test('explicit reconnect with authentication still true invalidates a reserved/captured session',async t=>{
 const f=replyFixture(t);f.db.exec('ALTER TABLE accounts ADD COLUMN cookies_json TEXT');const op=opFor(f);let writes=0;
 const p=provider(f,{send:async(_,before)=>{f.db.exec("UPDATE accounts SET cookies_json='replacement',is_authenticated=1 WHERE id='a'");before();writes++;return {messageUrn:`urn:li:msg_message:(${self.urn},m1)`,deliveredAt:now}}});
 const result=await dispatchReply(f.db,op.id,async()=>p,()=>now);assert.equal(result.status,'failed');assert.equal(writes,0);
});
test('ordinary session-state persistence does not invalidate an unchanged verified session',async t=>{
 const f=replyFixture(t);f.db.exec('ALTER TABLE accounts ADD COLUMN cookies_json TEXT');const op=opFor(f);
 const p=provider(f,{send:async(_,before)=>{f.db.exec("UPDATE accounts SET cookies_json='ordinary-save' WHERE id='a'");before();return {messageUrn:`urn:li:msg_message:(${self.urn},m1)`,deliveredAt:now}}});
 assert.equal((await dispatchReply(f.db,op.id,async()=>p,()=>now)).status,'sent');
});
test('reconnect while creating the provider also fences the old operation',async t=>{
 const f=replyFixture(t),op=opFor(f);let writes=0;
 const result=await dispatchReply(f.db,op.id,async()=>{f.db.exec("UPDATE accounts SET is_authenticated=1 WHERE id='a'");return provider(f,{send:async(_,before)=>{before();writes++;return {messageUrn:`urn:li:msg_message:(${self.urn},m1)`,deliveredAt:now}}})},()=>now);
 assert.equal(result.status,'failed');assert.equal(writes,0);
});
test('conversation URN mailbox must match the pinned owner before reservation',t=>{
 const f=replyFixture(t);f.db.prepare('UPDATE linkedin_conversations SET provider_urn=? WHERE id=?').run('urn:li:msg_conversation:(urn:li:fsd_profile:FOREIGN,thread-1)',f.id);
 assert.throws(()=>opFor(f),e=>e.code==='identity');
});
test('sending needs affirmative one-to-one evidence and unique exact thread metadata',async t=>{
 for(const mode of ['missing','malformed','duplicate']){
  const f=replyFixture(t),op=opFor(f);let writes=0;const row=summary(f);if(mode==='missing')delete row.oneToOneVerified;if(mode==='malformed')row.oneToOneVerified='true';
  const p=provider(f,{list:async()=>({conversations:mode==='duplicate'?[row,{...row,isGroup:true}]:[row],nextCursor:null}),send:async(_,before)=>{before();writes++;return {messageUrn:`urn:li:msg_message:(${self.urn},m1)`,deliveredAt:now}}});
  assert.equal((await dispatchReply(f.db,op.id,async()=>p,()=>now)).status,'failed');assert.equal(writes,0,mode);
 }
});
test('conversation parser preserves explicit one-to-one proof without inventing it',()=>{
 for(const flag of [undefined,null,'false',false,true]){
  const row={entityUrn:`urn:li:msg_conversation:(${self.urn},t)`,lastActivityAt:now,conversationParticipants:[{entityUrn:self.urn},{entityUrn:peer.urn}]};if(flag!==undefined)row.groupChat=flag;
  const result=parseConversationPage({data:{messengerConversationsByCategoryQuery:{elements:[row],metadata:{nextCursor:null}}}});
  assert.equal(result.conversations[0].oneToOneVerified,flag===false);
 }
});
test('target deletion before dispatch releases a surviving account lease',async t=>{
 const f=replyFixture(t),other=otherThread(f),op=opFor(f);
 await dispatchReply(f.db,op.id,async()=>provider(f,{identity:async()=>{f.db.exec("DELETE FROM targets WHERE id='lead'");throw new ProviderError('network','fixture')}}),()=>now);
 const next=reserveReply(f.db,{requestId:randomUUID(),conversationId:other,text:'New thread'},now+1);assert.equal(claimReply(f.db,next.id,now+1).claimed,true);
});
test('provider rate-limit pause survives target deletion before and after the write marker',async t=>{
 for(const phase of ['preflight','post']){
  const f=replyFixture(t),other=otherThread(f),op=opFor(f);
  const failure=()=>{f.db.exec("DELETE FROM targets WHERE id='lead'");throw new ProviderError('rate_limit','fixture',429,900000)};
  const p=provider(f,phase==='preflight'?{identity:async()=>failure()}:{send:async(_,before)=>{before();failure()}});
  await dispatchReply(f.db,op.id,async()=>p,()=>now);
  assert.equal(replyCapability(f.db,other,now+1).code,'rate_limit',phase);assert.equal(getReply(f.db,op.id,now+1).text,null);
 }
});
