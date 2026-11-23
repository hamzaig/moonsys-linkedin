import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTsx } from './helpers/tsx-loader.mjs';

test('LinkedIn thread renders escaped text, sender context and a read-only external reply link',()=>{
 const { LinkedInThreadContent }=loadTsx('components/inbox/LinkedInThread.tsx');
 const html=renderToStaticMarkup(React.createElement(LinkedInThreadContent,{thread:{conversation:{full_name:'Example Lead',account_name:'Account A',provider_urn:'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,thread-123)',last_incoming_at_ms:1795431600000},messages:[{id:'one',direction:'in',text:'<img src=x onerror="alert(1)">',delivered_at_ms:1795431600000,unsupported:0}]}}));
 assert.ok(html.includes('Account A'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('https://www.linkedin.com/messaging/thread/thread-123/'));assert.ok(!html.includes('<textarea'));assert.ok(!html.includes('>Send<'));
});
test('never-synced and authentication failure statuses do not claim an empty successful inbox',()=>{
 const { SyncStatusText }=loadTsx('components/inbox/LinkedInInboxControls.tsx');
 const never=renderToStaticMarkup(React.createElement(SyncStatusText,{account:{status:'never',campaign_contacts:2,success_at_ms:null}}));assert.ok(never.includes('Not checked yet'));
 const failed=renderToStaticMarkup(React.createElement(SyncStatusText,{account:{status:'auth_required',campaign_contacts:2,success_at_ms:null}}));assert.ok(failed.includes('Reconnect'));assert.ok(!failed.includes('Up to date'));
});
test('a successful but stale inbox check explicitly says LinkedIn messages are on hold',()=>{
 const { SyncStatusText }=loadTsx('components/inbox/LinkedInInboxControls.tsx');
 const html=renderToStaticMarkup(React.createElement(SyncStatusText,{account:{status:'ok',is_fresh:false,campaign_contacts:2,success_at_ms:1795431600000}}));
 assert.ok(html.includes('messages on hold'));
});
