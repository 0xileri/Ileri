# Architecture

How the [blueprint](blueprint.md) became code, and the decisions made where it left room.

## Shape of the system

```
web/ (React, Vite)                 Learner, community and admin screens
   │  JSON over /api, cookie session
server/ (Fastify)                  Auth, access checks, courses, assessment, reviews,
   │                               completion, credentials, rewards, analytics, audit
   ├── PostgreSQL (Drizzle)        All learning data, ledger, audit log
   ├── Private file storage        Lesson media and submissions, served by signed links
   ├── In-process jobs             Campaign expiry, nonce and session cleanup
   └── Chain reader                Token balances via RPC (viem) or a mock chain in dev
shared/                            Access rule schema and wording, course content schema
```

Only token balances come from the chain. Lessons, grades, submissions, reviews and personal data stay off-chain, as the blueprint recommends. There is no custom contract: the first release gates on tokens communities already have.

## Three separate systems

The blueprint's central point is that access, verification and rewards are different decisions. The code keeps them apart.

| System | Where | Decides |
| --- | --- | --- |
| Access | `server/src/access/`, `shared/src/access.ts` | Who may join a community or open a course, right now |
| Verification | `server/src/learning/`, `server/src/reviews/` | Whether a learner met every completion condition |
| Rewards | `server/src/rewards/` | What an approved completion receives, within the budget |

`evaluateCompletion()` in `server/src/learning/completion.ts` is the only place a completion is recorded. It runs inside the transaction of whatever action might complete a course (finishing a lesson, passing a quiz, an approval, an overturned appeal), re-checks every condition on the server, then issues the credential and allocates rewards in the same transaction.

## Access rules

Rules are JSON trees validated with zod and shared by server and web:

```json
{ "type": "all", "rules": [
  { "type": "erc721", "chainId": 8453, "contract": "0x…", "minBalance": 1, "label": "Guild Pass" },
  { "type": "course_completion", "courseId": "…" }
] }
```

Leaf types: `erc721`, `erc1155`, `erc20`, `allowlist`, `course_completion`. Groups: `all`, `any`, nested up to three levels. The same tree produces the plain-language sentence members see ("Hold an NFT from Guild Pass on Base and complete "Intro"") and a checklist showing which parts they meet.

**When it is checked.** At enrollment, and on every protected request: lesson content, quiz attempts, submissions, uploads. A course's effective rule is the community's join rule plus the course's own rule.

**Three-valued logic.** Each node evaluates to eligible, ineligible or unknown. Unknown means the chain could not be read. `all` is ineligible if any child is, otherwise unknown if any child is. `any` is eligible if any child is, otherwise unknown if any child is. An unknown result returns HTTP 503 with a retry message, never a denial.

**Caching.** Balances are cached in `balance_cache` for `BALANCE_CACHE_TTL_SECONDS` (default 5 minutes). If a refresh fails, a cached value younger than `BALANCE_STALE_GRACE_SECONDS` (default 1 hour) is used. After that the result is unknown. Balances are summed across all of a learner's verified wallets.

**Losing eligibility.** Progress, completions and credentials are kept. Gated content returns 403 `access_suspended` with the requirement checklist, and the course player explains that access returns once they qualify again.

## Versioned course content

A course has many `course_versions`; each stores its full content (modules, lessons, quiz bank with answers, assignment, rubric, completion rules, credential settings) as one JSON document. At most one draft exists at a time. Publishing freezes the draft, retires the previous published version and points the course at the new one.

Enrollments pin a version. Lesson IDs, quiz questions and rubrics a learner sees always come from their pinned version, and completions and credentials record the version number. Editing a course can never change what someone already completed.

Learner-facing endpoints build their own views from the version document, so answers and rubric internals are never serialized to learners by accident.

## Verification flow

```
Enrolled → Learning → Submitted → Under review → Approved / Revision required → Completed
```

The stage is derived from data, not stored, so it can't drift.

- **Quizzes.** An attempt draws `questionsPerAttempt` questions at random and shuffles options, storing the order. Submission grades on the server; a question scores only if the selected set exactly matches the correct set. Learners see their score, not which answers were right. Attempt limits, cooldowns and one open attempt at a time are enforced in a transaction.
- **Assignments.** Text, a link and/or a file. Each resubmission is a new numbered attempt, so the history is preserved. Text is normalised and hashed; matching another learner's text or link flags the submission as a possible copy for the reviewer (it is not blocked).
- **Reviews.** Reviewers score every rubric criterion. Approval requires every required criterion to be met; sending back requires a comment. Reviewers cannot review their own work.
- **Appeals.** A learner can appeal their latest "revision required" decision once. An owner who did not make the original decision (or a platform admin) upholds or overturns it. Overturning records an approval marked "via appeal" and re-runs completion.
- **Audit.** Every decision, publish, policy change, credential issue or revocation, claim and adjustment is written to `audit_events` in the same transaction.

