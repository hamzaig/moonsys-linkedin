// Acceptance checks against an EMPTY, ISOLATED loopback fixture database only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {encode} from 'next-auth/jwt';
import {ingestConversation} from '../lib/linkedin/inbox/store.ts';
import {reserveReply} from '../lib/linkedin/inbox/reply-store.ts';
const base=process.env.NEXTAUTH_URL,dbPath=process.env.MOONSYS_DB_PATH,secret=process.env.INTERNAL_API_SECRET;
assert.ok(base&&dbPath&&secret&&process.env.NEXTAUTH_SECRET);assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const internal={'x-internal-secret':secret};assert.equal((await fetch(base+'/api/inbox/linkedin/sync',{headers:internal})).status,200);
const db=new Database(dbPath,{fileMustExist:true});db.pragma('foreign_keys=ON');
for(const table of ['accounts','targets','runs'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,'Refusing to modify a non-empty database');
const checks=[];const token=await encode({secret:process.env.NEXTAUTH_SECRET,token:{sub:'isolated-fixture'}});
async function request(route,{method='GET',body,expected=200,auth='internal',headers={}}={}){
 const authHeaders=auth==='internal'?internal:auth==='browser'?{cookie:`next-auth.session-token=${token}`}:{ };
 const response=await fetch(base+route,{method,headers:{...authHeaders,...(body!==undefined?{'content-type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const value=await response.json().catch(()=>null);assert.equal(response.status,expected,`${method} ${route}`);checks.push({route,method,status:response.status});return value;
}
try{
 db.transaction(()=>{
  db.prepare("INSERT INTO accounts(id,name,email,is_authenticated) VALUES('reply-a','Reply fixture','reply@example.invalid',0)").run();
  db.prepare("INSERT INTO targets(id,full_name,linkedin_url,email,email_replied_at) VALUES('reply-lead','Reply Lead','https://www.linkedin.com/in/reply-lead/','lead@example.invalid','2026-11-22 11:00:00')").run();
  db.prepare("INSERT INTO workflows(id,name) VALUES('reply-workflow','Reply fixture')").run();
  db.prepare("INSERT INTO runs(id,workflow_id,account_id,status) VALUES('reply-run','reply-workflow','reply-a','paused')").run();
  db.prepare("INSERT INTO run_profiles(id,run_id,target_id,created_at) VALUES('reply-profile','reply-run','reply-lead','2026-11-22T10:00:00.000Z')").run();
 })();
 const self={urn:'urn:li:fsd_profile:FIXTURE_SELF',profileUrl:'https://www.linkedin.com/in/reply-owner/'},peer={urn:'urn:li:fsd_profile:FIXTURE_PEER',profileUrl:'https://www.linkedin.com/in/reply-lead/'};
 ingestConversation(db,'reply-a',{urn:`urn:li:msg_conversation:(${self.urn},fixture-thread)`,self,participants:[self,peer],isGroup:false,messages:[{urn:'fixture-incoming',senderUrn:peer.urn,text:'Fixture incoming',deliveredAt:Date.now()-1000}]});
 db.prepare("INSERT INTO linkedin_inbox_sync(account_id,self_urn) VALUES('reply-a',?)").run(self.urn);
 const conversationId=db.prepare('SELECT id FROM linkedin_conversations').get().id,id=randomUUID();
 // Authentication is never committed as true: the application worker can only
 // observe disconnected fixture accounts. This reservation has no external I/O.
 db.transaction(()=>{db.exec("UPDATE accounts SET is_authenticated=1 WHERE id='reply-a'");reserveReply(db,{requestId:id,conversationId,text:'Fixture reply <script>plain</script>'});db.exec("UPDATE accounts SET is_authenticated=0 WHERE id='reply-a'")})();
 const body={action:'reserve',requestId:randomUUID(),conversationId,text:'Another reply'};
 await request('/api/inbox/linkedin/reply?id='+id,{auth:'none',expected:401});
 await request('/api/inbox/linkedin/reply?id=invalid',{expected:400});await request('/api/inbox/linkedin/reply?id='+randomUUID(),{expected:404});
 await request('/api/inbox/linkedin/reply',{method:'DELETE',expected:405});
 await request('/api/inbox/linkedin/reply',{method:'POST',body:{},expected:400});
 await request('/api/inbox/linkedin/reply',{method:'POST',body:{...body,accountId:'wrong'},expected:400});
 await request('/api/inbox/linkedin/reply',{method:'POST',body,headers:{'content-type':'text/plain'},expected:415});
 await request('/api/inbox/linkedin/reply',{method:'POST',body,auth:'browser',headers:{origin:'https://evil.invalid'},expected:403});
 await request('/api/inbox/linkedin/reply',{method:'POST',body,auth:'browser',expected:403});
 await request('/api/inbox/linkedin/reply',{method:'POST',body,expected:409});
 const saved=await request('/api/inbox/linkedin/reply?id='+id);assert.equal(saved.operation.status,'preparing');assert.ok(!JSON.stringify(saved).includes('attempt_token'));assert.ok(!JSON.stringify(saved).includes('body_hash'));
 const repeated=await request('/api/inbox/linkedin/reply',{method:'POST',body:{action:'reserve',requestId:id,conversationId,text:'Fixture reply <script>plain</script>'}});assert.equal(repeated.operation.status,'preparing');
 await request('/api/inbox/linkedin/reply',{method:'POST',body:{action:'reserve',requestId:id,conversationId,text:'Changed'},expected:409});
 const thread=await request('/api/inbox/linkedin/thread?id='+conversationId);assert.equal(thread.replyCapability.can_reply,false);assert.equal(thread.replySends[0].id,id);
 const dispatched=await request('/api/inbox/linkedin/reply',{method:'POST',body:{action:'dispatch',requestId:id}});assert.equal(dispatched.operation.status,'failed');assert.equal(dispatched.operation.error_code,'auth');
 const again=await request('/api/inbox/linkedin/reply',{method:'POST',body:{action:'dispatch',requestId:id}});assert.equal(again.operation.status,'failed');
 await request('/api/inbox/linkedin/reply',{method:'POST',body:{action:'acknowledge',requestId:id},expected:409});
 const email=await request('/api/inbox?channel=email');assert.equal(email.replies.length,1);assert.equal(email.replies[0].channel,'email');
 db.transaction(()=>{db.exec("DELETE FROM run_profiles WHERE target_id='reply-lead';DELETE FROM logs WHERE target_id='reply-lead';DELETE FROM targets WHERE id='reply-lead'")})();
 const removed=await request('/api/inbox/linkedin/reply?id='+id);assert.equal(removed.operation.text,null);assert.equal(removed.operation.details_removed,1);
 assert.equal(db.prepare('SELECT count(*) n FROM accounts WHERE is_authenticated=1').get().n,0);
 const report={checks,liveAccounts:0,noDeliveryAttempt:true,emailCompatibility:true,tombstonePrivacy:true};if(process.env.REPLY_HTTP_REPORT_PATH)fs.writeFileSync(process.env.REPLY_HTTP_REPORT_PATH,JSON.stringify(report,null,2));console.log(JSON.stringify({checks:checks.length,noLiveAccounts:true,noDeliveryAttempt:true,emailCompatibility:true,tombstonePrivacy:true}));
}finally{db.close()}
