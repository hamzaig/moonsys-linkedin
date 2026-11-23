import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {self} from './helpers/inbox-fixture.mjs';
import {createReplyProvider} from '../lib/linkedin/inbox/reply-provider.ts';
import {loadTsx} from './helpers/tsx-loader.mjs';
const input=()=>({conversationUrn:`urn:li:msg_conversation:(${self.urn},thread-1)`,mailboxUrn:self.urn,text:'Hello\nworld',originToken:randomUUID()});
const ack=()=>({entityUrn:`urn:li:msg_message:(${self.urn},message-1)`,deliveredAt:Date.now()});

test('adapter writes only to the fixed existing-conversation endpoint with a stable token',async()=>{
 let requests=0,markers=0;const value=input();
 const p=createReplyProvider(async()=>({status:200,json:{}}),async(path,options,before)=>{requests++;assert.equal(path,'/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage');assert.equal(options.headers['Content-Type'],'text/plain;charset=UTF-8');const body=JSON.parse(options.body);assert.equal(body.message.conversationUrn,value.conversationUrn);assert.equal(body.message.originToken,value.originToken);assert.equal(body.mailboxUrn,self.urn);assert.equal(body.message.body.text,value.text);assert.equal(body.dedupeByClientGeneratedToken,false);before();return {status:201,json:{value:ack()}}});
 const result=await p.send(value,()=>{markers++});assert.ok(result.messageUrn.startsWith('urn:li:msg_message:'));assert.equal(markers,1);assert.equal(requests,1);
});
test('unknown response wrappers, missing/invalid IDs/times and contradictory identity are unconfirmed',async()=>{
 const value=input();
 for(const json of [{},ack(),{value:{...ack(),deliveredAt:NaN}},{value:{...ack(),deliveredAt:1e30}},{value:{...ack(),entityUrn:'javascript:alert(1)'}},{value:{...ack(),conversationUrn:'other'}},{value:{...ack(),mailboxUrn:'urn:li:fsd_profile:OTHER'}},{value:{...ack(),originToken:randomUUID()}}]){
  const p=createReplyProvider(async()=>({status:200,json:{}}),async(_,__,before)=>{before();return {status:201,json}});await assert.rejects(p.send(value,()=>{}));
 }
});
test('send failures, redirects, 429 and 5xx are never retried',async()=>{
 for(const status of [302,401,429,500]){let calls=0;const p=createReplyProvider(async()=>({status:200,json:{}}),async(_,__,before)=>{calls++;before();return {status,json:null,retryAfterMs:NaN}});await assert.rejects(p.send(input(),()=>{}));assert.equal(calls,1);}
});
test('session adapter captures one context and disables retries/redirects at its POST boundary',async()=>{
 let contextCalls=0,writes=0,marked=false;const requestInput=input();
 const response={status:()=>201,headers:()=>({'content-type':'application/json'}),body:async()=>Buffer.from(JSON.stringify({value:ack()})),dispose:async()=>{}};
 const context={cookies:async()=>[{name:'JSESSIONID',value:'"fixture-csrf"'}],request:{get:async()=>{throw Error('not called')},post:async(url,options)=>{assert.equal(marked,true);writes++;assert.ok(url.startsWith('https://www.linkedin.com/voyager/api/'));assert.equal(options.timeout,20000);assert.equal(options.maxRedirects,0);assert.equal(options.maxRetries,0);assert.equal(options.headers['csrf-token'],'fixture-csrf');return response}}};
 const {createSessionReplyProvider}=loadTsx('lib/linkedin/inbox/reply-session.ts',{'@/lib/linkedin/session':{getSessionContext:async()=>{contextCalls++;return context}}});
 const p=await createSessionReplyProvider('a',Date.now()+30000);await p.send(requestInput,()=>{marked=true});assert.equal(writes,1);assert.equal(contextCalls,1);
});
