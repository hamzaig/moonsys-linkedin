import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTsx} from './helpers/tsx-loader.mjs';
function html(extra={}){const {LinkedInReplyComposerView}=loadTsx('components/inbox/LinkedInReplyComposer.tsx');return renderToStaticMarkup(React.createElement(LinkedInReplyComposerView,{sender:'Account A',text:'Hello',disabled:false,busy:false,error:'',onText:()=>{},onSend:()=>{},...extra}));}

test('composer has visible sender and label, explicit Send and existing MoonSys colors',()=>{
 const s=html();assert.ok(s.includes('Reply as Account A'));assert.ok(s.includes('<label'));assert.ok(s.includes('maxLength="3000"')||s.includes('maxlength="3000"'));assert.ok(s.includes('type="button"'));assert.ok(s.includes('>Send<'));assert.ok(s.includes('bg-accent'));assert.ok(!s.includes('<form'));
});
test('disconnected/busy composer is disabled with visible feedback and escaped text',()=>{
 const s=html({text:'<script>private</script>',disabled:true,busy:true,error:'Reconnect LinkedIn'});assert.ok(s.includes('disabled=""'));assert.ok(s.includes('aria-busy="true"'));assert.ok(s.includes('Reconnect LinkedIn'));assert.ok(s.includes('&lt;script&gt;'));assert.ok(!s.includes('<script>'));
});
test('unconfirmed send is never represented as sent or given an automatic Retry button',()=>{
 const {ReplySendStatus}=loadTsx('components/inbox/LinkedInReplyComposer.tsx');const s=renderToStaticMarkup(React.createElement(ReplySendStatus,{operation:{status:'unknown',text:'Saved reply',error_message:'Check LinkedIn',acknowledged_at_ms:null},onAcknowledge:()=>{},onSavedSend:()=>{}}));
 assert.ok(s.includes('Delivery unconfirmed'));assert.ok(s.includes('I checked LinkedIn'));assert.ok(!s.includes('>Sent<'));assert.ok(!s.includes('>Retry<'));
});

test('reopening renders recent outcomes and offers explicit failed-text restoration',()=>{
 const {ReplySendHistory}=loadTsx('components/inbox/LinkedInReplyComposer.tsx');
 const operations=[{id:'failed-one',status:'failed',text:'Restore this draft',created_at_ms:2},{id:'sent-one',status:'sent',text:'Older acknowledged reply',created_at_ms:1}];
 const s=renderToStaticMarkup(React.createElement(ReplySendHistory,{operations,busy:false,canSend:true,canRestore:true,onAcknowledge:()=>{},onSavedSend:()=>{},onRestore:()=>{}}));
 assert.ok(s.includes('Restore this draft'));assert.ok(s.includes('Older acknowledged reply'));assert.ok(s.includes('Use failed reply'));assert.ok(s.includes('Recent replies'));
});
test('live feedback distinguishes status and acknowledgment from actual sending, including errors',()=>{
 const {replyActivityText}=loadTsx('components/inbox/LinkedInReplyComposer.tsx');
 assert.ok(!replyActivityText('status','',null).toLowerCase().includes('sending'));assert.ok(!replyActivityText('ack','',null).toLowerCase().includes('sending'));
 assert.equal(replyActivityText(null,'Reservation rejected',null),'Reservation rejected');assert.ok(replyActivityText('new','',null).toLowerCase().includes('sending'));
});
