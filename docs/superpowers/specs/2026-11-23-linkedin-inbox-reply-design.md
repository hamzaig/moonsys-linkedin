# Feature 2: reply from the LinkedIn Inbox

Status: owner approved this reviewed design on 2026-11-24. The owner asked to start this feature after reviewing its scope: compose a reply inside Inbox, send through the correct account/thread, avoid accidental duplicate sends, and show truthful send status. Goal: build the useful MoonSys outreach workflows feature by feature.

## Current state and constraints

- Feature 1 is merged into `main` at `0ef298b`. It stores campaign conversations/messages per LinkedIn account, periodically reads supported threads, and stops eligible follow-ups on verified incoming replies. The existing 71 tests pass.
- `components/inbox/LinkedInThread.tsx` renders a read-only dialog; `pages/api/inbox/linkedin/thread.ts` returns the saved thread. The existing email composer is separate and stays unchanged.
- `linkedin_conversations` pins the account, provider conversation URN, target and peer URN. `linkedin_inbox_sync.self_urn` pins the verified mailbox owner.
- The old campaign sender in `lib/linkedin/message.ts` navigates profiles and can search names. Manual replies must use the already stored exact conversation identity.
- The real account is disconnected. The owner cannot reconnect currently. No real LinkedIn message, invitation or browser UI action will be used as a test; no password/cookie request in chat. Positive live delivery remains pending reconnection and an explicitly user-triggered Send.
- Keep MoonSys branding, Node.js 22, Next.js Pages APIs, React, SQLite and existing session/auth infrastructure. No added dependencies, paid provider or AI call.
- Preserve campaign scheduling, enrollments, existing reply-stop behavior and email composition. No automatic campaign resumption after a manual reply.

## Approaches

1. **Exact-thread API adapter with a durable send ledger (recommended).** Use the existing session's API request context, pin account/owner/participants, and send to the saved conversation URN. Persist each explicit user action before dispatch and never replay an ambiguous write. Fits the existing API reader and allows isolated request/parser tests. The private provider contract still requires live acceptance later.
2. **Reuse the existing profile/name-based browser sender.** Shares code but needs page navigation and recipient resolution, and does not bind delivery to the opened stored thread. Its recipient-resolution assumptions do not meet this feature's identity requirement.
3. **Background delivery queue.** Could survive brief UI disconnects, but resuming queued external writes after a crash introduces delivery/replay decisions beyond an explicit immediate reply. A durable status ledger gives recovery without an automatic retry worker.

Approved implementation choice: approach 1. The builder may choose internal helper names/file boundaries, but must preserve the behavior and bounds below. The choices not stated by the owner are proposals for approval, not claims that the owner selected them.

## User flow

The existing thread header keeps the contact and sender account visible. Under the thread, add a plain-text composer and Send button. The sender cannot be changed inside an opened thread.

```text
LinkedIn · Sender A                         Close
Example Lead

[existing conversation messages]

Reply as Sender A
[Write your reply...                         ]
0 / 3000                                    Send

Last reply: Sending / Sent / Failed / Delivery unconfirmed
Open on LinkedIn
```

