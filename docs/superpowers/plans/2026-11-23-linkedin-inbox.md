# Automatic LinkedIn Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read campaign-period LinkedIn conversations automatically, show account-scoped threads and stop eligible follow-ups on incoming replies.

**Architecture:** A provider adapter normalizes read-only responses into an account-scoped SQLite store. An independent sync worker persists progress/failure state, while the sender checks reply/freshness guards. Existing Inbox APIs/UI gain LinkedIn thread and sender context without changing email composition.

**Tech Stack:** Node.js 22, TypeScript, Next.js 16.1.6 Pages Router, React 19, better-sqlite3, installed session transport.

**Spec:** `docs/superpowers/specs/2026-11-23-linkedin-inbox-design.md` (owner approved).

## Global Constraints

- No new paid service, subscription or AI model calls.
- Five-minute automatic interval; ten-minute freshness for regular LinkedIn message sends.
- Preserve scheduler fixes, original campaign timings/steps and all approved MoonSys UI changes.
- CLI/API/code checks only; no browser UI automation or test invitations/messages.
- Isolate development and fixture data. Back up the live SQLite database before approved migrations.
- Local implementation only; no publish/deploy requested.

## Review Focus

- An old private-thread message must neither leak into campaign history nor stop a later enrollment.
- Reused contacts/legacy name-derived identities must not mix sender accounts or guess a recipient.
- Unknown/partial/rate-limited provider responses must not claim freshness or silently lose pagination progress.
- Concurrent/repeated sync must not duplicate messages or stop the wrong track; cancellation must be atomic.
- A stale inbox must hold every regular LinkedIn message step, while connection schedules and existing email behavior remain intact.

## Task 1: Account-scoped store and reply effects

**Files:** Create `lib/linkedin/inbox/store.ts`, `tests/linkedin-inbox-store.test.mjs`; modify `lib/db.ts`, `tsconfig.json` only as required for native TypeScript test imports.

**Interfaces:** Produce schema initialization, normalized participant/message/conversation types, exact identity matching, `ingestConversation(db, accountId, conversation)`, account/run reply guard, stored thread/list queries and sync-state queries. Use provider identifiers plus account ID for uniqueness; effect eligibility is evaluated against each run profile's enrollment timestamp.

- [ ] Write failing in-memory SQLite tests for idempotent migrations, exact matching, own/system/group events, old-history exclusion, per-run boundaries, cross-account isolation, duplicate/out-of-order messages, atomic rollback and cancellation across both tracks.
- [ ] Run `npm test`; expect new behavioral tests to fail while the existing 11 scheduler tests remain green.
- [ ] Implement store/schema and migration integration without live data access.
- [ ] Run the whole suite; expect all tests green. Commit this task in the isolated feature branch.

## Task 2: Read-only adapter and sync orchestration

**Files:** Create `lib/linkedin/inbox/provider.ts`, `lib/linkedin/inbox/sync.ts`, `tests/linkedin-inbox-sync.test.mjs`, fixture payloads under `tests/fixtures/linkedin/`.

**Interfaces:** Consume Task 1 normalized types/store. Produce a read-only account provider and `syncLinkedInInbox(db, accountId, provider, now)` with persisted continuation, last attempt/complete success, overlap exclusion, safe failure/backoff and bounded work. Keep external transport injectable for real-response fixtures and local HTTP tests.

- [ ] Verify the real account's read-only endpoint/payload shape without sending messages; save sanitized structural findings, not cookies/bodies.
- [ ] Write failing adapter/orchestration tests: recognized empty response vs unknown shape, normal pagination, partial continuation, replay, overlapping calls, timeout, 401/reconnect, 429/backoff and generic failures.
- [ ] Run new tests and confirm intended failures.
- [ ] Implement bounded normalization/transport and orchestration. Unsupported live API shapes remain visible failures, never success guesses.
- [ ] Run the whole suite; expect all green. Commit.

## Task 3: Worker and sender guard

**Files:** Create `lib/linkedin/inbox/worker.ts`, guard tests; modify `instrumentation.ts`, `lib/linkedin/runner.ts`.

**Interfaces:** Consume `syncLinkedInInbox`, sync-state/freshness and account/run reply guard. Produce one globally guarded independent worker, five-minute staggered scheduling and regular-message preflight hold behavior with visible status/logging.

- [ ] Write failing tests for fresh/stale/failed account states, account-specific guard, first-message and follow-up gating, retry recovery and keeping connection timing intact.
- [ ] Run tests and verify expected failures.
- [ ] Implement worker startup, replace absent premium LinkedIn sync path with core integration, and add final reply/freshness checks before regular message delivery.
- [ ] Run all tests and TypeScript; expect green. Commit.

## Task 4: Inbox APIs and MoonSys interface

**Files:** Extend `pages/api/inbox/index.ts`; create LinkedIn sync/status/thread endpoints, a focused LinkedIn thread component and API/component tests; modify `pages/inbox.tsx` and related local UI styling only as needed.

**Interfaces:** Consume account-scoped list/thread/status queries and manual sync entry point. Preserve existing email fields/handlers; identify each LinkedIn row by conversation/account, with sender and campaign fields. Provide status and read-only thread content plus a LinkedIn link.

- [ ] Write failing fixture API/SSR tests for separate account conversations, unknown identifiers, sender filtering, failed/never-synced/empty states and escaped message text; retain email response/composer behavior.
- [ ] Run and confirm failures.
- [ ] Implement authenticated handlers and existing MoonSys-styled UI. Do not add a LinkedIn Send action in this feature.
- [ ] Run suite, TypeScript, relevant lint and isolated production build; expect no new lint diagnostics and green tests/build. Commit.

## Task 5: Review and live read-only verification

**Files:** Update spec/roadmap validation and feature work log; no unrelated product changes.

**Interfaces:** Consume completed feature, full test results and protected campaign baseline. Produce evidence of actual read-only sync and explicit limitations.

- [ ] Run full tests/build and review the complete feature diff with a fresh reviewer; fix material findings with failing regression tests first.
- [ ] Back up the live database; apply only validated additive schema changes and completed feature files to the original checkout.
- [ ] Start/verify the updated worker without creating another live sender process. Check authenticated HTTP routes and actual read-only account sync, with no artificial messages/invitations.
- [ ] Compare original run steps/timing and unrelated profiles, explain legitimate stop-on-reply changes if real replies exist, and report fixture-only positive coverage if no qualifying live reply exists.
- [ ] Record completion evidence and remaining limitations. Leave changes local and keep the original app running.

## Execution decision

The owner explicitly approved “feature 1 implement karein”. Continue under that authorization without repeating permission questions for the same scope. Implement inline with TDD, isolated source/data and one fresh final code review. Preserve prior uncommitted work; local feature commits are for isolation/review and are not publication.
