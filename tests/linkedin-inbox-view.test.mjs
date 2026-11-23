import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,conversation,message } from './helpers/inbox-fixture.mjs';
import { ingestConversation } from '../lib/linkedin/inbox/store.ts';
import { getInboxAccounts, getLinkedInInboxRows, linkedInConversationUrl } from '../lib/linkedin/inbox/view.ts';

test('Inbox rows keep the target ID separate from conversation identity across senders',t=>{
 const db=fixture(t);ingestConversation(db,'a',conversation([message()]));ingestConversation(db,'b',conversation([message()]));
 const rows=getLinkedInInboxRows(db);assert.equal(rows.length,2);assert.equal(rows[0].id,'lead');assert.notEqual(rows[0].inbox_key,rows[1].inbox_key);assert.ok(rows[0].linkedin_conversation_id);assert.equal(rows[0].channel,'linkedin');
 assert.equal(getLinkedInInboxRows(db,'a').length,1);assert.equal(getLinkedInInboxRows(db,'b')[0].linkedin_account_name,'Account B');
});
test('account status distinguishes never checked from empty success and hides internal sync state',t=>{
 const db=fixture(t);db.exec("INSERT INTO linkedin_inbox_sync(account_id,status,success_at_ms,continuation,lease_owner) VALUES('a','ok',1795431600000,'PRIVATE-CURSOR','PRIVATE-LEASE')");
 const rows=getInboxAccounts(db);assert.equal(rows.find(r=>r.id==='a').status,'ok');assert.equal(rows.find(r=>r.id==='b').status,'never');assert.equal(rows[0].campaign_contacts,1);
 assert.ok(!JSON.stringify(rows).includes('PRIVATE'));assert.ok(!JSON.stringify(rows).includes('lease_owner'));
});
test('conversation links always point to LinkedIn and encode only supported thread identities',()=>{
 assert.equal(linkedInConversationUrl('urn:li:msg_conversation:(urn:li:fsd_profile:OWNER,thread-123)'),'https://www.linkedin.com/messaging/thread/thread-123/');
 assert.equal(linkedInConversationUrl('javascript:alert(1)'),null);
});
test('an outgoing-only conversation is shown without inventing a received reply or AI classification',t=>{
 const db=fixture(t);const owner=conversation([]).self;ingestConversation(db,'a',conversation([message('out',{senderUrn:owner.urn})]));
 const row=getLinkedInInboxRows(db)[0];assert.equal(row.last_replied_at,null);assert.equal(row.reply_kind,null);assert.equal(row.reply_id,null);assert.equal(row.last_message,'Can we discuss this?');
});
