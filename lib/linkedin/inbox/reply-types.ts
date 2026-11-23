import type { Participant } from "./store.ts";
import type { InboxProvider } from "./provider.ts";
export type ReplyState="preparing"|"sending"|"sent"|"failed"|"unknown";
export interface ReplyAck {messageUrn:string;deliveredAt:number}
export interface ReplyInput {conversationUrn:string;mailboxUrn:string;text:string;originToken:string}
export interface ReplyProvider extends Pick<InboxProvider,"identity"|"list"> {send(input:ReplyInput,beforeWrite:()=>void):Promise<ReplyAck>}
export type ReplyProviderFactory=(accountId:string,deadlineAt:number)=>Promise<ReplyProvider>;
export interface ReplyBinding {id:string;account_id:string;target_id:string;provider_urn:string;peer_urn:string;self_urn:string|null;is_authenticated:number;account_name:string;session_revision:number}
export interface ReplyOperation {
 id:string;conversation_id:string|null;account_id:string|null;binding_hash:string;body_hash:string;text:string|null;status:ReplyState;
 created_at_ms:number;updated_at_ms:number;expires_at_ms:number;attempt_token:string|null;
 expected_session_revision:number|null;expected_self_urn:string|null;expected_peer_urn:string|null;expected_conversation_urn:string|null;expected_target_id:string|null;
 provider_urn:string|null;provider_at_ms:number|null;error_code:string|null;error_message:string|null;acknowledged_at_ms:number|null;details_removed:number;
}
export type PublicReply=Pick<ReplyOperation,"id"|"conversation_id"|"account_id"|"text"|"status"|"created_at_ms"|"updated_at_ms"|"provider_urn"|"provider_at_ms"|"error_code"|"error_message"|"acknowledged_at_ms"|"details_removed">&{can_dispatch:boolean};
export interface ReplyCapability {can_reply:boolean;code:string|null;reason:string|null;retry_at_ms:number|null;active_request_id:string|null}
export class ReplyError extends Error {
 status:number;code:string;
 constructor(status:number,code:string,message:string){super(message);this.name="ReplyError";this.status=status;this.code=code}
}
export const validRequestId=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export type VerifiedPeer=Participant;
