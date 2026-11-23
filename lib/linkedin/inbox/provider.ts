import type { InboxMessage, Participant } from "./store.ts";

export interface ConversationSummary { urn: string; participants: Participant[]; isGroup: boolean; lastActivityAt: number }
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
function profileUrn(value: unknown): string | null {
  return string(value)?.match(/urn:li:(?:fsd_profile|fs_miniProfile|member):[^():,]+$/)?.[0]?.replace("fs_miniProfile", "fsd_profile") ?? null;
}
function reader(json: unknown) {
  const envelope=object(json); const first=object(envelope.data); const data=Object.keys(object(first.data)).length?object(first.data):Object.keys(first).length?first:envelope;
  const index=new Map(array(envelope.included).map(value=>{const row=object(value);return [string(row.entityUrn),row] as const}));
  const resolve=(value: unknown): RecordValue=>{
    if(typeof value!=="string")return object(value);
    const row=index.get(value);if(!row)throw new ProviderError("unsupported","Missing LinkedIn normalized reference");return row;
  };
  const elements=(root: RecordValue): RecordValue[]=>{
    const values=root["*elements"]??root.elements;
    if(!Array.isArray(values))throw new ProviderError("unsupported","Unsupported LinkedIn collection response");
    return values.map(resolve);
  };
  return {envelope,data,resolve,elements};
}
function participant(value: unknown, resolve: (v: unknown)=>RecordValue): Participant | null {
  const row=resolve(value);const member=object(object(row.participantType).member);
  const mini=resolve(member["*miniProfile"]??member.miniProfile??{});
  const urn=profileUrn(row.hostIdentityUrn??row.profileUrn??mini.dashEntityUrn??mini.entityUrn??row.entityUrn);
  if(!urn)return null;
  const identifier=string(mini.publicIdentifier);
  return {urn,profileUrl:string(member.profileUrl??row.profileUrl)??(identifier?`https://www.linkedin.com/in/${encodeURIComponent(identifier)}/`:null),memberUrn:string(mini.objectUrn??member.objectUrn)};
}
export function parseConversationPage(json: unknown): { conversations: ConversationSummary[]; nextCursor: string | null } {
  const r=reader(json);
  const root=object(r.data.messengerConversationsByCategoryQuery??r.data.messengerConversationsByCategory??r.data.messengerConversationsBySyncToken);
  if(!Object.keys(root).length)throw new ProviderError("unsupported","Unsupported LinkedIn conversation response");
  const conversations=r.elements(root).map(row=>{
    const urn=string(row.entityUrn);const at=row.lastActivityAt;
    const raw=row["*conversationParticipants"]??row.conversationParticipants;
    if(!urn||typeof at!=="number"||!Array.isArray(raw))throw new ProviderError("unsupported","Unsupported LinkedIn conversation identity");
    const participants=raw.map(p=>participant(p,r.resolve)).filter((p):p is Participant=>p!==null);
    return {urn,participants,isGroup:row.groupChat===true||raw.length>2||participants.length!==raw.length,lastActivityAt:at};
  });
  return {conversations,nextCursor:string(object(root.metadata).nextCursor)};
}
export function parseMessagePage(json: unknown): { messages: InboxMessage[]; nextCursor: string | null } {
  const r=reader(json);const root=object(r.data.messengerMessagesBySyncToken??r.data.messengerMessagesByConversation??r.data);
  const messages: InboxMessage[]=[];
  for(const row of r.elements(root)){
    const event=object(object(row.eventContent)["com.linkedin.voyager.messaging.event.MessageEvent"]);
    const body=object(row.body??event.attributedBody);const hasBody=typeof body.text==="string";
    const content=array(row.renderContentUnions??event.attachments);
    // Delivery, reaction and membership records are not human replies.
    if(!hasBody&&!content.length)continue;
    const sender=r.resolve(row["*sender"]??row.sender??{});
    const legacyMember=object(object(row.from)["com.linkedin.voyager.messaging.MessagingMember"]);
    const mini=r.resolve(legacyMember["*miniProfile"]??legacyMember.miniProfile??{});
    const senderUrn=profileUrn(row.senderUrn??sender.hostIdentityUrn??sender.entityUrn??mini.dashEntityUrn??mini.entityUrn);
    const urn=string(row.entityUrn??row.backendUrn);const at=row.deliveredAt??row.createdAt;
    if(!senderUrn||!urn||typeof at!=="number"||!Number.isFinite(at))throw new ProviderError("unsupported","Unsupported LinkedIn message identity");
    messages.push({urn,senderUrn,text:hasBody?String(body.text):"",deliveredAt:at,unsupported:!hasBody||(!body.text&&content.length>0)});
  }
  return {messages,nextCursor:string(object(root.metadata).nextCursor)};
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
    if(!urn)throw new ProviderError("unsupported","Unsupported LinkedIn identity response");
    self={urn,profileUrl:identifier?`https://www.linkedin.com/in/${encodeURIComponent(identifier)}/`:null};return self;
  };
  return {identity,
    async list(cursor){const owner=await identity();const variables=`(query:(predicateUnions:List((conversationCategoryPredicate:(category:INBOX)))),count:20,mailboxUrn:${encodeURIComponent(owner.urn)}${cursor?`,nextCursor:${encodeURIComponent(cursor)}`:""})`;
      return parseConversationPage(await read(`/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${encodeURIComponent(queryId)}&variables=${variables}`));},
    async messages(conversation,cursor){return parseMessagePage(await read(`/voyager/api/voyagerMessagingDashMessengerMessages?q=conversation&conversationUrn=${encodeURIComponent(conversation.urn)}&count=50${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`));}
  };
}