- First increment supports text replies to stored, verified one-to-one campaign conversations. Attachments, new conversations, group chats, InMail and auto-replies are later work.
- App text limit: 3,000 UTF-16 code units, matching browser `maxLength`; this is an application choice, not a claim about LinkedIn's current maximum. Reject whitespace-only text, preserve accepted content and line breaks, and never truncate silently.
- Follow the existing `design-system/moonsys-linkedin/MASTER.md`: navy/pink semantic tokens, existing typefaces/dialog sizing and focus styles. UI/UX Pro Max form guidance applies: visible textarea label, inline validation, loading/busy state, and one contextual live status region. Keyboard Enter inserts a newline; sending requires the explicit Send button, with no implicit Enter shortcut. Preserve focus and draft text after errors; long status text must wrap on mobile.
- User clicking Send is the only event that can dispatch a write. That handler first reserves a durable operation without external delivery, then submits a dispatch action for the same operation ID after its reservation is confirmed. Opening a thread, polling, closing/reopening, switching accounts or syncing never sends anything. Closing/switching before dispatch aborts the client continuation; a previously dispatched attempt remains observable through saved status.
- Disable Send while the current draft has an unresolved request. Retain its text on failure. Keep unsent drafts in browser memory per stored conversation ID, so switching dialogs/senders cannot mix draft content.
- Send immediately on explicit user action, independent of campaign working hours and queued-step reply guards. Respect account authentication, provider backoff and per-account serialization. Manual replies are conversational actions; they do not consume the automated campaign daily-message quota in this increment. Record their own delivery events separately. A shared quota policy can be designed with sequence reliability later.
- `Sent` means LinkedIn acknowledged creating a message with a validated message URN/time. It does not claim recipient delivery/read receipts.
- A network timeout after dispatch shows **Delivery unconfirmed** with **Open on LinkedIn**. There is no automatic retry for that operation. Until the user acknowledges that warning, the server blocks another operation in that conversation across all tabs. Other conversations on the account are available once the active manual-send lease has ended. Acknowledgment records only that the user checked; the original operation stays unconfirmed. Clear its draft on acknowledgment. A later deliberate Send is a new intent and may contain the same text; never restore/resend that uncertain draft automatically. Reposting the same dispatched operation ID always returns its saved result without another write. No Retry button is shown for an unconfirmed operation.
- A failed operation that provably made no write can offer a deliberate Retry. That button creates a new operation ID; normal polling/browser transport retries reuse the existing ID and only retrieve status.
- Reopening the thread loads recent send records from the server. Browser reload or another tab must not hide an unresolved operation and accidentally manufacture a retry. If reservation acknowledgment is lost and status returns 404, the user may explicitly retry reserving the same ID/text; reservation never delivers. Dispatch is permitted only after the server confirms the matching reservation. If dispatch acknowledgment is lost, status is recoverable because its reservation already exists. A saved, unattempted reservation can be dispatched by an explicit Send saved reply action; status polling never dispatches it.

## Identity verification before dispatch

Client sends only stored `conversationId`, UUID-v4 `requestId` and `text`. It cannot choose the provider URL, sender account, peer or provider conversation URN. Derive those from the stored conversation.

1. Require application authentication, JSON content type, valid request shape and a supported stored one-to-one thread.
2. Require the stored account to exist, remain authenticated, and have an already pinned `self_urn`. Never pin a new owner as a side effect of sending.
3. Read fresh `/me` through the existing session; verify it equals the pinned owner.
4. Find the exact saved conversation in the current provider conversation list, using at most five pages and a 30-second total preflight deadline. Check its current participants contain exactly that owner and pinned peer, and that it still maps unambiguously to the saved campaign target. Reject changed/unknown/group/partial data.
5. If the bounded lookup cannot find the exact conversation, fail before dispatch with “Conversation could not be verified; open it on LinkedIn.” Do not fall back to a name, URL search, cached target messaging URN or another conversation. This is a deliberate limitation for older threads outside the bounded recent list; a dedicated verified conversation-detail contract can improve coverage later.
6. Immediately before writing, re-read the local account flag, pinned owner, saved thread/peer/target binding, provider backoff and active operation token. A concurrent reconnect/deletion/identity change prevents dispatch.

A saved incoming reply is allowed: the purpose is answering it. Do not reuse the campaign `hasRunReply` gate to reject a manual response.

## Durable send ledger and duplicate behavior

Add an additive SQLite `linkedin_reply_sends` table scoped to the saved conversation/account, with unique request ID, exact body, body hash, timestamps, state, attempt token, pinned owner/peer/thread snapshot, provider message URN/time when known, and sanitized failure code. Add a per-account manual-send lease/backoff so two manual replies for one account cannot dispatch concurrently. This coordination is among manual replies only; the existing campaign sender keeps its independent page/queue path and schedule. Manual preflight also honors an existing inbox-reader rate-limit backoff. Manual failures persist their own backoff without overwriting the reader lease/checkpoint. Do not claim a shared campaign/manual quota or global provider-action lock; those are later sequence-reliability work. Unrelated accounts remain independent.

States:

- `preparing`: reservation confirmed, no provider write dispatched yet; an optional fenced attempt token distinguishes an idle reservation from active preflight.
- `sending`: dispatch marker durably committed before making the one POST.
- `sent`: a supported positive provider acknowledgment has been durably recorded.
- `failed`: definitive pre-dispatch failure, or a documented rejection proving no write.
- `unknown`: the write may have happened and delivery cannot be confirmed.

