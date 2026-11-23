import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {replyFixture,self,peer} from './helpers/reply-fixture.mjs';
import {loadTsx} from './helpers/tsx-loader.mjs';
let authenticated=true;
process.env.NEXTAUTH_URL='http://localhost:3000';process.env.INTERNAL_API_SECRET='fixture-internal-test-secret';
function setup(t){const f=replyFixture(t);let writes=0,factories=0;const factory=async()=>{factories++;return {identity:async()=>self,list:async()=>({conversations:[{urn:f.urn,participants:[self,peer],isGroup:false,lastActivityAt:Date.now()}],nextCursor:null}),send:async(_,before)=>{before();writes++;return {messageUrn:`urn:li:msg_message:(${self.urn},m1)`,deliveredAt:Date.now()}}}};
 const {default:handler}=loadTsx('pages/api/inbox/linkedin/reply.ts',{'@/lib/db':{getDb:()=>f.db},'@/lib/linkedin/inbox/reply-session':{createSessionReplyProvider:factory},'next-auth/jwt':{getToken:async()=>authenticated?{sub:'fixture'}:null}});
 return {...f,handler,counts:()=>({writes,factories})};}
async function request(f,{method='POST',body,query={},headers={origin:'http://localhost:3000','content-type':'application/json'}}={}){
 const result={status:200,headers:{},body:null};const res={setHeader:(k,v)=>{result.headers[k]=v},status(n){result.status=n;return this},json(v){result.body=v;return this},end(){return this}};
 await f.handler({method,body,query,headers},res);return result;
}

test('API reserve and status perform no write, explicit dispatch writes once and hides private fields',async t=>{
 authenticated=true;const f=setup(t),id=randomUUID();const body={action:'reserve',requestId:id,conversationId:f.id,text:'API fixture'};
 let result=await request(f,{body});assert.equal(result.status,200);assert.equal(result.body.operation.status,'preparing');assert.equal(f.counts().writes,0);
 await request(f,{body});await request(f,{method:'GET',query:{id}});assert.equal(f.counts().writes,0);
 result=await request(f,{body:{action:'dispatch',requestId:id}});assert.equal(result.body.operation.status,'sent');await request(f,{body:{action:'dispatch',requestId:id}});assert.equal(f.counts().writes,1);
 assert.ok(!JSON.stringify(result.body).includes('attempt_token'));assert.ok(!JSON.stringify(result.body).includes('body_hash'));assert.equal(result.headers['Cache-Control'],'no-store');
});
test('authentication, browser origin, media type, shape and unsupported methods are enforced',async t=>{
 authenticated=true;const f=setup(t);authenticated=false;assert.equal((await request(f,{method:'GET',query:{id:randomUUID()}})).status,401);authenticated=true;
 const body={action:'reserve',requestId:randomUUID(),conversationId:f.id,text:'Reply'};
 assert.equal((await request(f,{body,headers:{origin:'https://evil.invalid','content-type':'application/json'}})).status,403);
 assert.equal((await request(f,{body,headers:{origin:'http://localhost:3000','content-type':'text/plain'}})).status,415);
 assert.equal((await request(f,{body:{...body,accountId:'b'}})).status,400);
 assert.equal((await request(f,{body:{...body,text:' '}})).status,400);assert.equal((await request(f,{method:'DELETE'})).status,405);
 assert.equal((await request(f,{body:{action:'dispatch',requestId:randomUUID()}})).status,404);assert.equal(f.counts().writes,0);
});
test('valid internal secret is separately authenticated; wrong secret cannot replace browser authentication',async t=>{
 authenticated=false;const f=setup(t);const body={action:'reserve',requestId:randomUUID(),conversationId:f.id,text:'Reply'};
 assert.equal((await request(f,{body,headers:{'x-internal-secret':'bad','content-type':'application/json'}})).status,401);
 assert.equal((await request(f,{body,headers:{'x-internal-secret':process.env.INTERNAL_API_SECRET,'content-type':'application/json'}})).status,200);assert.equal(f.counts().writes,0);authenticated=true;
});
test('disconnected dispatch returns a saved non-delivery failure without creating a provider',async t=>{
 authenticated=true;const f=setup(t),id=randomUUID();await request(f,{body:{action:'reserve',requestId:id,conversationId:f.id,text:'Reply'}});f.db.exec("UPDATE accounts SET is_authenticated=0 WHERE id='a'");
 const result=await request(f,{body:{action:'dispatch',requestId:id}});assert.equal(result.body.operation.status,'failed');assert.equal(result.body.operation.error_code,'auth');assert.deepEqual(f.counts(),{writes:0,factories:0});
});

test('unknown acknowledgment does not resend or claim delivery and deletion keeps authenticated status',async t=>{
 authenticated=true;const f=setup(t),id=randomUUID();await request(f,{body:{action:'reserve',requestId:id,conversationId:f.id,text:'Uncertain reply'}});
 f.db.prepare("UPDATE linkedin_reply_sends SET status='unknown',attempt_token='fixture',error_code='uncertain' WHERE id=?").run(id);
 const acknowledged=await request(f,{body:{action:'acknowledge',requestId:id}});assert.equal(acknowledged.body.operation.status,'unknown');assert.ok(acknowledged.body.operation.acknowledged_at_ms);assert.equal(f.counts().writes,0);
 f.db.prepare('DELETE FROM targets WHERE id=?').run('lead');const removed=await request(f,{method:'GET',query:{id}});assert.equal(removed.status,200);assert.equal(removed.body.operation.text,null);assert.equal(removed.body.operation.details_removed,1);assert.ok(!JSON.stringify(removed.body).includes('Uncertain reply'));
});
