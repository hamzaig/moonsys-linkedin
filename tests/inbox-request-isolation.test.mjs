import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsx } from './helpers/tsx-loader.mjs';
import { fixture } from './helpers/inbox-fixture.mjs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('a previous sender response or failure cannot replace the selected sender result',async()=>{
 const {loadInboxReplies}=loadTsx('lib/inbox/loader.ts');const slot={current:null};const pending={};const shown=[];const errors=[];
 const fetcher=url=>new Promise((resolve,reject)=>{pending[url]={resolve,reject}});
 const callbacks={onData:data=>shown.push(data),onError:()=>errors.push('failed'),onSettled:()=>{}};
 const a=loadInboxReplies('A',slot,callbacks,fetcher);const b=loadInboxReplies('B',slot,callbacks,fetcher);
 pending.B.resolve({ok:true,json:async()=>({replies:['B']})});await b;pending.A.resolve({ok:true,json:async()=>({replies:['A']})});await a;assert.deepEqual(shown,[['B']]);
 const old=loadInboxReplies('A',slot,callbacks,fetcher);const latest=loadInboxReplies('B',slot,callbacks,fetcher);pending.B.resolve({ok:true,json:async()=>({replies:['new B']})});await latest;pending.A.reject(new Error('late A failure'));await old;assert.deepEqual(errors,[]);
});
test('legacy LinkedIn reply stamps remain unassigned and are excluded from a sender filter',t=>{
 const db=fixture(t);db.exec(`ALTER TABLE targets ADD COLUMN email TEXT;ALTER TABLE targets ADD COLUMN headline TEXT;ALTER TABLE targets ADD COLUMN company TEXT;
 ALTER TABLE run_profiles ADD COLUMN email_account_id TEXT;CREATE TABLE email_accounts(id TEXT,name TEXT,from_email TEXT);
 CREATE TABLE email_replies(id TEXT,target_id TEXT,received_at TEXT,classification_json TEXT,body_text TEXT,classified_at TEXT,classification_error TEXT,dispatched_at TEXT,dispatch_result_json TEXT,manually_edited INTEGER);
 UPDATE targets SET last_replied_at='2026-11-23T11:00:00Z';`);
 const {default:handler}=loadTsx('pages/api/inbox/index.ts',{'@/lib/db':{getDb:()=>db}});let payload;
 const res={json:value=>{payload=value},setHeader:()=>{}};
 handler({method:'GET',query:{channel:'linkedin'}},res);assert.equal(payload.replies.length,1);assert.equal(payload.replies[0].linkedin_account_id,null);assert.equal(payload.replies[0].run_id,null);
 handler({method:'GET',query:{channel:'linkedin',accountId:'a'}},res);assert.equal(payload.replies.length,0);
});
test('a stored incoming reply does not claim queued follow-ups were actually stopped',()=>{
 const {LinkedInThreadContent}=loadTsx('components/inbox/LinkedInThread.tsx');
 const html=renderToStaticMarkup(React.createElement(LinkedInThreadContent,{thread:{conversation:{account_name:'A',full_name:'Lead',provider_urn:'thread1',last_incoming_at_ms:1},messages:[]}}));
 assert.ok(html.includes('Incoming reply saved'));assert.ok(!html.includes('follow-ups stopped'));
});