## Credentials

Issued once per completion with an unguessable public ID (`cred_…`). They record the issuing community, the learner's display name at issue time, course and version, criteria and issue date. `/verify/:id` is public and checks the live record, so revocations show immediately. Credentials belong to the account, not a wallet or token, so they cannot be sold by transferring an NFT.

Revoking a credential also revokes the completion and releases any reward not yet paid. Paid rewards stay in the ledger and are listed in the audit entry.

## Rewards

The first release uses points and course credits, as the blueprint recommends. Both live in an append-only `ledger_entries` table, scoped per community, with a unique `(source_type, source_id)` so a payout or a credit spend can only post once.

**Campaigns** belong to a course and set an amount per completion, an optional cap on rewarded completions and/or a total budget (whichever binds first), start and end dates, an optional claim deadline, and whether claims need owner approval.

**Allocation modes.**

- *First approved:* budget is committed when a completion is approved. Course pages show how many rewards are left before anyone enrolls. If the budget is gone, the learner still gets a visible "budget used up" record rather than silence.
- *Reserved at enrollment:* budget is committed when someone enrolls, guaranteeing the reward if they finish. These campaigns must have a cap. Reservations are released when the campaign ends or the claim deadline passes.

**Claim states:** `reserved → eligible → submitted (if approval required) → confirmed`, plus `rejected`, `expired`, `unfunded`, and `pending`/`failed` reserved for future on-chain payouts. Claims lock the entitlement row (`SELECT … FOR UPDATE`) and only move forward. Repeated or concurrent claims return the current state; the test suite checks this with parallel requests on real Postgres.

**Course credits** can be spent on courses with a `creditCost`. The spend happens in the enrollment transaction under a per-learner advisory lock, so two enrollments can't both spend the same balance.

## Permissions

Every community-scoped route loads the community from the record being touched and calls `requireCommunityRole()`. Roles are per community: member < instructor < owner. Instructors create and publish courses and review work; owners also manage access rules, members, invites, campaigns, claims, credentials and the audit log. Platform administrators can act anywhere and are recorded as such. The isolation tests probe every staff endpoint across communities.

## Authentication

Sign-In with Ethereum (ERC-4361). The server issues a nonce, the wallet signs a message bound to the site's domain and origin with a short expiry, and the server checks domain, URI, freshness, expiry and signature before atomically consuming the nonce (so a replay always fails). Smart-contract wallets are supported through ERC-1271/6492 verification when an RPC is configured. Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production), stored hashed. Additional wallets are linked by signing with each one.

## Media

Uploads are streamed to private storage with size limits and a type allowlist (no HTML or SVG). Files are only reachable through `/media/:id?exp=…&sig=…` links, HMAC-signed with `APP_SECRET` and valid for 15 minutes, which are issued only after an access check. Responses carry `nosniff`, a restrictive CSP and support range requests for video seeking.

## Decisions made for this release

| Question | Choice | Why |
| --- | --- | --- |
| Which chain | Base (`8453`) by default, configurable | Cheap, common for community passes. Rules store a chain ID so more chains are a config change. |
| Rewards | Points and course credits | The blueprint's recommended first step. The entitlement states already allow on-chain payouts later. |
| Who can create communities | Anyone signed in (`COMMUNITY_CREATION=open`) | Easy pilots. Switch to `admin` for a curated launch. |
| Staff invites | Links for instructors and co-owners only | Members join through the access rules, which are re-checked anyway. |
| Video | YouTube/Vimeo links or private uploads | Covers most needs without a video pipeline. |
| One completion per course | Yes, per account | Keeps credentials and rewards unambiguous. A revoked completion stays revoked. |

## Known limits and next steps

- Wallet ownership is not proof of a unique person. Owner approval of claims is the current control for valuable rewards.
- Background jobs run in-process; run them on one instance (`JOBS_ENABLED`).
- File storage is local disk. An S3-compatible backend behind the same `LocalStorage` interface is the natural next step.
- From the blueprint's "add later" list: funded on-chain rewards with a reviewed distributor contract, more chains, embedded wallets, learning paths, community integrations, Open Badges 3.0 exports, enterprise reporting.

## Testing

- `server/test/`: API tests on embedded Postgres by default, or real Postgres with `TEST_DATABASE_URL` (one throwaway database per file). They cover SIWE replay and domain binding, every rule type and the outage behaviour, version pinning, quiz grading and limits, the review and appeal flow, duplicate flags, reward caps and concurrency, credit spending, revocation, media signing, cross-community isolation and static hosting.
- `e2e/`: Playwright journeys through the real UI, from a locked member to an approved completion, credential verification, spending earned credits, publishing a new version, a simulated RPC outage, and the player on a phone-sized screen.
