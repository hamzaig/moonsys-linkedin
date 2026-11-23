# MoonSys LinkedIn: automatic message reading

Status: owner approved on 2026-11-23 via “Approve — feature 1 implement karein”. Implementation is authorized within this design.

## Intent

The owner wants a MoonSys product with the most useful HeyReach-style features delivered one at a time. The first feature is automatic reading of incoming LinkedIn campaign conversations, with a usable Inbox and stop-on-reply behavior. Keep the MoonSys brand and build our own implementation.

The owner has requested this feature and project-level Superpowers installation. The implementation approach and details below are proposals, not previously approved decisions.

## Existing behavior

- Multiple LinkedIn accounts have separate saved sessions, schedules and limits. Each campaign run belongs to one account.
- The runner polls every 30 seconds. Message steps already support fixed content/templates and timed follow-ups after connection acceptance.
- LinkedIn reply sync currently goes through the absent `ee` premium module. `/api/premium-status` confirms `hasPremium: false`.
- The existing Inbox obtains reply contacts from `targets.last_replied_at`, `targets.email_replied_at` and `email_replies`. Its thread endpoint and reply composer currently handle email, not LinkedIn conversations.
- The current campaign contains a 24-hour delay and a connection step, without message steps. This feature must not add steps, send test invitations/messages or change its schedule.
- Target-level reply timestamps are shared across accounts. They cannot be the only source of truth for the new multi-account LinkedIn flow.

## Approaches

1. **Existing-session API reader — proposed.** Use the account's existing authenticated session to make read-only LinkedIn requests. Add our own account-scoped storage, sync worker and Inbox presentation. This fits the current app and avoids another provider/account setup.
2. **External messaging provider.** Adds a provider dependency, new credentials and potentially cost. Reconsider if the current session API cannot be made reliable; do not silently switch or subscribe.
3. **Browser UI scraping.** Requires navigation, selectors and scrolling, and conflicts with the owner's current preference against autonomous browser UI automation. Excluded from this implementation.

The first approach is the proposed choice. LinkedIn's internal payloads/endpoints need read-only verification during implementation. An unsupported response must produce a visible sync failure; an empty or guessed parser must never be reported as a successful sync.

## User flow

```text
Connected LinkedIn account
  -> periodic read-only sync
  -> match exact campaign-contact identity
  -> save conversation and incoming/outgoing messages
  -> qualifying incoming reply stops that account's queued outreach for the lead
  -> Inbox shows sender account, campaign, message and last sync status
  -> owner opens the stored conversation to read the thread
```

Inbox sketch:

```text
Inbox                         [All senders v] [Sync now]
Last checked: 2 minutes ago / Sync failed: reconnect account

Contact        Sender account   Campaign     Latest message    Received
Example lead   Sales account    Campaign A   Can we discuss...  10:30

Selected conversation
  Incoming and outgoing messages in timestamp order
  "Follow-ups stopped: lead replied"
  [Open conversation on LinkedIn]
```

## First-feature scope

### Reading and identity

- Read supported one-to-one regular LinkedIn conversations for campaign contacts across authenticated accounts, including contacts in completed campaigns so later replies remain visible.
- Match stable profile/member identifiers or exact canonical LinkedIn profile URLs. Do not match by display name alone. Require a fresh participant identity check; a legacy `messaging_urn` inferred by older name-based matching is not sufficient evidence by itself. Ambiguous matches must not store a message under a guessed lead or stop outreach.
- Identify the account owner and distinguish outgoing messages from incoming messages. Ignore group conversations, system events and ambiguous identities for stop-on-reply decisions.
- Read both sides of a matched thread for useful conversation context, but persist/display only messages at or after that account/contact's earliest relevant campaign enrollment. Do not import pre-enrollment private history, unrelated personal conversations, authentication cookies or complete raw inbox responses.
- Support pagination and incremental sync. Retain progress across bounded batches; incomplete scans do not advance a successful-sync watermark or claim complete freshness.
- Use stored provider message identifiers for idempotency. Repeating a sync must not duplicate conversations, messages or reply effects.
- First-sync backfill starts at campaign enrollment, not the beginning of a private thread. Evaluate reply eligibility separately for each run: the incoming message must be at or after that run profile's enrollment time. A reply qualifying for an old completed run does not stop a newer run enrolled after that reply.
- Attach messages and reply effects to the actual sender account and campaign/run context. A shared contact's reply on account A must not automatically stop account B's campaign through a global LinkedIn reply stamp.

### Stop-on-reply

- In one SQLite transaction, store each qualifying reply and stop pending/in-progress outreach tracks for that contact in campaigns belonging to the receiving account and satisfying the per-run enrollment boundary. Stop both LinkedIn and email tracks in those campaigns, clear scheduled times and pending reply context, and record the reason.
- Retain completed/failed/skipped history. Do not stop the whole campaign or unrelated contacts/accounts.
- Add an account/run-scoped reply guard to the runner before executing queued outreach. Preserve existing email-reply handling and already stopped track states.
- A complete successful LinkedIn sync remains fresh for ten minutes. Before any regular LinkedIn message step, including the first message, a failed required preflight check or inbox state older than ten minutes holds that message for the affected account with a visible reason; do not mark it sent or permanently fail the lead. Retry after a successful sync.
- Connection requests and profile visits retain existing schedules and limits. Email and Sales Navigator InMail steps keep their existing freshness rules. A saved qualifying LinkedIn reply still stops both tracks of the affected run; this first feature does not promise LinkedIn-synced reply detection for Sales Navigator's separate inbox.
- Existing global `targets.last_replied_at` flags remain legacy compatibility data for the current Inbox/guard. Do not copy them into account-scoped message storage, infer an account from them, overwrite them with new LinkedIn sync results, or use them as participant-match evidence. The new flow's account isolation applies to newly verified replies; old unscoped flags retain their existing behavior until a separately agreed migration.
- This is periodic detection, not an instant webhook guarantee. A message arriving after the most recent successful check may be discovered on the next cycle. UI status must make the last check visible.

