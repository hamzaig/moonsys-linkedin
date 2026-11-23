# LinkedIn Inbox feature 1 — validation

Approved on 2026-11-23. Superpowers 7.0.2 is installed only in this project; design, implementation plan, TDD and an independent final review were used. Implementation was isolated in `codex/linkedin-inbox-read` before local application. No publication requested.

## Verified locally

- 71 tests pass on Node.js 22, including the existing 11 scheduler tests and 22 final-review regressions.
- TypeScript and feature UI/API/core ESLint pass. Production build exits 0 (pre-existing optional `@/ee` warning remains).
- 15 real HTTP checks against an isolated production server pass: protected routes; sender isolation; unassigned legacy stamps; stored threads; existing email inbox; 400/401/404/405/429 handling. All fixture accounts are disconnected.
- Final review reproduced and resolved incomplete-response freshness, conflicting identity, mailbox-owner changes, reply/send races, unsupported history transport, duplicate timestamp changes, repeated historical backfill, legacy reply ordering, wrong campaign/sender context, malformed rate limits and out-of-order UI requests.
- No real invitation/message, paid model call or production fixture mutation was used for testing. The existing campaign remains authorized to run normally.

## Live limitation

The initial saved-session identity probe succeeded, the old conversation-list endpoint returned 500, and a later read returned 401. The owner cannot reconnect currently. Positive live inbox reading and actual provider payload compatibility therefore remain **unverified**. The app must display authentication/unsupported errors and hold regular LinkedIn message steps until a complete fresh check succeeds. Connection schedules and email freshness rules retain their existing behavior.

The read contract uses the modern conversation list documented in [linkedin-toolkit](https://github.com/vicnaum/linkedin-toolkit/blob/main/references/endpoints.md) and the full-history conversation-events GET with `createdBefore` implemented in the [reference client](https://github.com/Rei-x/linkedin-cli/blob/main/src/voyager/client.ts). Fixtures support the contract; they do not establish compatibility with the owner's live session.

## Decisions and deferred items

- Explicit design approval covers inline implementation and local integration; the native worktree/branch is retained. No GitHub push/deployment or extra permission menu was needed.
- Project installation avoids modifying global skills. A new-session automatic discovery check is still separate from this session's manual skill use.
- New readers match verified account/contact identities, never contact names or legacy cached messaging URNs. The existing outbound recipient resolver is outside this feature and remains a later sender-reliability concern.
- New enrollments have milliseconds. Legacy whole-second enrollments exclude their ambiguous first second.
- Optional InMail adapters must implement `sendInMailGuarded(..., beforeSend)` and call the callback immediately before delivery; old adapters wait instead of bypassing cancellation. Actual premium AI/InMail delivery is not tested here.
- Polling is periodic; already-dispatched deliveries cannot be recalled.
- Deferred minor: opening one thread currently queries the full stored conversation list.
- Deferred minor: failure/partial status does not always display the previous complete-check and retry times; both are persisted and exposed through the status API.

## Original checkout integration

Applied locally on 2026-11-23 after confirming no send was in flight. A private consistent SQLite backup and copies of replaced source files were preserved outside the repository. Five additive inbox tables were initialized and SQLite `quick_check` returned `ok`.

The original process group was stopped and exactly one Node.js 22 development server was restarted at `http://localhost:3000`. Authenticated `/inbox`, Inbox list and sync-status routes returned 200. The real account is disconnected (`is_authenticated=0`, unchanged from before integration). Manual Sync now returned 202 and persisted `auth_required` / `auth`, no success watermark and `is_fresh=false`; it did not attempt delivery or claim positive reading.

A full database comparison confirmed run profiles, outreach tracks (including scheduled times), workflow steps, run status and account schedules/limits/authentication unchanged. Recorded connection sends stayed at 13. The original checkout also passes 71 tests and TypeScript. Fixture servers are stopped; no second live sender was created. Changes remain local, with the isolated feature branch retained.
