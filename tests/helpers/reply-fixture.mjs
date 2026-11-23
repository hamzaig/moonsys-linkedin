import { fixture,conversation,message,self,peer,timestamp } from './inbox-fixture.mjs';
import { ingestConversation } from '../../lib/linkedin/inbox/store.ts';
import { initReplySchema } from '../../lib/linkedin/inbox/reply-store.ts';
export {self,peer,timestamp};
export const replyNow=timestamp+3600000;
export function replyFixture(t){
 const db=fixture(t);initReplySchema(db);const urn=`urn:li:msg_conversation:(${self.urn},thread-1)`;
 ingestConversation(db,'a',conversation([message()],{urn}));db.prepare("INSERT INTO linkedin_inbox_sync(account_id,self_urn) VALUES('a',?)").run(self.urn);
 const id=db.prepare('SELECT id FROM linkedin_conversations').get().id;
 return {db,id,urn};
}