### Worker and failures

- Target a five-minute automatic interval with per-account staggering; make `Sync now` available.
- Prevent overlapping automatic/manual sync for the same account. Maintain separate state per account.
- Run the sync worker independently of the sender loop so a slow mailbox does not block all senders. Use the app's global process guard pattern to avoid duplicate workers during development reloads.
- Bound request time and work per cycle. Store last attempt, last complete success, continuation state and a sanitized error.
- Authentication failures require reconnection. Rate limits and temporary network/server failures back off with a visible retry state; do not mark an account healthy or advance its watermark after failure.
- No browser UI fallback, sending messages, marking provider messages read, deleting conversations or other LinkedIn writes as part of sync.

### Storage and APIs

- Add focused account-scoped conversation/message/reply-effect storage and sync-state migrations following `lib/db.ts` conventions.
- Preserve current data and take a local SQLite backup before applying live migrations. Verify migration idempotency using fixtures first.
- Extend the existing Inbox API without breaking email responses. Add authenticated endpoints for stored LinkedIn threads and manual sync/status. Keep existing authentication middleware and session handling.
- Return sender account and campaign context so the UI uses a conversation/account key, rather than assuming one row per global contact ID.
- Keep messages as plain text in the UI; do not render provider HTML. Do not log message bodies, cookies or secrets.

### Interface

- Retain current MoonSys components, local fonts and theme.
- Show LinkedIn conversations, account filter, received time, last message, sync status and stored thread content.
- Preserve email thread/composer behavior. The new LinkedIn thread is read-only in this first feature, with an external link for the owner's manual reply on LinkedIn.
- Display partial sync, authentication, backoff and fetch failures plainly. Empty state must distinguish no replies from an account that has never synced successfully.

## Constraints

- Next.js 16.1.6 Pages Router, React 19, TypeScript and Node.js 22; keep existing Tailwind 4/DaisyUI 5 setup.
- No new paid service, subscription or AI model calls.
- Preserve the scheduler fix, its tests, current branding changes and the live campaign's steps/times.
- No unsolicited test messages or invitations. Validate mutations and reply cancellation with isolated SQLite fixtures.
- Use CLI, APIs and code-level checks; do not automate computer/browser UI.
- Stay local unless the owner separately requests publishing/deployment.

## Acceptance evidence

1. Duplicate/overlapping sync, pagination, stale/out-of-order messages, own messages, system/group events, unknown payloads and exact identity matching have meaningful tests.
2. An incoming fixture reply is stored once and stops only the correct account/contact's pending work across both campaign tracks, atomically. Old history and outgoing messages do not stop work.
3. A repeat sync and a process restart retain consistent state. A failed/incomplete sync does not claim success or consume unread information.
4. The runner checks the account-scoped reply guard and holds message follow-ups when the required inbox state is unavailable; the existing 11 scheduler tests still pass.
5. Inbox list, account filter, thread endpoint and sync status use the same stored data. Existing email behavior and API authentication remain intact.
6. TypeScript, relevant lint comparison and an isolated production build pass. Verify the real account's read-only connection and supported payload shape without sending an artificial message. If no real qualifying incoming reply exists, report that limit and rely on fixtures for the positive stop-on-reply test.
7. Report current campaign preservation explicitly; do not infer success solely from a worker starting or an HTTP 200.

## Outside this first feature

Manual LinkedIn sending from the unified Inbox, sender rotation inside one campaign, campaign-builder changes, AI reply classification, automatic replies, labels/assignment, webhooks, CRM integrations, workspace permissions, Sales Navigator InMail reading and attachment/voice-note processing are later features. Show unsupported content as a labeled placeholder when its identity is reliable.

## Builder decisions

Exact SQL/table names, API route names, adapter/module boundaries, pagination batch limits, backoff constants, accessible layout details and fixture structure are implementation decisions. They must satisfy the behaviors above. Validate the provider endpoint and actual response shape rather than inventing query IDs or claiming unsupported endpoint compatibility.

## Calls proposed after builder review

An independent builder check raised freshness, private history and legacy identity questions. The proposed decisions are:

1. Poll every five minutes; hold regular LinkedIn message sends when a complete successful check is older than ten minutes or a required preflight fails. Other action freshness rules remain as described above.
2. Import campaign-period messages only. Keep pre-enrollment private conversation history outside the stored Inbox.
3. Verify fresh stable participant identity. Do not trust an older name-derived cache as the sole match or promote account-less legacy reply flags into new account-scoped evidence.

These are implementation proposals for the owner's review, not claims that the owner already selected them.

## Reference

HeyReach's own [Unified Inbox page](https://www.heyreach.io/unified-inbox) describes multi-sender conversations and campaign-conversation privacy. Its [sequence guide](https://help.heyreach.io/en/articles/10493916-what-can-be-automated-in-heyreach-sequence) describes outreach actions. These inform the feature goal; this first iteration does not claim complete HeyReach parity or instant synchronization.

## Implementation evidence (2026-11-23)

Implemented and applied locally after owner approval. See [validation and remaining limitations](../../LINKEDIN-INBOX-VALIDATION.md). The disconnected account correctly reports `auth_required`; a positive live provider sync is still pending reconnection. 71 tests and 15 isolated HTTP checks pass; build/typecheck pass. Campaign profiles, tracks/times, steps and account settings were compared unchanged after the additive migration.
