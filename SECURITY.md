# Security Policy

Lendwise is a read-only analytics platform: it never holds user funds and never asks for
private keys or signatures beyond standard wallet connection for viewing positions. That
said, we take the security of our infrastructure (APIs, database, rate limiting, data
integrity) seriously.

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through either channel:

- **GitHub**: [Report a vulnerability](https://github.com/lendwise-fi/lendwise/security/advisories/new) (preferred)
- **Email**: [hello@lendwise.fi](mailto:hello@lendwise.fi) with `[SECURITY]` in the subject

Include as much detail as you can: affected endpoint or component, reproduction steps, and
potential impact.

## What to Expect

- **Acknowledgment** within 72 hours.
- **Assessment and fix timeline** communicated within 7 days.
- Credit in the release notes once the fix ships, if you want it.

## Scope

In scope:

- The web application and its API routes (`/api/graphql`, `/api/optimizer`, cron endpoints)
- Data-integrity issues in the APY pipeline (poisoning, injection)
- Authentication/authorization bypasses on protected endpoints

Out of scope:

- Vulnerabilities in the underlying protocols (Aave, Morpho, Compound) — report those to
  the respective teams
- Rate-limit findings that require unrealistic volumes
- Social engineering, physical attacks
