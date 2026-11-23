import type { InboxMessage, Participant } from "./store.ts";

export interface ConversationSummary { urn: string; participants: Participant[]; isGroup: boolean; oneToOneVerified?: boolean; lastActivityAt: number }
export interface InboxProvider {
  identity(): Promise<Participant>;
  list(cursor?: string | null): Promise<{ conversations: ConversationSummary[]; nextCursor: string | null }>;
  messages(conversation: ConversationSummary, cursor?: string | null): Promise<{ messages: InboxMessage[]; nextCursor: string | null }>;
}
export class ProviderError extends Error {
  code: string; status?: number; retryAfterMs?: number;
  constructor(code: string, message: string, status?: number, retryAfterMs?: number) {
    super(message); this.name="ProviderError"; this.code=code; this.status=status; this.retryAfterMs=retryAfterMs;
  }
}
export type ReadTransport = (path: string) => Promise<{ status: number; json: unknown; retryAfterMs?: number }>;
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const unsupported=(message:string):never=>{throw new ProviderError("unsupported",`Unsupported LinkedIn ${message}`)};
function profileUrn(value: unknown): string | null {
  return string(value)?.match(/urn:li:(?:fsd_profile|fs_miniProfile|member):[^():,]+$/)?.[0]?.replace("fs_miniProfile", "fsd_profile") ?? null;
}
function reader(json: unknown) {
  const envelope=object(json); const first=object(envelope.data);
  const data=Object.keys(object(first.data)).length?object(first.data):Object.keys(first).length?first:envelope;
  for(const part of [envelope,first,data])if(part.errors!==undefined&&(!Array.isArray(part.errors)||part.errors.length))unsupported("partial GraphQL response");
  const index=new Map(array(envelope.included).map(value=>{const row=object(value);return [string(row.entityUrn),row] as const}));
  const resolve=(value: unknown): RecordValue=>{
    if(typeof value!=="string")return object(value);
    const row=index.get(value);if(!row)throw new ProviderError("unsupported","Missing LinkedIn normalized reference");return row;
  };
  const elements=(root: RecordValue): RecordValue[]=>{
    const values=root["*elements"]??root.elements;
    if(!Array.isArray(values))return unsupported("collection response");
    return values.map(resolve);
  };
  return {envelope,data,resolve,elements};
}
function nextCursor(root:RecordValue):string|null {
  const metadata=object(root.metadata);
  if(!Object.hasOwn(metadata,"nextCursor")||(metadata.nextCursor!==null&&(typeof metadata.nextCursor!=="string"||!metadata.nextCursor)))return unsupported("pagination metadata");
  return metadata.nextCursor as string|null;
}
function participant(value: unknown, resolve: (v: unknown)=>RecordValue): Participant {
  const row=resolve(value);const member=object(object(row.participantType).member);
  const mini=resolve(member["*miniProfile"]??member.miniProfile??{});
  const urn=profileUrn(row.hostIdentityUrn??row.profileUrn??mini.dashEntityUrn??mini.entityUrn??row.entityUrn);
  if(!urn)return unsupported("participant identity");
  const identifier=string(mini.publicIdentifier);
  return {urn,profileUrl:string(member.profileUrl??row.profileUrl)??(identifier?`https://www.linkedin.com/in/${encodeURIComponent(identifier)}/`:null),memberUrn:string(mini.objectUrn??member.objectUrn)};
}
export function parseConversationPage(json: unknown): { conversations: ConversationSummary[]; nextCursor: string | null } {
  const r=reader(json);
  const root=object(r.data.messengerConversationsByCategoryQuery??r.data.messengerConversationsByCategory??r.data.messengerConversationsBySyncToken);
  if(!Object.keys(root).length)return unsupported("conversation response");
  const conversations=r.elements(root).map(row=>{
    const urn=string(row.entityUrn);const at=row.lastActivityAt;
    const raw=row["*conversationParticipants"]??row.conversationParticipants;
    if(!urn||typeof at!=="number"||!Number.isFinite(at)||!Array.isArray(raw)||!raw.length)return unsupported("conversation identity");
    const participants=raw.map(p=>participant(p,r.resolve));
    return {urn,participants,isGroup:row.groupChat===true||raw.length>2,oneToOneVerified:row.groupChat===false&&raw.length===2,lastActivityAt:at};
  });
  return {conversations,nextCursor:nextCursor(root)};
}
const systemTypes=new Set(["REACTION","READ_RECEIPT","DELIVERY_RECEIPT","MEMBER_JOINED","MEMBER_LEFT","CONVERSATION_RENAMED"]);
const systemContent=new Set(["com.linkedin.voyager.messaging.event.ReactionEvent","com.linkedin.voyager.messaging.event.ParticipantChangeEvent","com.linkedin.voyager.messaging.event.ConversationNameUpdateEvent"]);
export function parseMessagePage(json: unknown): { messages: InboxMessage[]; nextCursor: string | null } {
  const r=reader(json);const root=object(r.data.messengerMessagesBySyncToken??r.data.messengerMessagesByConversation??r.data);
  const rows=r.elements(root);const messages: InboxMessage[]=[];
  for(const row of rows){
    const eventType=string(row.eventType);const eventContent=object(row.eventContent);
    // Only explicit, recognized non-human events may be ignored, even if they carry display text.
    if((eventType&&systemTypes.has(eventType))||Object.keys(eventContent).some(type=>systemContent.has(type)))continue;
    if(eventType&&eventType!=="MESSAGE")return unsupported("message event type");
    const event=object(eventContent["com.linkedin.voyager.messaging.event.MessageEvent"]);
    if(row.$type!==undefined&&row.$type!=="com.linkedin.messenger.Message"&&!Object.keys(event).length)return unsupported("message record type");
    const body=object(row.body??event.attributedBody);const text=string(body.text)??string(event.body);
    const content=array(row.renderContentUnions??event.attachments);
    if(text===null&&!content.length)return unsupported("message content");
    const sender=r.resolve(row["*sender"]??row.sender??{});
    const legacyMember=object(object(row.from)["com.linkedin.voyager.messaging.MessagingMember"]);
    const mini=r.resolve(legacyMember["*miniProfile"]??legacyMember.miniProfile??{});
    const senderUrn=profileUrn(row.senderUrn??sender.hostIdentityUrn??sender.entityUrn??mini.dashEntityUrn??mini.entityUrn);
    const urn=string(row.entityUrn??row.backendUrn);const at=row.deliveredAt??row.createdAt;
    if(!senderUrn||!urn||typeof at!=="number"||!Number.isFinite(at))return unsupported("message identity");
    messages.push({urn,senderUrn,text:text??"",deliveredAt:at,unsupported:text===null||(!text&&content.length>0)});
  }
  if(Object.hasOwn(root,"paging")){
    const paging=object(root.paging);
    if(typeof paging.count!=="number"||!Number.isFinite(paging.count)||paging.count<=0||typeof paging.start!=="number")return unsupported("event pagination");
    const times=rows.map(row=>row.createdAt??row.deliveredAt);
    if(times.some(at=>typeof at!=="number"||!Number.isFinite(at)))return unsupported("event timestamp");
    // Legacy events use an exclusive createdBefore timestamp. A full page overlaps
    // its last millisecond so events with equal timestamps cannot be silently lost.
    const cursor=times.length?String(Math.min(...times as number[])+(rows.length>=50?1:0)):null;
    return {messages,nextCursor:cursor};
  }
  return {messages,nextCursor:nextCursor(root)};
}
export function createLinkedInProvider(transport: ReadTransport, queryId="messengerConversations.9501074288a12f3ae9e3c7ea243bccbf"): InboxProvider {
  let self: Participant | null=null;
  async function read(path: string): Promise<unknown> {
    if(!path.startsWith("/voyager/api/")||path.includes("://"))throw new ProviderError("unsupported","Invalid LinkedIn request path");
    let result;try{result=await transport(path)}catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError("network","LinkedIn could not be reached")}
    if([301,302,303,307,308,401,403].includes(result.status))throw new ProviderError("auth","Reconnect LinkedIn to read messages",result.status);
    if(result.status===429)throw new ProviderError("rate_limit","LinkedIn requested a pause",429,result.retryAfterMs);
    if(result.status<200||result.status>=300)throw new ProviderError("network","LinkedIn inbox is temporarily unavailable",result.status);
    return result.json;
  }
  const identity=async()=>{
    if(self)return self;
    const r=reader(await read("/voyager/api/me"));const row=r.resolve(r.data["*miniProfile"]??r.data.miniProfile??{});
    const urn=profileUrn(row.dashEntityUrn??row.entityUrn);const identifier=string(row.publicIdentifier);
    if(!urn)return unsupported("identity response");
    self={urn,profileUrl:identifier?`https://www.linkedin.com/in/${encodeURIComponent(identifier)}/`:null};return self;
  };
  return {identity,
    async list(cursor){const owner=await identity();const variables=`(query:(predicateUnions:List((conversationCategoryPredicate:(category:INBOX)))),count:20,mailboxUrn:${encodeURIComponent(owner.urn)}${cursor?`,nextCursor:${encodeURIComponent(cursor)}`:""})`;
      return parseConversationPage(await read(`/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${encodeURIComponent(queryId)}&variables=${variables}`));},
    async messages(conversation,cursor){
      const id=conversation.urn.match(/,([^(),]+)\)$/)?.[1]??conversation.urn.match(/^(?:urn:li:(?:fs_conversation|msg_conversation):)?([A-Za-z0-9_-]+)$/)?.[1];
      if(!id||(cursor&&!/^\d+$/.test(cursor)))return unsupported("thread pagination identity");
      return parseMessagePage(await read(`/voyager/api/messaging/conversations/${encodeURIComponent(id)}/events?keyVersion=LEGACY_INBOX&q=events&count=50${cursor?`&createdBefore=${cursor}`:""}`));
    }
  };
}
