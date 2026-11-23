# MoonSys outreach: feature-by-feature direction

Owner target: build a MoonSys product covering the most useful HeyReach-style workflows. Preserve MoonSys branding and implement our own features. This roadmap is proposed sequencing, not a claim that every item already works or is approved for implementation.

| Order | Feature | Completion evidence |
| --- | --- | --- |
| 1 | Automatic campaign-message reading and stop-on-reply | Real read-only adapter check, account-scoped message store, usable Inbox thread/status, isolated cancellation/idempotency tests |
| 2 | Reply from the unified Inbox | Correct sender/thread, explicit user Send action, retry/duplicate-send protection, verified delivery result |
| 3 | Reliable message sequences and follow-ups | Connection acceptance, working windows, delays and reply-stop verified together; clear per-lead next action |
| 4 | Multiple senders in one campaign | Per-account contact state, fair assignment, independent sessions and budgets, no accidental duplicate outreach |
| 5 | Inbox organisation | Unread/needs-reply views, tags, assignment, campaign/sender filters and conversation search |
| 6 | Campaign and sender analytics | Consistent requested/accepted/sent/replied counts with drill-down to stored events |
| 7 | Integrations and team controls | Authenticated webhooks/API, CRM sync and workspace/role boundaries with idempotent events |
| 8 | Optional AI assistance | User-reviewed drafts and reply classification with explicit provider/budget choices |

Existing foundations include account management, lead lists/CRM, campaign actions, email sending/IMAP code and dialer workflows. New work should test and improve those foundations instead of assuming feature parity from their presence in the interface.

First feature design: [Automatic LinkedIn message reading](superpowers/specs/2026-11-23-linkedin-inbox-design.md).

Each feature gets a reviewed design, a concrete implementation plan, meaningful tests and an evidence-backed completion check. Subsequent feature scope is agreed as it comes up; installing the skill does not authorize implementing this entire roadmap at once.

Feature 1 is implemented and applied locally: account-scoped Inbox, periodic reader and stop-on-reply. 71 tests, build and 15 fixture HTTP checks pass. Live positive reading remains pending account reconnection; the app currently shows `auth_required`. See [validation](LINKEDIN-INBOX-VALIDATION.md). Feature 2 is not yet approved or implemented.

Feature 2 design was approved on 24 November 2026. Manual replies are implemented and applied locally; 130 tests, production build and 23 fixture HTTP checks pass. See [guide](LINKEDIN-REPLIES.md) and [validation](LINKEDIN-REPLIES-VALIDATION.md). Positive live delivery remains pending reconnection and an explicit user Send.
