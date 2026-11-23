<p align="center">
  <img src="public/brand/moonsys-mark.png" alt="MoonSys" width="56" />
</p>

<h1 align="center">MoonSys LinkedIn</h1>
<p align="center">Owned and maintained by MoonSys.</p>
<p align="center">A self-hosted workspace for LinkedIn outreach, email campaigns, lead enrichment and calling.</p>

[Report an issue](https://github.com/hamzaig/moonsys-linkedin/issues) · [License](LICENSE)

## License at a glance

MoonSys LinkedIn is **source-available** under the [MoonSys Source-Available License 1.1](LICENSE).
You may use it for personal or commercial work, modify it and share copies free of charge.
**You may not sell or resell the software or modified versions, charge license fees for copies,
or offer it as a hosted or managed SaaS product to third parties.**
Self-hosting for your own organization is allowed. Keep the copyright notice and license with distributed copies.

## Features

- LinkedIn and email campaign sequences with delays, templates and per-lead progress.
- Lead lists, CSV import, company records and contact activity timelines.
- LinkedIn Sales Navigator imports and Apollo enrichment with your own accounts.
- An account-scoped LinkedIn/email Inbox with saved campaign threads, sync status and stop-on-reply. See [Inbox behavior and limits](docs/LINKEDIN-INBOX.md).
- A manual dialer workspace with scripts, outcomes, callbacks and analytics.
- Per-account schedules, daily limits and email ramp-up settings.
- A local SQLite database and deployment on your own machine or server.

## Design system

All 17 application screens use the [MoonSys.co](https://www.moonsys.co/) identity: the official logo,
navy and pink palette, locally hosted Inter/Mulish fonts, and a shared responsive application shell.
Navigation, brand configuration and reusable UI components live in `lib/ui/`, `components/brand/`,
`components/layout/` and `components/ui/`.

See the [design rules](design-system/moonsys-linkedin/MASTER.md),
[workspace layouts](design-system/moonsys-linkedin/pages/WORKSPACES.md) and
[validation record](design-system/moonsys-linkedin/VALIDATION.md).

## Run with Node.js

Use **Node.js 22**; the repository includes an `.nvmrc` file.

```bash
git clone https://github.com/hamzaig/moonsys-linkedin.git
cd moonsys-linkedin
nvm install
nvm use
npm ci
cp .env.example .env.local
```

Edit `.env.local` before starting the app:

| Variable | Purpose |
| --- | --- |
| `NEXTAUTH_URL` | Your public app URL; use `http://localhost:3000` for local Node.js development. |
| `NEXTAUTH_SECRET` | A random secret for session signing. |
| `AUTH_PASSWORD` | The invite code required to create a user account. |
| `INTERNAL_API_SECRET` | A separate random secret for internal API calls. |
| `MOONSYS_DB_PATH` | Optional SQLite path; defaults to `./moonsys-linkdin.db`. |
| `HEADLESS` | Keep `true` for background browser sessions. |

Generate separate random values for the three secret fields with `openssl rand -base64 32`.
Then install Chromium and build:

```bash
npx playwright install --with-deps chromium
npm run build
npm start
```

Open `http://localhost:3000`. For development, use `npm run dev`.

## Run with Docker

Docker Compose builds the image from this repository; no prepublished image is required.

```bash
cp .env.example .env.local
```

Set the same secrets as above and set `NEXTAUTH_URL=http://localhost:3456`.

```bash
docker compose up --build -d
```

Open `http://localhost:3456`. The default port is bound to localhost.
The database is persisted in `./data/moonsys-linkdin.db`.

## First account and setup

1. Open the login page, choose **Create account**, and enter the invite code from `AUTH_PASSWORD`.
2. Choose an email address and your own account password, then sign in.
3. Add your LinkedIn account under **Settings → LinkedIn** and complete authentication.
4. Optionally add SMTP/IMAP email accounts and an Apollo API key in Settings.
5. Import a CSV or a Sales Navigator list, create a campaign and launch it when ready.

Sales Navigator imports require your own LinkedIn Sales Navigator subscription.
Local environment files, databases, browser sessions and generated build files are excluded from Git.

## Development and contributions

```bash
npm run typecheck
npm run build
npm run lint
```

CI installs dependencies, checks TypeScript and builds on Node.js 22 with a temporary empty database.
The existing codebase has lint findings; keep changes focused and avoid adding new violations.
The initial dependency check also reports known vulnerabilities; see [security notes](SECURITY.md).
Open an issue for a bug or feature request, or submit a pull request with a description and validation results.
Contributions are distributed under this repository's license. Third-party dependencies retain their own licenses.
