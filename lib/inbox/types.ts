export interface InboxReply {
  inbox_key?: string;
  linkedin_conversation_id?: string;
  linkedin_account_id?: string | null;
  linkedin_account_name?: string | null;
  last_message?: string;
  id: string;
  full_name: string | null;
  linkedin_url: string | null;
  email: string | null;
  headline: string | null;
  company: string | null;
  channel: "email" | "linkedin" | "both";
  replied_at: string;
  email_replied_at: string | null;
  last_replied_at: string | null;
  // run context
  run_id: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  // email account context
  email_account_id: string | null;
  email_account_name: string | null;
  email_account_from: string | null;
  // classifier / dispatcher context (from the most recent email_replies row)
  reply_id: string | null;
  reply_kind: string | null;
  reply_summary: string | null;
  reply_body: string | null;
  classified_at: string | null;
  classification_error: string | null;
  dispatched_at: string | null;
  dispatch_result_json: string | null;
  manually_edited: number;
}

