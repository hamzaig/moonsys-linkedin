# Manual replies from Inbox

Open a saved LinkedIn conversation in Inbox. Its sender account stays fixed. Compose a text reply (up to 3,000 characters) and click **Send**. Enter adds a newline. Normal drafts stay in browser memory for the current Inbox page, separately for each conversation. Recent send outcomes are available in the thread; **Use failed reply** restores failed text without sending it.

One click reserves a durable request before its delivery attempt. The app verifies the current mailbox owner and exact saved conversation participants before its one provider POST. It does not find a recipient by name or resume a campaign after your reply. This feature supports existing one-to-one campaign conversations; the external LinkedIn link remains available for other conversations.

- **Reply saved:** the operation exists; an explicitly selected **Send saved reply** can deliver an unattempted reservation. Unused reservations expire after two minutes.
- **Sending:** an attempt has started. Refreshing or polling cannot send it again.
- **Sent:** LinkedIn acknowledged message creation. This does not claim recipient delivery/read receipts.
- **Failed:** the write was not dispatched (or a supported rejection proved no write). A deliberate retry creates a new request; text is retained.
- **Delivery unconfirmed:** the POST may have succeeded but its acknowledgment is unavailable. Check LinkedIn. **I checked LinkedIn** records that check and permits another deliberate reply; it does not resend or mark the previous result Sent.

If a response is lost, check the saved request. A reservation that never arrived may be retried with the same request ID. A dispatched request is never automatically replayed. Reopening a conversation shows recent server-side send records, so a browser reload cannot hide a pending operation.

Disconnected accounts show a disabled composer and reconnect guidance. Provider backoff is honored. Identity changes, partial provider data and conversations not found within the bounded recent-list check fail before delivery. Checking an old unsupported thread directly on LinkedIn is the available fallback.

Manual replies have their own per-account delivery lease/backoff and do not consume automated campaign quotas or change scheduled steps. Campaign sending remains independent; shared campaign/manual quotas and global coordination are later sequence-reliability work.

Authoritative deletion clears a currently open cached thread; loss of authorization clears protected draft content. Explicit account reconnect/invalidation changes a session revision and fences old prepared attempts. Deleting a conversation, account or target purges reply text/provider identities but keeps a minimal operation tombstone. This prevents an old request ID delivering again after deletion. Already-dispatched external messages cannot be recalled.

## Engineering checks

Use Node.js 22. Run `npm test`, `npm run typecheck`, feature lint and an isolated production build. For HTTP acceptance, run a separate server on loopback with an empty database and dummy secrets, then provide its `NEXTAUTH_URL`, `MOONSYS_DB_PATH`, `NEXTAUTH_SECRET`, `INTERNAL_API_SECRET` and optional `REPLY_HTTP_REPORT_PATH` to:

```sh
node --experimental-strip-types scripts/check-linkedin-reply-http.mjs
```

The script refuses a non-empty database. All committed fixture account states are disconnected; dispatch checks fail locally before a session/provider can be created. Positive provider behavior is tested with fake transports, not real messages.

The owner's real account is disconnected. Positive live reading and manual delivery remain unverified until reconnection and a deliberate user Send. No test should send a real LinkedIn message or use browser UI automation.
