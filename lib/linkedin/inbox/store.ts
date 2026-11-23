import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface Participant { urn: string; profileUrl: string | null; memberUrn?: string | null }
export interface InboxMessage { urn: string; senderUrn: string; text: string; deliveredAt: number; unsupported?: boolean }
export interface InboxConversation { urn: string; self: Participant; participants: Participant[]; isGroup: boolean; messages: InboxMessage[] }
export interface StoredConversation {
  id: string; account_id: string; provider_urn: string; target_id: string;
  account_name: string; full_name: string | null; linkedin_url: string | null;
  last_message: string; last_message_at_ms: number; last_incoming_at_ms: number | null;
  run_id: string | null; workflow_id: string | null; workflow_name: string | null;
}
export interface StoredMessage { id: string; provider_urn: string; direction: "in" | "out"; text: string; delivered_at_ms: number; unsupported: number }

export function initInboxSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS linkedin_inbox_sync (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'never', attempted_at_ms INTEGER,
      success_at_ms INTEGER, retry_at_ms INTEGER, last_error_code TEXT, last_error TEXT,
      continuation TEXT, self_urn TEXT, lease_owner TEXT, lease_until_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS linkedin_conversations (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      provider_urn TEXT NOT NULL, target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
      peer_urn TEXT NOT NULL, last_message_at_ms INTEGER NOT NULL DEFAULT 0,
      last_incoming_at_ms INTEGER, UNIQUE(account_id, provider_urn)
    );
    CREATE TABLE IF NOT EXISTS linkedin_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES linkedin_conversations(id) ON DELETE CASCADE,
      provider_urn TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('in','out')),
      text TEXT NOT NULL, delivered_at_ms INTEGER NOT NULL, unsupported INTEGER NOT NULL DEFAULT 0,
      UNIQUE(conversation_id, provider_urn)
    );
    CREATE INDEX IF NOT EXISTS idx_linkedin_messages_thread_time ON linkedin_messages(conversation_id, delivered_at_ms);
    CREATE TABLE IF NOT EXISTS linkedin_reply_effects (
      message_id TEXT NOT NULL REFERENCES linkedin_messages(id) ON DELETE CASCADE,
      run_profile_id TEXT NOT NULL REFERENCES run_profiles(id) ON DELETE CASCADE,
      received_at_ms INTEGER NOT NULL, PRIMARY KEY(message_id,run_profile_id)
    );
    CREATE INDEX IF NOT EXISTS idx_linkedin_reply_profile ON linkedin_reply_effects(run_profile_id);
  `);
}

export function databaseTimeMs(value: string): number {
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value.replace(" ", "T")}Z`);
}
export function canonicalProfileUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/);
    return match ? `https://www.linkedin.com/in/${decodeURIComponent(match[1]).toLowerCase()}` : null;
  } catch { return null; }
}
export function profileKey(urn: string | null | undefined): string | null {
  return urn?.match(/^urn:li:(?:fsd_profile|fs_miniProfile|member):([^():,]+)$/)?.[1] ?? null;
}

type Enrollment = { id: string; run_id: string; target_id: string; created_at: string; full_name: string | null; linkedin_url: string | null; linkedin_member_urn: string | null };
export function matchCampaignContact(db: Database.Database, accountId: string, peer: Participant): Enrollment[] {
  const url = canonicalProfileUrl(peer.profileUrl);
  const member = peer.memberUrn?.match(/^urn:li:member:\d+$/)?.[0] ?? null;
  const rows = db.prepare(`SELECT rp.id,rp.run_id,rp.target_id,rp.created_at,t.full_name,t.linkedin_url,t.linkedin_member_urn
    FROM run_profiles rp JOIN runs r ON r.id=rp.run_id JOIN targets t ON t.id=rp.target_id
    WHERE r.account_id=?`).all(accountId) as Enrollment[];
  const matches = rows.filter(row => (url !== null && canonicalProfileUrl(row.linkedin_url) === url)
    || (member !== null && row.linkedin_member_urn === member));
  // Conflicting stable identifiers are not a reason to choose one candidate.
  return new Set(matches.map(row => row.target_id)).size === 1 ? matches : [];
}

