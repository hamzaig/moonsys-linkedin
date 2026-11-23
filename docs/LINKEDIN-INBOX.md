# Automatic LinkedIn inbox

The core reader checks supported regular LinkedIn conversations for campaign contacts about every five minutes. It stores messages per LinkedIn sender account and conversation, exposes them in Inbox, and stops eligible queued LinkedIn/email tracks when an incoming reply is verified. Historical messages before each campaign enrollment and unrelated personal threads are excluded.

In **Inbox**, choose a sender, check its status, use **Sync now**, and open a stored conversation. LinkedIn threads are read-only in this feature; **Reply on LinkedIn** opens the original thread. Email composition retains its existing behavior.

A complete successful check stays fresh for ten minutes. Regular LinkedIn message steps wait if inbox state is stale/failed; connection requests and profile visits keep their existing schedules. Email freshness rules are unchanged, but a saved qualifying LinkedIn reply stops both tracks of its matching run. Polling cannot guarantee instant reaction to a reply arriving after the last check.

## Connection and failure states

- **Not checked yet:** an account has not completed its first inbox scan.
- **Checking / reading history:** a bounded scan is in progress; partial work is retained.
- **Reconnect:** refresh the account under Settings → LinkedIn. The reader does not ask for passwords or cookies in chat.
- **Pause requested by LinkedIn:** automatic/manual checks honor provider backoff.
- **Unsupported response:** the provider shape/query needs verification. This is not treated as an empty successful inbox.

The adapter uses the existing session's GET requests only. It does not click/scroll pages, send messages, mark provider conversations read or delete anything. Message text is rendered as plain text. Cookies and raw inbox bodies are not logged.

## Engineering and verification

Code lives in `lib/linkedin/inbox/`; additive tables are initialized through `lib/db.ts`. The independent worker starts through instrumentation and does not wait inside the sending loop. Account leases prevent overlapping sync; persisted continuation supports bounded pagination and restart recovery.

Run Node.js 22:

```sh
npm test
npm run typecheck
npm run build
```

For HTTP acceptance checks, start a separate production server on loopback with an **empty fixture database** and dummy authentication secrets. Supply that server's `NEXTAUTH_URL`, `MOONSYS_DB_PATH` and `INTERNAL_API_SECRET`, then run:

```sh
node --experimental-strip-types scripts/check-linkedin-inbox-http.mjs
```

The script refuses a non-empty database and creates disconnected synthetic accounts only. It checks sender isolation, thread retrieval, unchanged email replies, missing/invalid input, authentication and rate-limit handling. Never aim it at the normal application/database.

The default conversation query reference is from [linkedin-toolkit endpoint documentation](https://github.com/vicnaum/linkedin-toolkit/blob/main/references/endpoints.md); the normalizer supports normalized REST.li collections and references. `LINKEDIN_CONVERSATIONS_QUERY_ID` can override the query only after verifying the actual LinkedIn client. Provider formats may change; fixture success does not establish live compatibility. The owner's current session returned 401 during initial read-only validation and the owner could not reconnect at that time. Report live verification separately.

Legacy account-less `targets.last_replied_at` flags retain their old compatibility behavior; the new reader never creates those flags or treats name-derived cached URNs as sufficient identity evidence. Sales Navigator's separate inbox, LinkedIn replies sent from this app, AI classification and sender rotation are later features.
