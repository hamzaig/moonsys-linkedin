import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reserveAndDispatchReply,getReplyStatus,acknowledgeUnknownReply,dispatchSavedReply,ReplyDraftRegistry} from '../lib/inbox/reply-client.ts';
const intent=()=>({requestId:randomUUID(),conversationId:'stored-conversation',text:'A deliberate reply'});
const operation=(i,extra={})=>({id:i.requestId,conversation_id:i.conversationId,text:i.text,status:'preparing',can_dispatch:true,updated_at_ms:1,...extra});
const response=(op,status=200)=>({ok:status<300,status,json:async()=>({operation:op})});

test('one user Send reserves before dispatch with the same ID and immutable body',async()=>{
 const i=intent();const calls=[];const f=async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);return response(operation(i,body.action==='dispatch'?{status:'sent',can_dispatch:false}:{}));};
 const op=await reserveAndDispatchReply(i,new AbortController().signal,f);assert.equal(op.status,'sent');assert.deepEqual(calls.map(x=>x.action),['reserve','dispatch']);assert.equal(calls[0].requestId,calls[1].requestId);assert.equal(calls[0].text,i.text);assert.equal(calls[1].text,undefined);
});
test('closing between reservation and dispatch prevents a write request',async()=>{
 const i=intent(),controller=new AbortController();let calls=0;const f=async()=>{calls++;controller.abort();return response(operation(i));};
 await assert.rejects(reserveAndDispatchReply(i,controller.signal,f),e=>e.name==='AbortError');assert.equal(calls,1);
});
test('a lost reservation acknowledgment is recovered only with the same explicit intent',async()=>{
 const i=intent();let first=true;const sent=[];const f=async(_,options)=>{const body=JSON.parse(options.body);sent.push(body);if(first){first=false;throw Error('connection lost')}return response(operation(i,body.action==='dispatch'?{status:'sent'}:{}));};
 await assert.rejects(reserveAndDispatchReply(i,new AbortController().signal,f),e=>e.phase==='reserve');assert.equal(sent.length,1);
 await reserveAndDispatchReply(i,new AbortController().signal,f);assert.ok(sent.every(body=>body.requestId===i.requestId));assert.deepEqual(sent.map(x=>x.action),['reserve','reserve','dispatch']);
});
test('lost dispatch acknowledgment never initiates an automatic second write',async()=>{
 const i=intent();let calls=0;const f=async()=>{calls++;if(calls===2)throw Error('lost response');return response(operation(i))};
 await assert.rejects(reserveAndDispatchReply(i,new AbortController().signal,f),e=>e.phase==='dispatch');assert.equal(calls,2);
 let method;const saved=await getReplyStatus(i.requestId,new AbortController().signal,async(_,options)=>{method=options.method;return response(operation(i,{status:'unknown',can_dispatch:false}))});assert.equal(method,'GET');assert.equal(saved.status,'unknown');
});
test('replayed terminal or already-attempted reservation cannot dispatch',async()=>{
 for(const extra of [{status:'sent',can_dispatch:false},{status:'unknown',can_dispatch:false},{status:'preparing',can_dispatch:false},{status:'failed',can_dispatch:false}]){const i=intent();let calls=0;await reserveAndDispatchReply(i,new AbortController().signal,async()=>{calls++;return response(operation(i,extra))});assert.equal(calls,1);}
});
test('status, saved dispatch and uncertainty acknowledgment use explicit distinct actions',async()=>{
 const i=intent(),actions=[];const f=async(_,options)=>{actions.push(options.method==='GET'?'GET':JSON.parse(options.body).action);return response(operation(i,{status:'unknown',can_dispatch:false,acknowledged_at_ms:2}))};
 await getReplyStatus(i.requestId,new AbortController().signal,f);await dispatchSavedReply(i.requestId,new AbortController().signal,f);await acknowledgeUnknownReply(i.requestId,new AbortController().signal,f);assert.deepEqual(actions,['GET','dispatch','acknowledge']);
});
test('a mismatched operation identity fails before the next API action',async()=>{
 const i=intent();let calls=0;await assert.rejects(reserveAndDispatchReply(i,new AbortController().signal,async()=>{calls++;return response(operation({...i,requestId:randomUUID()}))}));assert.equal(calls,1);
});
test('drafts and recovery IDs remain isolated and only their exact operation can clear them',()=>{
 const drafts=new ReplyDraftRegistry();const a=intent();drafts.set('A',{text:'A draft',requestId:a.requestId});drafts.set('B',{text:'B draft'});
 drafts.apply('A',operation({...a,conversationId:'A'},{status:'sent'}));assert.deepEqual(drafts.get('A'),{text:''});assert.deepEqual(drafts.get('B'),{text:'B draft'});
 drafts.set('A',{text:'New text',requestId:'different'});drafts.apply('A',operation({...a,conversationId:'A'},{status:'sent'}));assert.equal(drafts.get('A').text,'New text');
});
test('unknown acknowledgment clears its draft without marking delivery confirmed',()=>{
 const drafts=new ReplyDraftRegistry(),i=intent();drafts.set(i.conversationId,{text:i.text,requestId:i.requestId});drafts.apply(i.conversationId,operation(i,{status:'unknown',acknowledged_at_ms:3}));assert.deepEqual(drafts.get(i.conversationId),{text:''});
});

