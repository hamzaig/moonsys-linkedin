import {profileKey} from "./store.ts";
const profile="urn:li:(?:fsd_profile|fs_miniProfile|member):[A-Za-z0-9_-]+";
export function conversationIdentity(urn:string):{ownerUrn:string;localId:string}|null {
 const match=urn.match(/^urn:li:msg_conversation:\((urn:li:(?:fsd_profile|fs_miniProfile|member):[A-Za-z0-9_-]+),([A-Za-z0-9_-]+)\)$/);
 return match?{ownerUrn:match[1],localId:match[2]}:null;
}
export function messageIdentityMatches(urn:string,owner:string,conversationUrn:string):boolean {
 const match=urn.match(new RegExp(`^urn:li:msg_message:\\((${profile}),([A-Za-z0-9_-]+)(?:,([A-Za-z0-9_-]+))?\\)$`));
 const conversation=conversationIdentity(conversationUrn);
 return !!match&&!!conversation&&profileKey(match[1])===profileKey(owner)&&(!match[3]||match[2]===conversation.localId);
}
