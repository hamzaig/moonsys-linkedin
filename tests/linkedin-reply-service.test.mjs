import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { replyFixture,self,peer,replyNow as now } from './helpers/reply-fixture.mjs';
import { reserveReply,getReply } from '../lib/linkedin/inbox/reply-store.ts';
import { dispatchReply } from '../lib/linkedin/inbox/reply-service.ts';
import { ProviderError } from '../lib/linkedin/inbox/provider.ts';
const ack={messageUrn:`urn:li:msg_message:(${self.urn},new-message)`,deliveredAt:now+1};
function pending(t){const f=replyFixture(t);const op=reserveReply(f.db,{requestId:randomUUID(),conversationId:f.id,text:'Explicit reply'},now);return {...f,op};}
function provider(f,overrides={}){return {identity:async()=>self,list:async()=>({conversations:[{urn:f.urn,participants:[self,peer],isGroup:false,lastActivityAt:now}],nextCursor:null}),send:async(_,before)=>{before();return ack},...overrides};}

test('one explicit dispatch verifies owner/thread and sends once even after a saved incoming reply',async t=>{
 const f=pending(t);let sends=0;const p=provider(f,{send:async(input,before)=>{before();sends++;assert.equal(input.conversationUrn,f.urn);assert.equal(input.originToken,f.op.id);return ack}});
 const first=await dispatchReply(f.db,f.op.id,async()=>p,()=>now);assert.equal(first.status,'sent');assert.equal(sends,1);
 assert.equal((await dispatchReply(f.db,f.op.id,async()=>p,()=>now)).status,'sent');assert.equal(sends,1);
});
test('disconnected account fails before constructing any session/provider',async t=>{
 const f=pending(t);f.db.exec("UPDATE accounts SET is_authenticated=0 WHERE id='a'");let calls=0;
 const op=await dispatchReply(f.db,f.op.id,async()=>{calls++;throw Error('must not run')},()=>now);assert.equal(op.status,'failed');assert.equal(op.error_code,'auth');assert.equal(calls,0);
});
test('wrong live owner, changed peer, group and ambiguous target cannot reach the write',async t=>{
 for(const kind of ['owner','peer','group','target']){
  const f=pending(t);let sends=0;const summary={urn:f.urn,participants:[self,peer],isGroup:false,lastActivityAt:now};
  if(kind==='peer')summary.participants=[self,{...peer,urn:'urn:li:fsd_profile:STRANGER'}];if(kind==='group')summary.isGroup=true;
  if(kind==='target')f.db.exec("UPDATE targets SET linkedin_url='https://www.linkedin.com/in/someone-else/'");
  const p=provider(f,{identity:async()=>kind==='owner'?{...self,urn:'urn:li:fsd_profile:OTHER'}:self,list:async()=>({conversations:[summary],nextCursor:null}),send:async()=>{sends++;return ack}});
  assert.equal((await dispatchReply(f.db,f.op.id,async()=>p,()=>now)).status,'failed');assert.equal(sends,0,kind);
 }
});
test('five-page miss, cyclic cursor and partial/unsupported response fail before dispatch',async t=>{
 for(const mode of ['miss','cycle','partial']){
  const f=pending(t);let pages=0;let writes=0;const p=provider(f,{list:async cursor=>{pages++;if(mode==='partial')throw new ProviderError('unsupported','private payload');return {conversations:[],nextCursor:mode==='cycle'?(cursor==='A'?'B':'A'):String(pages)}},send:async()=>{writes++;return ack}});
  const op=await dispatchReply(f.db,f.op.id,async()=>p,()=>now);assert.equal(op.status,'failed');assert.equal(writes,0);assert.ok(pages<=5);assert.ok(!JSON.stringify(op).includes('private payload'));
 }
});
test('the 30-second total deadline is enforced after a slow read',async t=>{
 const f=pending(t);let time=now;let writes=0;const p=provider(f,{identity:async()=>{time+=30001;return self},send:async()=>{writes++;return ack}});
 const op=await dispatchReply(f.db,f.op.id,async()=>p,()=>time);assert.equal(op.status,'failed');assert.equal(writes,0);
});
test('callback-time authentication, target changes and deletion prevent the actual write',async t=>{
 for(const mode of ['auth','peer','delete']){
  const f=pending(t);let writes=0;const p=provider(f,{send:async(_,before)=>{await Promise.resolve();if(mode==='auth')f.db.exec("UPDATE accounts SET is_authenticated=0 WHERE id='a'");if(mode==='peer')f.db.prepare("UPDATE linkedin_conversations SET peer_urn='urn:li:fsd_profile:CHANGED' WHERE id=?").run(f.id);if(mode==='delete')f.db.prepare('DELETE FROM targets WHERE id=?').run('lead');before();writes++;return ack}});
  assert.equal((await dispatchReply(f.db,f.op.id,async()=>p,()=>now)).status,'failed');assert.equal(writes,0);
 }
});
test('concurrent dispatch of a saved operation cannot start two preflights or writes',async t=>{
 const f=pending(t);let resolve;const wait=new Promise(r=>{resolve=r});let reads=0,writes=0;
 const p=provider(f,{identity:async()=>{reads++;await wait;return self},send:async(_,before)=>{before();writes++;return ack}});
 const a=dispatchReply(f.db,f.op.id,async()=>p,()=>now);const b=await dispatchReply(f.db,f.op.id,async()=>p,()=>now);assert.equal(b.status,'preparing');resolve();assert.equal((await a).status,'sent');assert.equal(reads,1);assert.equal(writes,1);
});
test('timeout after the dispatch marker is unknown and never replayed',async t=>{
 const f=pending(t);let writes=0;const p=provider(f,{send:async(_,before)=>{before();writes++;throw new ProviderError('timeout','cookie=PRIVATE')}});
 const op=await dispatchReply(f.db,f.op.id,async()=>p,()=>now);assert.equal(op.status,'unknown');assert.ok(!JSON.stringify(op).includes('PRIVATE'));
 assert.equal((await dispatchReply(f.db,f.op.id,async()=>p,()=>now)).status,'unknown');assert.equal(writes,1);
});
test('preflight 429 is a non-delivery failure and persists an invalid-header fallback',async t=>{
 const f=pending(t);let writes=0;const p=provider(f,{identity:async()=>{throw new ProviderError('rate_limit','pause',429,NaN)},send:async()=>{writes++;return ack}});
 const op=await dispatchReply(f.db,f.op.id,async()=>p,()=>now);assert.equal(op.status,'failed');assert.equal(writes,0);assert.ok(f.db.prepare("SELECT retry_at_ms FROM linkedin_reply_accounts WHERE account_id='a'").get().retry_at_ms>=now+60000);
});
test('external acknowledgment followed by a DB save failure cannot report Sent',async t=>{
 const f=pending(t);f.db.exec("CREATE TRIGGER fail_sent BEFORE UPDATE OF status ON linkedin_reply_sends WHEN NEW.status='sent' BEGIN SELECT RAISE(ABORT,'ack persistence failed');END");
 const op=await dispatchReply(f.db,f.op.id,async()=>provider(f),()=>now);assert.equal(op.status,'unknown');assert.notEqual(getReply(f.db,f.op.id,now).status,'sent');
});
test('late positive acknowledgment upgrades the same expired sending attempt without another write',async t=>{
 const f=pending(t);let time=now;const p=provider(f,{send:async(_,before)=>{before();time+=120001;assert.equal(getReply(f.db,f.op.id,time).status,'unknown');return ack}});
 assert.equal((await dispatchReply(f.db,f.op.id,async()=>p,()=>time)).status,'sent');
});