Rules:

- Repeated reservation for the same request ID + same conversation/text returns the saved operation, including failures. Same ID with different text or conversation returns 409. Dispatch requires a confirmed existing reservation and atomically claims its previously empty attempt token. Repeated dispatch while that token/state exists returns status, never starts another attempt. Two different IDs for one conversation are blocked while its existing operation is preparing/sending or unacknowledged unknown; there is no text-based deduplication of intentional future replies.
- Reservation itself makes no external requests and acquires no account delivery lease. On explicit dispatch, claim the operation attempt token and account lease atomically. A lease is fenced by an attempt token; stale callbacks cannot dispatch. All preflight reads fit the 30-second budget; the write has a 20-second timeout. Lease expiry and unused-reservation timeout are 120 seconds. Account-busy dispatch returns a retryable busy response before claiming an attempt, so the same unattempted reservation can later be explicitly dispatched.
- A stale `preparing` operation can be failed as not dispatched after the lease expires. A stale `sending` operation becomes `unknown`; it cannot be replayed. Late authoritative acknowledgment for that same attempt may still upgrade `unknown` to `sent` without another POST.
- No retry/follow-redirect behavior on the send POST. A lost response, crash after dispatch, 5xx, malformed success body, redirect or any response whose rejection semantics are not proven becomes `unknown`.
- Known authentication/rate-limit failures found by preflight are `failed` without a write. For a POST rejection, classify as definitive only when the adapter has a supported rejection contract; otherwise prefer `unknown`. Honor finite persisted provider backoff with an invalid-header fallback. Manual retry cannot bypass 429 backoff.
- DB failure before the dispatch marker prevents sending. DB failure after a successful external write leaves the durable dispatch marker; recovery exposes `unknown` instead of replaying the write. The service must not report `Sent` if it could not persist that acknowledgment.
- Status polling never resumes delivery. Repeating a reservation cannot deliver. A deliberate dispatch of an unattempted confirmed reservation may initiate its one attempt, including recovery after its first dispatch request never reached the server. An existing attempted operation cannot be restarted. There is no automatic delivery job.

## Deletion and retained operation status

Deletion follows the existing account/target privacy expectation: purge reply text, pinned provider identities/URNs and provider response details when their conversation/account/target is removed. Keep only a minimal tombstone (operation UUID, internal binding hash, content hash, state, sanitized deletion reason and times) independently of account/conversation foreign-key cascades; tombstones have no message body/contact details and are not auto-pruned in this increment. Null removed references rather than deleting operation IDs.

A reserved/preflight operation whose binding disappears fails before any write. A dispatched operation cannot be recalled; deletion leaves its minimal status unknown until that same attempt receives an authoritative acknowledgment, which may record a minimal sent outcome without restoring purged text/provider identities. Status lookup remains authenticated and reports that details were removed. Reusing a deleted operation UUID cannot start delivery to a replacement account/thread. Deletion and the ledger purge/tombstone update must be transactional, including deletion through existing account/target routes; enforce it at schema/trigger level so alternate delete paths behave consistently.

## Provider transport and acknowledgment

Use the existing account session's API request context only. Fixed origin `https://www.linkedin.com`; reads use the existing strict read behavior. The sole write is the saved-thread create-message POST. Do not send typing, mark-read, delivery-acknowledgment, archive or unrelated actions.

Public primary implementation references were read on 2026-11-23:

