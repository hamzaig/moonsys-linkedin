# LinkedIn Inbox reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Send an explicit plain-text reply to a verified saved LinkedIn conversation with durable duplicate protection and honest delivery state.

**Architecture:** Separate reservation from dispatch; persist a fenced per-account manual attempt before a single provider POST. Validate the live owner and exact thread participants first. The UI uses status-only recovery and preserves conversation-scoped drafts. No automatic delivery worker.

**Tech Stack:** Node.js 22, Next.js Pages APIs, React 19, better-sqlite3, existing Playwright APIRequestContext (no UI automation), MoonSys tokens.

**Spec:** docs/superpowers/specs/2026-11-23-linkedin-inbox-reply-design.md (owner approved 2026-11-24).

## Global Constraints

- Keep MoonSys branding, Node.js 22, Next.js Pages APIs, React, SQLite and existing session/auth infrastructure. No added dependencies, paid provider or AI call.
- No real LinkedIn message, invitation or browser UI action will be used as a test; no password/cookie request in chat.
- Preserve campaign scheduling, enrollments, existing reply-stop behavior and email composition. No automatic campaign resumption after a manual reply.
- App text limit: 3,000 UTF-16 code units; reject whitespace-only input and preserve accepted text.
- At most five conversation-list pages and 30 seconds total preflight; 20-second single POST; 120-second manual lease/reservation timeout.
- Manual-only account lease/backoff; respect existing reader 429 backoff; no change to automated daily-message quota/schedule.
- Apply locally after isolated verification; publication requires the owner's release instruction for this feature.

## Review Focus

1. Lost reserve/dispatch responses and duplicate requests must never manufacture a new automatic intent (Tasks 1, 2, 4).
2. Reconnect/identity/target/deletion races between preflight and actual POST must prevent a wrong-recipient write (Tasks 1–3).
3. External success followed by DB failure, stale leases and delayed acknowledgments must remain honest and non-replayable (Tasks 1–3).
4. Cross-tab unknown acknowledgment, draft/thread switching and late responses must not bypass a server gate or expose the wrong account's draft (Tasks 1, 4).
5. Missing/partial provider metadata, 429 malformed JSON and contradictory success acknowledgments must not be presented as Sent (Tasks 2–3).

### Task 1: Durable manual reply ledger

**Files:** Create `lib/linkedin/inbox/reply-types.ts`, `reply-store.ts`, `tests/linkedin-reply-store.test.mjs`, `tests/helpers/reply-fixture.mjs`; modify `lib/db.ts`.

**Interfaces:** `initReplySchema(db)`, `reserveReply(db,{requestId,conversationId,text},now?)`, `getReply(db,id,now?)`, `listReplySends(db,conversationId,now?)`, `getReplyBinding(db,conversationId)`, `claimReply(db,id,now?)`, `markReplySending(db,id,token,verifiedPeer,now?)`, `finishReply(db,id,token,ack,now?)`, `failReply(db,id,token,code,now?,retryAfterMs?)`, `acknowledgeReply(db,id,now?)`, `replyCapability(db,conversationId,now?)`. Shared `ReplyOperation`, `ReplyBinding`, `ReplyProvider`, `ReplyAck`, `ReplyError` types/class. Public operations omit tokens, hashes and pinned provider fields.

- [x] Write SQLite tests: idempotent reserve/conflicting payload, active-conversation gate, account isolation/busy lease, expiry/fencing, failed versus unknown, late ack, unknown acknowledgment and intentional same-text new ID, account/target deletion purges and tombstones, transactional failure windows.
- [x] Run Node22 `npm test`; expected new tests FAIL before implementation.
- [x] Implement additive schema/triggers and transactional transitions; wire initialization after existing inbox schema.
- [x] Run `npm test` and `npm run typecheck`; expected all existing 71 plus new tests PASS.
- [x] Commit the complete ledger with tests.

### Task 2: Verified one-attempt coordinator

**Files:** Create `lib/linkedin/inbox/reply-service.ts`, `tests/linkedin-reply-service.test.mjs`.

**Interfaces:** Consumes Task1 transitions and `ReplyProvider` (`identity`, `list`, `send(input,beforeWrite)`); produces `dispatchReply(db,id,factory,clock?)` with factory `(accountId,deadlineAt)=>Promise<ReplyProvider>`. `send` must call the synchronous marker callback immediately before its one POST; it must never retry it.

- [x] Write tests for success and replay, saved incoming reply allowed, wrong/missing owner, changed peer/group/target, five-page miss/cursor cycles/30s deadline, callback-time local changes, concurrent claims, preflight failure, post-dispatch timeout/invalid success and DB-persistence failure.
- [x] Run test file; expected FAIL before coordinator exists.
- [x] Implement bounded live verification and fenced marker callback, sanitized failures, finite backoff, no background dispatch or retry. Recover saved results after transport failure.
- [x] Run full suite/typecheck; expected PASS, zero live provider writes.
- [x] Commit service and tests.

