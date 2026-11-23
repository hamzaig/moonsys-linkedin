import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, conversation, message, self, peer, timestamp } from './helpers/inbox-fixture.mjs';
import { ingestConversation, hasRunReply, listConversations, matchCampaignContact } from '../lib/linkedin/inbox/store.ts';
import { syncLinkedInInbox, getInboxStatus, inboxIsFresh } from '../lib/linkedin/inbox/sync.ts';
import { parseConversationPage, parseMessagePage, createLinkedInProvider, ProviderError } from '../lib/linkedin/inbox/provider.ts';

const now=timestamp+3600000;
const summary={urn:'thread-1',participants:[self,peer],isGroup:false,lastActivityAt:timestamp};
const provider=(overrides={})=>({identity:async()=>self,list:async()=>({conversations:[summary],nextCursor:null}),messages:async()=>({messages:[message()],nextCursor:null}),...overrides});
function laterEnrollment(db) {db.exec("INSERT INTO runs VALUES ('later','a','w','running'); INSERT INTO run_profiles VALUES ('later-profile','later','lead','2026-11-23T11:30:00.000Z'); INSERT INTO run_profile_tracks VALUES ('later-track','later-profile','in_progress','2026-11-25T12:00:00Z',NULL,NULL);");}

test('contradictory numeric member identity rejects even an exact vanity URL',t=>{
 const db=fixture(t);db.exec("UPDATE targets SET linkedin_member_urn='urn:li:member:111'");
 assert.equal(ingestConversation(db,'a',conversation([message()],{participants:[self,{...peer,memberUrn:'urn:li:member:222'}]})).messagesAdded,0);
 assert.equal(hasRunReply(db,'pa'),false);
 assert.equal(matchCampaignContact(db,'a',{urn:'urn:li:member:111',profileUrl:null}).length,1);
});
test('an existing thread cannot switch its pinned peer identity',t=>{
 const db=fixture(t);ingestConversation(db,'a',conversation([message()]));
 assert.throws(()=>ingestConversation(db,'a',conversation([message('other',{senderUrn:'urn:li:fsd_profile:OTHER'})],{participants:[self,{...peer,urn:'urn:li:fsd_profile:OTHER'}]})),/identity changed/i);
 assert.equal(db.prepare('SELECT count(*) n FROM linkedin_messages').get().n,1);
});
test('a duplicate provider ID cannot change delivery time to cancel a later enrollment',t=>{
 const db=fixture(t);ingestConversation(db,'a',conversation([message()]));laterEnrollment(db);
 assert.throws(()=>ingestConversation(db,'a',conversation([message('incoming',{deliveredAt:timestamp+3600000})])),/identity changed/i);
 assert.equal(hasRunReply(db,'later-profile'),false);
 assert.equal(listConversations(db)[0].last_message_at_ms,timestamp);
});
test('ambiguous legacy enrollment seconds exclude messages within that second',t=>{
 const db=fixture(t);const at=Date.parse('2026-11-23T10:00:00Z');
 assert.equal(ingestConversation(db,'a',conversation([message('old',{deliveredAt:at+999})])).messagesAdded,0);
 db.exec("UPDATE run_profiles SET created_at='2026-11-23T10:00:00.500Z' WHERE id='pa'");
 assert.equal(ingestConversation(db,'a',conversation([message('new',{deliveredAt:at+500})])).messagesAdded,1);
});
test('campaign context belongs to an enrollment that existed at the saved conversation time',t=>{
 const db=fixture(t);ingestConversation(db,'a',conversation([message()]));laterEnrollment(db);
 assert.equal(listConversations(db)[0].run_id,'ra');
});
test('a different verified mailbox owner is rejected without advancing or importing',async t=>{
 const db=fixture(t);await syncLinkedInInbox(db,'a',provider(),()=>now);
 const other={...self,urn:'urn:li:fsd_profile:OTHER'};
 const result=await syncLinkedInInbox(db,'a',provider({identity:async()=>other,messages:async()=>({messages:[message('other')],nextCursor:null})}),()=>now+300000);
 assert.equal(result.status,'auth_required');assert.equal(getInboxStatus(db,'a').self_urn,self.urn);assert.equal(getInboxStatus(db,'a').success_at_ms,now);
 assert.equal(db.prepare('SELECT count(*) n FROM linkedin_messages').get().n,1);
});
test('partial GraphQL, unknown pagination, participant and message shapes cannot claim complete coverage',()=>{
 const root={elements:[],metadata:{nextCursor:null}};
 assert.throws(()=>parseConversationPage({data:{messengerConversationsByCategoryQuery:root},errors:[{message:'partial'}]}),/unsupported/i);
 for(const metadata of [undefined,{}, {nextCursor:42}])assert.throws(()=>parseConversationPage({data:{messengerConversationsByCategoryQuery:{elements:[],metadata}}}),/unsupported/i);
 assert.throws(()=>parseConversationPage({data:{messengerConversationsByCategoryQuery:{...root,elements:[{entityUrn:'t',lastActivityAt:timestamp,conversationParticipants:[{}]}]}}}),/unsupported/i);
 assert.throws(()=>parseMessagePage({data:{elements:[{entityUrn:'x',deliveredAt:timestamp,unknownBody:'text'}],metadata:{nextCursor:null}}}),/unsupported/i);
 const reaction=parseMessagePage({data:{elements:[{entityUrn:'r',senderUrn:peer.urn,deliveredAt:timestamp,eventType:'REACTION',body:{text:'Liked'}}],metadata:{nextCursor:null}}});
 assert.equal(reaction.messages.length,0);
 assert.throws(()=>parseMessagePage({data:{elements:[{entityUrn:'r',senderUrn:peer.urn,deliveredAt:timestamp,$type:'com.linkedin.messenger.Reaction',body:{text:'Liked'}}],metadata:{nextCursor:null}}}),/unsupported/i);
});
test('full-thread reads use documented conversation events and createdBefore paging',async()=>{
 const paths=[];
 const p=createLinkedInProvider(async path=>{paths.push(path);return {status:200,json:{data:{elements:path.includes('createdBefore=')?[]:[{entityUrn:'event1',createdAt:timestamp,eventContent:{'com.linkedin.voyager.messaging.event.MessageEvent':{body:'Legacy body'}},from:{'com.linkedin.voyager.messaging.MessagingMember':{miniProfile:{dashEntityUrn:peer.urn}}}}],paging:{start:0,count:50,links:[]}}}}});
 const thread={...summary,urn:'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,thread-123)'};
 const first=await p.messages(thread);assert.equal(first.messages[0].text,'Legacy body');assert.equal(first.nextCursor,String(timestamp));
 const last=await p.messages(thread,first.nextCursor);assert.equal(last.nextCursor,null);
 assert.ok(paths[0].startsWith('/voyager/api/messaging/conversations/thread-123/events?'));assert.ok(paths[1].includes('createdBefore='+timestamp));
});
test('thread history is covered once and subsequent checks read only the overlap',async t=>{
 const db=fixture(t);let calls=0;
 const p=provider({messages:async(_,cursor)=>{calls++;return cursor?{messages:[message('older',{deliveredAt:timestamp-60000})],nextCursor:null}:{messages:[message()],nextCursor:'older'};}});
 await syncLinkedInInbox(db,'a',p,()=>now);assert.equal(calls,2);
 calls=0;await syncLinkedInInbox(db,'a',p,()=>now+300000);assert.equal(calls,1);assert.equal(inboxIsFresh(db,'a',now+300000),true);
});
test('a scan older than freshness must catch up from the head before claiming success',async t=>{
 const db=fixture(t);let time=now;let listCalls=0;
 const p=provider({list:async()=>{listCalls++;return {conversations:[summary],nextCursor:null}}});
 assert.equal((await syncLinkedInInbox(db,'a',p,()=>time,{maxRequests:1})).status,'partial');
 time+=630000;assert.equal((await syncLinkedInInbox(db,'a',p,()=>time)).status,'partial');assert.equal(inboxIsFresh(db,'a',time),false);
 assert.equal((await syncLinkedInInbox(db,'a',p,()=>time+30000)).status,'ok');assert.equal(listCalls,2);assert.equal(inboxIsFresh(db,'a',time+30000),true);
});
test('non-adjacent cursor cycles fail visibly and invalid retry durations keep a finite backoff',async t=>{
 const db=fixture(t);const cycling=provider({list:async cursor=>({conversations:[],nextCursor:cursor==='A'?'B':'A'})});
 assert.equal((await syncLinkedInInbox(db,'a',cycling,()=>now)).status,'error');
 const rate=await syncLinkedInInbox(db,'b',provider({identity:async()=>{throw new ProviderError('rate_limit','pause',429,NaN)}}),()=>now);
 assert.equal(rate.status,'rate_limited');assert.ok(getInboxStatus(db,'b').retry_at_ms>=now+60000);
});