- [reference client's send implementation](https://github.com/Rei-x/linkedin-cli/blob/main/src/voyager/client.ts), blob `0e65fb74fab751ac36a8452a438a91e9977db32c`: existing-thread create-message action; mailbox/conversation identity, stable operation token, tracking token; supported acknowledgment under `value` with provider message identity/time.
- [endpoint reference, send section](https://github.com/vicnaum/linkedin-toolkit/blob/main/references/endpoints.md), blob `239a472861a77cabb62cab99d678abdc887688fb`: independently describes existing-thread create-message with the same identity/token fields and 201 acceptance.

The references differ on Content-Type and response wrapping. Proposed first adapter follows the reference client's `text/plain;charset=UTF-8` JSON body and strict `value` acknowledgment; unsupported success shapes become unknown. Preserve the operation UUID as `originToken`; do not assume LinkedIn guarantees idempotency. Retain the reference payload's dedupe flag behavior; local durable no-replay semantics provide protection.

Validate finite positive provider time and supported message URN. If response includes owner, conversation or operation token, reject contradictory values as unconfirmed. Do not log response bodies/cookies/private text.

## API and UI boundaries

- New authenticated POST `/api/inbox/linkedin/reply` with a strict action discriminator: `reserve` validates and durably saves the intent with no external write; `dispatch` accepts the reserved operation ID and starts at most one attempt for the explicit Send action. The UI performs both after one Send click. Only `reserve` accepts text/conversation identity; `dispatch` derives immutable input from the saved operation. Status recovery reuses the same ID; no fresh ID is generated automatically. Missing/changed reservation returns 404/409 without dispatch.
- New authenticated GET `/api/inbox/linkedin/reply?id=<request-id>`: saved status only, no dispatch. Reject missing/malformed IDs; protect route with existing API authentication. All responses are `no-store` and omit lease/attempt tokens and provider payloads.
- Extend stored thread response with minimal sender capability/block reason and recent send records. A disconnected account shows a disabled composer plus reconnect guidance; history remains visible.
- Authenticated manual “I checked LinkedIn” acknowledgment records only that the user saw the uncertainty and permits composing another operation. It neither marks the old message as sent nor retries it. This action may share the reply endpoint with a strict action discriminator.
- Browser writes require same-origin/configured-origin validation and JSON, with a separate authenticated internal-secret path for isolated local checks; do not weaken the existing proxy's authentication.
- Show send status in a clearly labelled operation area immediately. The normal message reader remains the source for provider thread messages. Link a send record to an imported outgoing message only through proven provider identity/token, never body/time guesses; until then it remains a send-status record rather than a second claimed thread message.
- The existing external LinkedIn link remains available for verification and unsupported threads. Existing email reply modal retains its behavior.

## Failure, concurrency and verification

Tests use real isolated SQLite and fake external transport. Cover successful acknowledgment; auth/wrong owner/changed peer/group/ambiguous target; old thread outside bounded verification; same ID replay/conflicting payload; double-click, two tabs and account isolation; lost reservation/dispatch acknowledgments and same-ID reservation recovery; account/target deletion during each state and tombstone replay protection; unknown-warning acknowledgment across tabs; late callback fencing; read deadline; 429 with invalid JSON/header; timeout/redirect/5xx/malformed 2xx; DB crash windows; reopening/reloading unresolved requests; sender/thread fetch races and draft isolation; escaped text and disabled composer; unchanged email and all 71 prior tests.

A local fake server may exercise the adapter contract, but production outbound host remains fixed and cannot be redirected by user input/environment to a fixture server. No real LinkedIn POST or browser UI test. A fresh independent final review will inspect the implementation after approval and tests.

Acceptance: the feature works end-to-end against isolated fixtures with truthful states, preserves campaign data, and handles a disconnected real account without dispatch. Positive live delivery is explicitly pending reconnection and a separate explicit user Send, not inferred from fixture success. Applying locally, pushing or merging follows the owner's authorized scope at that time; this design approval does not itself publish or send a real message.

## Builder-check decisions (2026-11-23)

A fresh builder check raised four material questions, resolved here as proposed implementation calls for owner review:

1. Lost initial request/status 404: separate non-delivering reservation from explicit dispatch; stable-ID reservation retry is safe, and no dispatched operation can lack its durable reservation. Cost: one additional local API round trip per Send.
2. Unconfirmed result: block that conversation across tabs until explicit warning acknowledgment; after that a new deliberate intent may use the same text, with the old result still unconfirmed. Cost: the user must check LinkedIn when the outcome cannot be established.
3. Coordination boundary: manual-only account serialization/backoff, honoring existing reader backoff; preserve campaign scheduling/limits and make no shared-lock/quota claim. Cost: manual and automated activity can overlap; global coordination remains later work.
4. Deletion: purge text/provider identities but retain minimal idempotency tombstones independent of cascades. Cost: opaque operation metadata remains after deletion so an old request can never deliver again.

UI design uses the existing MoonSys MASTER and focused UI/UX Pro Max form guidance. The Next.js dataset's newer App Router recommendation does not apply to this existing Pages Router application; the matching React 19.2 controlled-input and effect-cleanup guidance does.
