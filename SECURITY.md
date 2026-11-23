# Security

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/hamzaig/moonsys-linkedin/security/advisories/new).
Keep credentials, browser sessions and personal lead data out of public issues.

## Initial release checks

The pre-publication dependency check on 2026-11-23 reported 38 vulnerabilities:
3 critical, 21 high, 13 moderate and 1 low. These findings concern existing
dependency versions; exploitability has not been assessed. Review the current
`npm audit` results and resolve relevant findings before exposing a deployment
to untrusted users.

Published files were checked for secrets with Gitleaks. Local `.env` files,
SQLite databases, session data and generated build files are excluded from Git.
These release checks are not a comprehensive security audit.
