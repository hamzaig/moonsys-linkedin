import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

import type { InboxReply } from "@/lib/inbox/types";
export type { InboxReply } from "@/lib/inbox/types";
import { getLinkedInInboxRows } from "@/lib/linkedin/inbox/view";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = getDb();
  const channel = req.query.channel as string | undefined; // "email" | "linkedin" | undefined

  // A target shows in the inbox if it has a reply stamp OR a captured email_replies row.
  // OOO-followup replies intentionally leave email_replied_at NULL, so we must include
  // the email_replies source to keep scheduled follow-ups visible.
  let channelFilter =
    "AND (t.email_replied_at IS NOT NULL OR t.last_replied_at IS NOT NULL OR er.id IS NOT NULL)";
  if (channel === "email") channelFilter = "AND (t.email_replied_at IS NOT NULL OR er.id IS NOT NULL)";
  if (channel === "linkedin") channelFilter = "AND t.last_replied_at IS NOT NULL";

  const rows = db.prepare(`
    SELECT
      t.id,
      t.full_name,
      t.linkedin_url,
      t.email,
      t.headline,
      t.company,
      t.email_replied_at,
      t.last_replied_at,
      CASE
        WHEN (t.email_replied_at IS NOT NULL OR er.id IS NOT NULL) AND t.last_replied_at IS NOT NULL THEN 'both'
        WHEN t.email_replied_at IS NOT NULL OR er.id IS NOT NULL THEN 'email'
        ELSE 'linkedin'
      END AS channel,
      MAX(
        COALESCE(t.email_replied_at, ''),
        COALESCE(t.last_replied_at, ''),
        COALESCE(er.received_at, '')
      ) AS replied_at,
      CASE WHEN t.email_replied_at IS NOT NULL OR er.id IS NOT NULL THEN r.id ELSE NULL END AS run_id,
      NULL AS linkedin_account_id,
      NULL AS linkedin_account_name,
      CASE WHEN t.email_replied_at IS NOT NULL OR er.id IS NOT NULL THEN r.workflow_id ELSE NULL END AS workflow_id,
      CASE WHEN t.email_replied_at IS NOT NULL OR er.id IS NOT NULL THEN w.name ELSE NULL END AS workflow_name,
      ea.id AS email_account_id,
      ea.name AS email_account_name,
      ea.from_email AS email_account_from,
      er.id AS reply_id,
      er.classification_json AS classification_json,
      er.body_text AS reply_body,
      er.classified_at,
      er.classification_error,
      er.dispatched_at,
      er.dispatch_result_json,
      COALESCE(er.manually_edited, 0) AS manually_edited
    FROM targets t
    LEFT JOIN run_profiles rp ON rp.target_id = t.id
    LEFT JOIN runs r ON r.id = rp.run_id AND r.status IN ('running', 'paused', 'completed')
    LEFT JOIN workflows w ON w.id = r.workflow_id
    LEFT JOIN email_accounts ea ON ea.id = rp.email_account_id
    LEFT JOIN (
      SELECT er1.* FROM email_replies er1
      WHERE er1.received_at = (
        SELECT MAX(er2.received_at) FROM email_replies er2 WHERE er2.target_id = er1.target_id
      )
    ) er ON er.target_id = t.id
    WHERE 1=1
    ${channelFilter}
    GROUP BY t.id
    ORDER BY replied_at DESC
  `).all() as Array<InboxReply & { classification_json: string | null }>;

  const replies: InboxReply[] = rows.map((row) => {
    let reply_kind: string | null = null;
    let reply_summary: string | null = null;
    if (row.classification_json) {
      try {
        const cls = JSON.parse(row.classification_json) as { kind?: string; summary?: string };
        reply_kind = cls.kind ?? null;
        reply_summary = cls.summary ?? null;
      } catch { /* malformed — leave null */ }
    }
    const { classification_json: _omit, ...rest } = row;
    void _omit;
    return { ...rest, reply_kind, reply_summary };
  });

  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const combined = [...replies, ...(channel === "email" ? [] : getLinkedInInboxRows(db, accountId))]
    .filter(reply => !accountId || reply.linkedin_account_id === accountId)
    .sort((a, b) => new Date(b.replied_at).getTime() - new Date(a.replied_at).getTime());
  return res.json({ replies: combined });
}