### Task 3: Session-bound provider and protected API

**Files:** Create `lib/linkedin/inbox/reply-provider.ts`, `reply-session.ts`, `reply-http.ts`, `pages/api/inbox/linkedin/reply.ts`, `tests/linkedin-reply-provider.test.mjs`, `tests/linkedin-reply-api.test.mjs`; extend thread API.

**Interfaces:** `createReplyProvider(readTransport,writeTransport)` returns Task2 `ReplyProvider`; `createSessionReplyProvider(accountId,deadlineAt)` captures a single existing context throughout verification/write. Route POST actions `reserve` (id/conversation/text), `dispatch` (id), `acknowledge` (id), GET saved status by id; thread response adds `replyCapability` and recent public `replySends`.

- [x] Write transport request/parser tests for fixed create-message URL, JSON text/plain body, stable UUID origin token, one write/no redirects/retries, strict value/message URN/time and contradictory identity/token fields; malformed 429 retains finite backoff.
- [x] Write actual handler tests over SQLite for auth-origin/content type/input/method/status contracts, two-phase behavior, repeated reserve/dispatch, deleted tombstones, no private transport/token fields, disconnected account never constructs a session provider.
- [x] Run new tests; expected FAIL before implementation.
- [x] Implement the API with existing proxy auth, strict JSON and trusted browser origin or constant-time internal-secret authentication. Bind session once; no page methods or user-controlled provider host. GET/poll never sends.
- [x] Run full suite, typecheck and feature lint; expected PASS.
- [x] Commit adapter/API tests and code.

### Task 4: MoonSys thread composer and recovery

**Files:** Create `lib/inbox/reply-client.ts`, `components/inbox/LinkedInReplyComposer.tsx`, `tests/linkedin-reply-client.test.mjs`, `tests/linkedin-reply-ui.test.mjs`; modify `LinkedInThread.tsx`, `pages/inbox.tsx`.

**Interfaces:** Client helpers `reserveAndDispatchReply(intent,signal,fetcher?)`, `getReplyStatus(id,signal,fetcher?)`, `acknowledgeUnknownReply(id,signal,fetcher?)`; typed phase error retains stable intent. Parent holds in-memory drafts per conversation; thread response from Task3 drives disabled/block state and recent send area.

- [x] Write adversarial fake-fetch tests for reservation acknowledgment loss/404 recovery with stable ID, abort between reserve and dispatch, repeated dispatch/status-only recovery, thread/draft isolation and obsolete responses.
- [x] Write SSR tests for visible sender/label/count, escaped content, disabled/busy/error/unknown states, explicit Send, no implicit Enter submission and retained external link. Preserve email modal implementation.
- [x] Run new tests; expected FAIL before composer/client exists.
- [x] Implement controlled textarea using existing tokens; abort close/switch before dispatch, safe current-thread response guards, status-only polling, explicit saved-reservation Send/failed Retry/unknown acknowledgment. No message-body/time heuristic matching.
- [x] Run all tests/typecheck/feature lint; expected PASS.
- [x] Commit client/composer and tests.

### Task 5: Fixture acceptance, fresh review and local integration

**Files:** Create `scripts/check-linkedin-reply-http.mjs`, `docs/LINKEDIN-REPLIES.md`; update roadmap/design validation.

**Interfaces:** Consume complete feature; produce repeatable isolated HTTP/SSR verification and honest live disconnected-account behavior. Baseline main `0ef298b`; compare all applied source semantically and all live campaign profiles/tracks/steps/settings before/after.

- [x] Run whole suite/typecheck/lint and production build with dummy secrets/empty separate DB; expected PASS. Real HTTP fixture checks include protected routes, statuses, disconnected dispatch, tombstones and unchanged email; fixture accounts are disconnected at every committed DB state.
- [x] Obtain one fresh whole-feature review (most capable model per executing-plans); fix material issues in one TDD pass and keep whole suite green. Document deferred minors/rulings.
- [x] Back up real DB and replaced source, apply only validated feature files after conflict check, initialize additive schema and verify quick_check. Preserve exactly one original app listener and campaign timing/state; no live send for a test.
- [x] Verify local page/protected APIs and disconnected composer behavior; document positive live send remains unverified pending reconnection and deliberate user Send. Stop fixture servers, keep native branch/worktree, leave changes local.
- [x] Commit verification/docs and mark completion only after required checks pass.

## Execution decision and self-review

Owner explicitly approved the reviewed design on 2026-11-24. Continue the established native inline method with TDD and one fresh final reviewer, without another plan/method approval menu. Global constraints, state names and interfaces agree across Tasks 1–4; Task5 consumes their completed behavior. Each Review Focus item is assigned adversarial tests above. The plan is an implementation breakdown of the approved scope, not new product scope.

## Completion evidence

See [validation](../../LINKEDIN-REPLIES-VALIDATION.md). All local implementation and verification tasks complete. Live provider acceptance remains pending reconnection and an explicitly user-triggered Send.