export function ingestConversation(db: Database.Database, accountId: string, conversation: InboxConversation): { messagesAdded: number; tracksStopped: number } {
  const empty = { messagesAdded: 0, tracksStopped: 0 };
  if (conversation.isGroup || !conversation.urn || conversation.participants.length !== 2) return empty;
  const selfKey = profileKey(conversation.self.urn);
  const others = conversation.participants.filter(person => profileKey(person.urn) !== selfKey);
  if (!selfKey || others.length !== 1 || !profileKey(others[0].urn)) return empty;
  const peer = others[0]; const peerKey = profileKey(peer.urn);
  const enrollments = matchCampaignContact(db, accountId, peer);
  if (!enrollments.length) return empty;
  const earliest = Math.min(...enrollments.map(row => databaseTimeMs(row.created_at)));
  const messages = conversation.messages.filter(message => message.urn && Number.isFinite(message.deliveredAt)
    && message.deliveredAt >= earliest && (profileKey(message.senderUrn) === selfKey || profileKey(message.senderUrn) === peerKey));
  if (!messages.length) return empty;
  return db.transaction(() => {
    let messagesAdded = 0; let tracksStopped = 0;
    db.prepare(`INSERT INTO linkedin_conversations(id,account_id,provider_urn,target_id,peer_urn) VALUES(?,?,?,?,?)
      ON CONFLICT(account_id,provider_urn) DO NOTHING`).run(randomUUID(),accountId,conversation.urn,enrollments[0].target_id,peer.urn);
    const thread = db.prepare("SELECT id,target_id FROM linkedin_conversations WHERE account_id=? AND provider_urn=?").get(accountId,conversation.urn) as {id:string;target_id:string};
    if (thread.target_id !== enrollments[0].target_id) throw new Error("Conversation identity changed; sync requires review");
    for (const message of messages) {
      const incoming = profileKey(message.senderUrn) === peerKey;
      const text = message.unsupported ? "[Unsupported LinkedIn content]" : message.text.slice(0,100_000);
      const inserted = db.prepare(`INSERT INTO linkedin_messages(id,conversation_id,provider_urn,direction,text,delivered_at_ms,unsupported)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(conversation_id,provider_urn) DO NOTHING`).run(randomUUID(),thread.id,message.urn,incoming?"in":"out",text,message.deliveredAt,message.unsupported?1:0);
      messagesAdded += inserted.changes;
      db.prepare(`UPDATE linkedin_conversations SET last_message_at_ms=MAX(last_message_at_ms,?),
        last_incoming_at_ms=CASE WHEN ? THEN MAX(COALESCE(last_incoming_at_ms,0),?) ELSE last_incoming_at_ms END WHERE id=?`)
        .run(message.deliveredAt,incoming?1:0,message.deliveredAt,thread.id);
      if (!incoming) continue;
      const stored = db.prepare("SELECT id FROM linkedin_messages WHERE conversation_id=? AND provider_urn=?").get(thread.id,message.urn) as {id:string};
      for (const enrollment of enrollments) {
        if (message.deliveredAt < databaseTimeMs(enrollment.created_at)) continue;
        const effect = db.prepare(`INSERT INTO linkedin_reply_effects(message_id,run_profile_id,received_at_ms) VALUES(?,?,?)
          ON CONFLICT(message_id,run_profile_id) DO NOTHING`).run(stored.id,enrollment.id,message.deliveredAt);
        if (!effect.changes) continue;
        const stopped = db.prepare(`UPDATE run_profile_tracks SET state='skipped',next_step_at=NULL,pending_reply_context=NULL,
          error_message='Lead replied via LinkedIn' WHERE run_profile_id=? AND state IN ('pending','in_progress')`).run(enrollment.id).changes;
        tracksStopped += stopped;
        if (stopped) db.prepare("INSERT INTO logs(id,run_id,target_id,level,message) VALUES(?,?,?,'info',?)")
          .run(randomUUID(),enrollment.run_id,enrollment.target_id,`LinkedIn reply detected — stopped ${stopped} outreach track(s)`);
      }
    }
    return { messagesAdded, tracksStopped };
  })();
}

export function hasRunReply(db: Database.Database, runProfileId: string): boolean {
  return !!db.prepare("SELECT 1 FROM linkedin_reply_effects WHERE run_profile_id=? LIMIT 1").get(runProfileId);
}
export function listConversations(db: Database.Database, accountId?: string): StoredConversation[] {
  return db.prepare(`SELECT c.*,a.name AS account_name,t.full_name,t.linkedin_url,
    COALESCE((SELECT m.text FROM linkedin_messages m WHERE m.conversation_id=c.id ORDER BY m.delivered_at_ms DESC,m.id DESC LIMIT 1),'') AS last_message,
    (SELECT rp.run_id FROM run_profiles rp JOIN runs r ON r.id=rp.run_id WHERE rp.target_id=c.target_id AND r.account_id=c.account_id ORDER BY rp.created_at DESC LIMIT 1) AS run_id,
    (SELECT r.workflow_id FROM runs r JOIN run_profiles rp ON rp.run_id=r.id WHERE rp.target_id=c.target_id AND r.account_id=c.account_id ORDER BY rp.created_at DESC LIMIT 1) AS workflow_id,
    (SELECT w.name FROM workflows w JOIN runs r ON r.workflow_id=w.id JOIN run_profiles rp ON rp.run_id=r.id WHERE rp.target_id=c.target_id AND r.account_id=c.account_id ORDER BY rp.created_at DESC LIMIT 1) AS workflow_name
    FROM linkedin_conversations c JOIN accounts a ON a.id=c.account_id JOIN targets t ON t.id=c.target_id
    WHERE (? IS NULL OR c.account_id=?) ORDER BY c.last_message_at_ms DESC`).all(accountId??null,accountId??null) as StoredConversation[];
}
export function getStoredThread(db: Database.Database, id: string): { conversation: StoredConversation; messages: StoredMessage[] } | null {
  const conversation = listConversations(db).find(row => row.id === id);
  if (!conversation) return null;
  const messages = db.prepare("SELECT * FROM linkedin_messages WHERE conversation_id=? ORDER BY delivered_at_ms,id").all(id) as StoredMessage[];
  return { conversation,messages };
}
