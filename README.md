# Ileri

Community learning with token-gated access, verified completion and community-funded rewards.

Communities bring their members. Tokens decide who gets in. Assessments decide who completed. Rewards go to people whose completion was verified, paid from budgets the community sets.

```
Join a community → verify eligibility → enroll → learn → pass assessment → credential + reward
```

This repository is the first release described in [`docs/blueprint.md`](docs/blueprint.md). How each part of the blueprint maps to code, and the decisions made along the way, are in [`docs/architecture.md`](docs/architecture.md).

## What's in the first release

| Area | What works |
| --- | --- |
| Accounts | Sign-In with Ethereum (ERC-4361) with one-time nonces, domain binding and expiry. Link several wallets to one account. |
| Communities | Multiple branded community spaces, roles (owner, instructor, member), staff invite links, member directory. |
| Access | Token gates written in plain language: ERC-721, ERC-1155, ERC-20 balance, allowlist, prerequisite course, and any/all combinations. Checked at enrollment and on every protected request. Balances are cached; an RPC outage shows "try again" instead of revoking access. |
| Courses | Draft, publish, archive. Every publish is an immutable version; learners stay on the version they enrolled in. Text and video lessons, private uploads, downloads. |
| Assessment | Server-graded quizzes drawn at random from a question bank, attempt limits and cooldowns. Practical assignments reviewed against a rubric, with revision rounds, duplicate flagging and appeals. |
| Completion | Recorded only when every server-side condition holds. Issues a credential with a public verification page and printable certificate. Revocable, with reasons. |
| Rewards | Points and course credits. Campaigns with per-completion amounts, caps and budgets, "first approved" or "reserved at enrollment" allocation, optional owner approval, claim deadlines. Claims are idempotent and every payout is a unique ledger entry. Course credits can pay for other courses. |
| Operations | Community analytics, audit log of sensitive actions, platform admin console (health, communities, users, disputes, audit). |

Not in this release, by design (see the blueprint): on-chain reward payouts, multiple chains at once, embedded wallets, portable Open Badges exports, a platform token.

## Run it locally

Requires Node 22+.

```bash
npm install
npm run seed     # demo communities, courses, a pending review and test balances
npm run dev      # API on :3000, web app on http://localhost:5173
```

No database or blockchain setup is needed for development: the server uses embedded Postgres (PGlite, stored in `server/data/`) and a simulated chain.

Open http://localhost:5173 and choose **Sign in**. In development the dialog offers four well-known test wallets:

| Wallet | Try this |
| --- | --- |
| Ada (community owner) | Manage the Ileri Security Guild: course builder, access rules, campaigns, analytics, audit log. |
| Bayo (instructor) | Review Chioma's pending submission under **Manage → Reviews**. |
| Chioma (learner, holds pass) | Dashboard, course player, quiz, rewards, credentials. |
| Dele (learner, no pass) | See why the guild is locked, then grant yourself a pass in **Settings → Developer tools**. |

A browser wallet (MetaMask, Rabby, Coinbase Wallet) works too. The developer tools in Settings let you set simulated token balances and switch on a fake RPC outage.

To use real Postgres instead, set `DATABASE_URL`. Migrations run on startup.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API with reload plus the Vite dev server |
| `npm run seed` | Load demo data through the real API (skips if already present) |
| `npm test` | Server test suite on embedded Postgres |
| `npm run test:pg` | Same suite on real Postgres (`TEST_DATABASE_URL`, one throwaway database per file) |
| `npm run e2e` | Browser journeys with Playwright against a freshly seeded server |
| `npm run typecheck` | TypeScript for server, web and shared code |
| `npm run build` | Build the web app and bundle the server into `server/dist` |
| `npm start` | Run the built server; it also serves the built web app |
| `npm run db:generate` | Generate a migration after editing `server/src/db/schema.ts` |

## Configuration

All settings are environment variables; see [`.env.example`](.env.example). A `.env` file in the repo root or `server/` is loaded automatically.

The ones that matter for production:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 14+. |
| `APP_SECRET` | 32+ random characters. Signs private media links. Required in production. |
| `APP_ORIGIN` | The public origin(s), e.g. `https://learn.example.org`. Used for SIWE domain binding and CSRF checks. |
| `CHAIN_MODE=rpc`, `SUPPORTED_CHAIN_IDS`, `RPC_URL_<id>` | Real balance reads. The server refuses to start in production with the mock chain or dev mode. |
| `TRUST_PROXY=true` | Only behind a proxy you control, so audit logs and rate limits see real client IPs. |
| `UPLOAD_DIR` | Private files live here. Mount a persistent volume. |
| `PLATFORM_ADMIN_WALLETS` | Wallets that get the platform admin console. |
| `JOBS_ENABLED` | Background jobs (campaign expiry, cleanup). Enable on exactly one instance. |

## Deploying

```bash
npm ci
npm run build
NODE_ENV=production npm start
```

One Node process serves the API, private media and the web app on `PORT`. Put it behind HTTPS (session cookies are `Secure` in production). Back up the database and the upload directory together, and test restores.

## Project layout

```
shared/   Access rules, course content schema and helpers used by both server and web
server/   Fastify API, Drizzle schema and migrations, tests, seed script
web/      React app (Vite)
e2e/      Playwright journeys
docs/     Blueprint and architecture notes
```

## Security notes

- Access is enforced on the server for every protected request and media file. Hiding a button is never the control.
- Quiz answers never leave the server. Learners see their score, not which answers were right.
- A reviewer cannot review their own work, and the reviewer who made a decision cannot resolve its appeal.
- Reward claims lock the entitlement row, move through a forward-only state machine and post to a ledger with a unique source key, so retries and double clicks cannot pay twice. This is tested against real Postgres with concurrent requests.
- Wallet ownership does not prove a unique person. For higher-value campaigns, turn on owner approval of claims. Stronger identity checks are future work.
- `npm audit` reports a moderate advisory in an old esbuild bundled with `drizzle-kit`. It is a development-only tool used to generate migrations and is not part of the running app.
