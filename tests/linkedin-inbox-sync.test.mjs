import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, message, self, peer, timestamp } from './helpers/inbox-fixture.mjs';
import { syncLinkedInInbox, getInboxStatus, inboxIsFresh } from '../lib/linkedin/inbox/sync.ts';
import { createLinkedInProvider, parseConversationPage, parseMessagePage, ProviderError } from '../lib/linkedin/inbox/provider.ts';
const now=timestamp+3600000;
const summary={urn:'thread-1',participants:[self,peer],isGroup:false,lastActivityAt:timestamp};
function provider(overrides={}) {return {identity:async()=>self,list:async()=>({conversations:[summary],nextCursor:null}),messages:async()=>({messages:[message()],nextCursor:null}),...overrides};}

test('a complete sync stores the reply and records honest freshness',async t=>{
 const db=fixture(t);const r=await syncLinkedInInbox(db,'a',provider(),()=>now);assert.equal(r.status,'ok');assert.equal(r.messagesAdded,1);assert.equal(inboxIsFresh(db,'a',now+599999),true);assert.equal(inboxIsFresh(db,'a',now+600001),false);assert.equal(inboxIsFresh(db,'b',now),false);
});
test('partial pagination persists continuation without claiming a completed scan',async t=>{
 const db=fixture(t);const pages=provider({list:async cursor=>({conversations:cursor?[]:[summary],nextCursor:cursor?null:'page-2'})});
 const first=await syncLinkedInInbox(db,'a',pages,()=>now,{maxRequests:1});assert.equal(first.status,'partial');assert.equal(getInboxStatus(db,'a').success_at_ms,null);assert.equal(inboxIsFresh(db,'a',now),false);
 const next=await syncLinkedInInbox(db,'a',pages,()=>now+1000);assert.equal(next.status,'ok');assert.equal(next.messagesAdded,1);assert.equal(getInboxStatus(db,'a').continuation,null);
});
test('message pagination imports the entire campaign-period thread once',async t=>{
 const db=fixture(t);const p=provider({messages:async(_,cursor)=>cursor?{messages:[message('older',{deliveredAt:timestamp-60000})],nextCursor:null}:{messages:[message()],nextCursor:'older'}});
 const r=await syncLinkedInInbox(db,'a',p,()=>now);assert.equal(r.messagesAdded,2);assert.equal(db.prepare('SELECT count(*) n FROM linkedin_messages').get().n,2);
 const repeat=await syncLinkedInInbox(db,'a',p,()=>now+300000);assert.equal(repeat.messagesAdded,0);
});
test('overlapping manual and automatic sync does not acquire the same account twice',async t=>{
 const db=fixture(t);let release;const waiting=new Promise(r=>{release=r});const first=syncLinkedInInbox(db,'a',provider({identity:async()=>{await waiting;return self}}),()=>now);
 const second=await syncLinkedInInbox(db,'a',provider(),()=>now);assert.equal(second.status,'busy');release();await first;
});
test('authentication failure is visible and never advances the success watermark',async t=>{
 const db=fixture(t);await syncLinkedInInbox(db,'a',provider(),()=>now);const failed=await syncLinkedInInbox(db,'a',provider({list:async()=>{throw new ProviderError('auth','Reconnect LinkedIn',401)}}),()=>now+300000);
 assert.equal(failed.status,'auth_required');assert.equal(getInboxStatus(db,'a').success_at_ms,now);assert.equal(inboxIsFresh(db,'a',now+300000),false);
});
test('rate-limit backoff applies even to a manual force request',async t=>{
 const db=fixture(t);await syncLinkedInInbox(db,'a',provider({identity:async()=>{throw new ProviderError('rate_limit','Try later',429,900000)}}),()=>now);
 const retry=await syncLinkedInInbox(db,'a',provider(),()=>now+1000,{force:true});assert.equal(retry.status,'backoff');assert.equal(db.prepare('SELECT count(*) n FROM linkedin_messages').get().n,0);
});
test('unknown response and network failures cannot be reported as an empty successful inbox',async t=>{
 const db=fixture(t);const r=await syncLinkedInInbox(db,'a',provider({list:async()=>{throw new Error('cookie=DO-NOT-LEAK')}}),()=>now);
 assert.equal(r.status,'error');assert.equal(getInboxStatus(db,'a').success_at_ms,null);assert.ok(!JSON.stringify(getInboxStatus(db,'a')).includes('DO-NOT-LEAK'));
});
test('one account failure cannot overwrite another account sync result',async t=>{
 const db=fixture(t);await syncLinkedInInbox(db,'b',provider(),()=>now);await syncLinkedInInbox(db,'a',provider({identity:async()=>{throw new ProviderError('timeout','Timeout')}}),()=>now+100);
 assert.equal(getInboxStatus(db,'b').status,'ok');assert.equal(getInboxStatus(db,'a').status,'error');
});
test('unknown accounts are rejected without creating orphan sync state',async t=>{
 const db=fixture(t);await assert.rejects(syncLinkedInInbox(db,'missing',provider(),()=>now),/Account not found/);assert.equal(db.prepare('SELECT count(*) n FROM linkedin_inbox_sync').get().n,0);
});
test('a recognized normalized conversation page resolves participants and opaque cursor',()=>{
 const json={data:{data:{messengerConversationsByCategoryQuery:{'*elements':['thread-1'],metadata:{nextCursor:'cursor+/='}}}},included:[{entityUrn:'thread-1',lastActivityAt:timestamp,'*conversationParticipants':['person-self','person-peer']},{entityUrn:'person-self',hostIdentityUrn:self.urn,participantType:{member:{profileUrl:self.profileUrl}}},{entityUrn:'person-peer',hostIdentityUrn:peer.urn,participantType:{member:{profileUrl:peer.profileUrl}}}]};
 const result=parseConversationPage(json);assert.equal(result.conversations[0].participants[1].profileUrl,peer.profileUrl);assert.equal(result.nextCursor,'cursor+/=');
});
test('unknown payload shapes and missing normalized references fail instead of producing empty success',()=>{
 assert.throws(()=>parseConversationPage({data:{}}),/Unsupported/);assert.throws(()=>parseConversationPage({data:{data:{messengerConversationsByCategoryQuery:{'*elements':['missing']}}},included:[]}),/reference/);
 assert.throws(()=>parseMessagePage({data:{}}),/Unsupported/);
});
test('normalized messages resolve sender identity and ignore non-message system events',()=>{
 const result=parseMessagePage({data:{elements:[{entityUrn:'m1',senderUrn:'urn:li:msg_messagingParticipant:'+peer.urn,deliveredAt:timestamp,body:{text:'Hello'}},{entityUrn:'system',deliveredAt:timestamp,eventType:'REACTION'}],metadata:{nextCursor:null}}});
 assert.equal(result.messages.length,1);assert.equal(result.messages[0].senderUrn,peer.urn);assert.equal(result.messages[0].text,'Hello');
});
test('provider requests are GET-only and preserve query cursors without permitting another origin',async()=>{
 const requests=[];const transport=async path=>{requests.push(path);if(path==='/voyager/api/me')return {status:200,json:{data:{'*miniProfile':'me'},included:[{entityUrn:'me',dashEntityUrn:self.urn,publicIdentifier:'owner'}]}};return {status:200,json:{data:{data:{messengerConversationsByCategoryQuery:{elements:[],metadata:{nextCursor:null}}}}}}};
 const p=createLinkedInProvider(transport);await p.identity();await p.list('cursor+/=');assert.equal(requests.length,2);assert.ok(requests[1].startsWith('/voyager/api/'));assert.ok(requests[1].includes('cursor%2B%2F%3D'));
});
test('provider handles 401, 429 and unreadable success bodies as explicit failures',async()=>{
 for(const [status,code]of [[401,'auth'],[429,'rate_limit'],[200,'unsupported']]){
  const p=createLinkedInProvider(async()=>({status,json:{},retryAfterMs:900000}));await assert.rejects(p.identity(),e=>e instanceof ProviderError&&e.code===code);
 }
});
test('a final page arriving after the sync lease expires cannot claim a fresh inbox',async t=>{
 const db=fixture(t);let time=now;
 const result=await syncLinkedInInbox(db,'a',provider({list:async()=>{time+=180001;return {conversations:[],nextCursor:null}}}),()=>time,{maxRequests:1});
 assert.equal(result.status,'error');assert.equal(getInboxStatus(db,'a').success_at_ms,null);
});