test('definitive pre-reservation rejection unlocks editing; transport uncertainty retains its ID',async()=>{
 const {ReplyClientError}=await import('../lib/inbox/reply-client.ts');const drafts=new ReplyDraftRegistry(),i=intent();
 drafts.set(i.conversationId,{text:i.text,requestId:i.requestId});drafts.rejectReservation(i.conversationId,i.requestId,new ReplyClientError('busy','reserve',409,'conversation_busy'));assert.deepEqual(drafts.get(i.conversationId),{text:i.text});
 drafts.set(i.conversationId,{text:i.text,requestId:i.requestId});drafts.rejectReservation(i.conversationId,i.requestId,new ReplyClientError('network','reserve'));assert.equal(drafts.get(i.conversationId).requestId,i.requestId);
 drafts.rejectReservation(i.conversationId,'old-id',new ReplyClientError('invalid','reserve',400));assert.equal(drafts.get(i.conversationId).requestId,i.requestId);
});
test('authoritative thread deletion/access loss invalidates protected drafts but transient errors do not',async()=>{
 const {ReplyClientError,invalidateReplyThread}=await import('../lib/inbox/reply-client.ts');
 const drafts=new ReplyDraftRegistry();drafts.set('A',{text:'Private A'});drafts.set('B',{text:'Private B'});
 assert.equal(invalidateReplyThread(drafts,'A',new ReplyClientError('temporary','thread',500)),false);assert.equal(drafts.get('A').text,'Private A');
 assert.equal(invalidateReplyThread(drafts,'A',new ReplyClientError('deleted','thread',404)),true);assert.equal(drafts.get('A').text,'');assert.equal(drafts.get('B').text,'Private B');
 assert.equal(invalidateReplyThread(drafts,'B',new ReplyClientError('unauthorized','thread',401)),true);assert.equal(drafts.get('B').text,'');
});
test('thread loader rejects mismatched identities and reports authoritative HTTP status',async()=>{
 const {getReplyThread}=await import('../lib/inbox/reply-client.ts');const signal=new AbortController().signal;
 await assert.rejects(getReplyThread('A',signal,async()=>({ok:true,status:200,json:async()=>({conversation:{id:'B'}})})),e=>e.phase==='thread');
 await assert.rejects(getReplyThread('A',signal,async()=>({ok:false,status:404,json:async()=>({error:'Deleted'})})),e=>e.phase==='thread'&&e.status===404);
});
