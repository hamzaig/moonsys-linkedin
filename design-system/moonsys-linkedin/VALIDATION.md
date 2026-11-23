# Branding validation

Checked locally on 23 November 2026 using Node.js 22.23.5.

| Check | Result |
| --- | --- |
| TypeScript | Passed `npm run typecheck` |
| Production build | Passed with exit code 0 in an isolated source copy and fixture database |
| Scheduler regressions | All 11 existing tests passed |
| Screen rendering | All 17 screens rendered with React server rendering and synthetic fixture data |
| HTTP routes | All 17 page routes and 6 read-only API routes returned 200 in the isolated production runtime |
| API authentication | An unauthenticated protected API request still returned 401 |
| Shared controls | Metric rendering, chart table semantics and date/time control labels checked |
| Navigation | Route matching, one active set of tour targets, drawer controls and shared shell rendering checked |
| Compiled styles | Local fonts, brand theme, responsive workspace rules and reduced-motion rules present |
| Text contrast | 10 selected text/background pairs passed 4.5:1, including navy on pink at 8.55:1 |
| Lint comparison | No newly introduced diagnostics; 25 errors and 15 warnings remain from existing code |
| Data boundaries | All 17 pages retained their existing network calls and server-side data queries |
| Backend boundaries | All 7 protected scheduler/database/authentication files matched their pre-branding hashes |
| Live campaign | API and database both reported running; all 20 campaign track rows exactly matched the saved post-reschedule state |
| Local application | Port 3000, login, official logos and both local font files responded successfully |

The isolated runtime contained no LinkedIn accounts or campaign runs. It was stopped after validation. The owner's original development server remains running on port 3000.

The build retains the existing optional `@/ee` module warning for the public edition. Lint has existing React effect/memoization and other findings; this branding work did not add new findings.

No browser UI automation or visual browser review was performed under the owner's current preference. Server rendering, source checks and HTTP responses do not verify every interactive state or establish visual pixel accuracy on every device. The responsive layout, dialog focus behavior and reduced-motion behavior use CSS and browser-native mechanisms; a manual visual review can follow in the running app.

Changes are local to the workspace. This work did not publish or deploy the branding update.
