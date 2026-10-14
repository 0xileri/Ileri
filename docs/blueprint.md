# Product blueprint

The product brief this codebase implements. Decisions taken while building it are in [architecture.md](architecture.md).

---

Your platform would let communities **give eligible members access to courses, verify what they have learned, and reward successful completion**.

The strongest starting point is a platform where communities bring their members and fund learning incentives. Tokens control access; assessments establish achievement; rewards encourage participation.

Below is a build blueprint. I’m assuming a web platform serving multiple communities, with existing community tokens accepted for access.

**1. What the product does**

The core journey is:

**Join a community → verify eligibility → enroll → learn → pass assessment → receive a credential and reward.**

For example:

> A community offers a cybersecurity course to holders of its membership NFT. A member connects their wallet, gains access, completes the lessons, passes a quiz, and submits a practical assignment. After verification, they receive a completion credential and a reward funded by the community.

You should treat these as three separate systems:

| System | Purpose |
|---|---|
| Access | Determines who can enter a community or course |
| Verification | Determines whether a learner met the completion requirements |
| Rewards | Determines what an approved learner receives |

Owning a token establishes eligibility. It does not establish learning.

**2. Who uses it**

| Role | Main capabilities |
|---|---|
| Learner | Join communities, take courses, submit work, claim rewards |
| Community owner | Configure access, publish courses, fund rewards, view results |
| Instructor | Create lessons, write assessments, review submissions |
| Platform administrator | Manage communities, disputes, security, and platform operations |
| Credential verifier | Check a shared credential’s issuer and validity |

One person can have different roles in different communities.

**3. Learner experience**

A learner should be able to:

- Create an account and connect a wallet.
- See communities and courses they qualify for.
- Understand why a course is locked and how to qualify.
- Enroll and resume lessons across devices.
- Complete quizzes and practical assignments.
- Track progress, review status, and reward eligibility.
- Receive a shareable completion credential.
- Claim an available reward and see its payment status.
- Appeal a rejected submission.

Design for mobile from the beginning. Wallet signatures, assessments, and reward claims must work comfortably on a phone.

**4. Community owner experience**

Each community gets its own branded learning space with:

- Community name, logo, description, and member directory.
- Course catalog and learning paths.
- Membership and course access rules.
- Instructor invitations and permissions.
- Reward campaign settings and budget visibility.
- Submission review queue.
- Completion, engagement, and reward reports.

A community owner could configure:

> “Members holding at least one token from this collection can enroll. Completion requires passing the quiz and receiving assignment approval. The first 100 approved learners receive the configured reward.”

The interface should explain these rules in ordinary language.

**5. Token-gated access**

Support a small set of access rules first:

| Rule | Example |
|---|---|
| NFT ownership | Hold one NFT from an approved collection |
| Token balance | Hold at least a specified quantity |
| Allowlist | Wallet appears on an approved list |
| Previous achievement | Complete an introductory course |
| Combined rule | Hold a membership token and complete a prerequisite |

Every token rule needs a chain, contract address, and any relevant token ID or minimum balance.

ERC-721 represents individually identifiable NFTs. ERC-1155 supports multiple token types within a contract, which can suit membership tiers or course passes. These are standards you can support without issuing your own token. [ERC-721](https://eips.ethereum.org/EIPS/eip-721), [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155)

**Recommended access policy:** check eligibility at enrollment and whenever protected content is requested. If someone loses eligibility, preserve their progress and earned credentials while suspending access to gated lessons.

Also decide how long eligibility checks remain cached. A temporary blockchain service outage should show a retry message rather than incorrectly telling someone they have lost membership.

**6. Course and assessment system**

A course should contain:

- Description, learning outcomes, prerequisites, and instructor.
- Modules containing video, text, downloads, and exercises.
- Quizzes with question banks and configurable pass scores.
- Assignments with clear assessment rubrics.
- Completion requirements.
- Credential and reward details.
- Course version and publication status.

Support draft, published, and archived courses. Preserve the version a learner completed so later course edits do not silently change their achievement record.

For the first release, use video/text lessons, quizzes, and one practical assignment type.

**7. How completion gets verified**

This is the most important part of the product.

Video progress can help track participation, but it is weak evidence of understanding. Completion should depend on server-validated assessments.

A practical verification flow is:

1. Learner completes required lessons.
2. Server grades their quiz.
3. Learner submits practical work.
4. Instructor approves it against a rubric.
5. Platform checks all completion conditions.
6. Platform records an approved completion.
7. Credential and reward become available.

Use a clear status sequence:

`Enrolled → Learning → Submitted → Under review → Approved / Revision required`

Verification controls should include randomized questions, attempt limits, submission history, duplicate detection, and an audit trail of reviewer decisions.

**Important limitation:** proving wallet ownership does not prove that a unique person completed the course. Higher-value rewards need stronger identity or review controls to reduce repeat-account farming.

**8. Reward design**

Start with rewards that communities can sustainably fund:

| Reward | Suitable use |
|---|---|
| Points | Recognition and progression |
| Course credits | Access to further learning |
| Community privileges | Mentorship, events, advanced channels |
| Digital badges | Public recognition |
| Funded token rewards | Sponsor-backed learning campaigns |

My recommended first release is **credentials plus points or course credits**, followed by funded token campaigns once verification works reliably.

You do not need a new platform token to launch.

For financial reward campaigns, configure:

- Reward asset and amount.
- Total available budget.
- Maximum number of rewarded completions.
- Eligibility dates and claim deadline.
- Approval requirements.
- Duplicate claim prevention.
- Clear treatment of enrolled learners when the budget runs out.

If rewards are guaranteed at enrollment, reserve their budget then. If rewards go to the first approved completions, display that condition before enrollment.

**9. Credentials**

A completion credential should identify:

- Issuing community.
- Learner’s chosen identity or identifier.
- Course and version.
- Achievement criteria.
- Issue date.
- Credential identifier.
- Verification status and any revocation.

Offer a shareable verification page and downloadable certificate.

Keep credentials separate from tradable membership passes. A person should not be able to sell their learning achievement by transferring an access NFT.

Open Badges provides an established approach to portable achievement credentials; Open Badges 3.0 uses verifiable credentials. [1EdTech credentialing guidance](https://www.1edtech.org/sites/default/files/media/docs/2025/Six%20Steps%20for%20Successful%20Credentialing%20Report.pdf)

**10. Main screens**

| Area | Screens |
|---|---|
| Public | Landing page, community directory, course previews |
| Onboarding | Account creation, wallet connection, eligibility check |
| Learner | Dashboard, course player, assessment, submissions, rewards, credentials |
| Community | Overview, course builder, access settings, review queue, reward campaigns, analytics |
| Platform admin | Communities, users, disputes, audit logs, operational health |
| Verification | Public credential verification page |

The learner dashboard should answer three questions immediately: **What can I learn? What should I continue? What have I earned?**

**11. Technical architecture**

Use a conventional learning application with a blockchain integration layer.

```text
Web application
      ↓
Backend: authentication, access checks, courses, assessments
      ↓
Database, private media storage, background jobs
      ↓
Blockchain services: ownership checks and optional reward claims
```

Keep these off-chain:

- Personal information.
- Lessons and videos.
- Quiz answers and grades.
- Assignments and reviewer comments.
- Detailed learning activity.

Use blockchain where it adds value:

- Checking token ownership.
- Executing token reward claims.
- Optionally recording credential proofs.

The backend must enforce access on every protected request. Hiding a button in the interface is insufficient. Deliver private media through short-lived authorized links.

For Ethereum-compatible wallet login, use a structured sign-in message with a one-time nonce, domain binding, and expiration. Sign-In with Ethereum defines this approach. [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361)

**12. Core data model**

Your database will need these main records:

| Record | What it stores |
|---|---|
| Users and wallets | Account identity and verified wallet links |
| Communities and memberships | Community settings and roles |
| Access policies | Token and prerequisite requirements |
| Courses, versions, modules, lessons | Learning content |
| Enrollments and progress | Learner participation |
| Assessments and attempts | Questions, answers, results |
| Submissions and reviews | Practical work and approval decisions |
| Completions | Verified achievement |
| Credentials | Issuance and validity |
| Reward campaigns and claims | Budgets, entitlements, payment state |
| Audit events | Sensitive actions and changes |

Every community-owned record must be scoped to its community. Permissions should prevent one community from seeing another’s private learner data.

**13. Smart contracts**

If access depends on existing community tokens, your first version may need **no custom access contract**.

A custom reward distributor becomes useful when you introduce on-chain rewards. It should:

- Accept approved reward authorizations.
- Bind claims to the learner, campaign, amount, chain, and contract.
- Prevent reuse of a claim.
- Enforce funded campaign limits.
- Support expiration and emergency pausing.
- Emit events that the application can reconcile.

Keep course grading outside the contract. The contract can enforce an authorized payout; the platform and its reviewers remain responsible for the accuracy of completion decisions.

Real-fund reward contracts need independent security review before launch.

**14. Security and reliability requirements**

Prioritize:

- Wallet signature replay prevention.
- Strict community and instructor permissions.
- Private media authorization.
- Server-side grading and completion checks.
- Duplicate completion and reward prevention.
- Secure management of reward-signing keys.
- Safe upload handling.
- Backups and restore testing.
- Transaction reconciliation.
- Credential revocation and appeal records.

Reward claims need distinct states such as:

`Eligible → Submitted → Pending → Confirmed / Failed`

A failed or repeated request must never create a second payout.

**15. Revenue model**

The clearest initial customer is the community or organization purchasing learning infrastructure.

Possible revenue streams:

- Monthly community subscriptions.
- Plans based on active learners or usage.
- Branded learning portals.
- Sponsored course campaigns.
- Paid course enrollment.
- Enterprise training and reporting.

Keep platform fees and learner reward budgets visibly separate.

Your value proposition to community owners is: **provide useful learning, measure member achievement, and administer incentives in one place.**

**16. First release scope**

Build this first:

- Account creation and wallet linking.
- Multiple community spaces.
- One supported blockchain.
- Existing token ownership gates.
- Course creation and enrollment.
- Text/video lessons.
- Quizzes and practical submissions.
- Instructor review.
- Verified completion records.
- Shareable credentials.
- Points or course-credit rewards.
- Basic analytics and audit logs.

Add later:

- Funded on-chain rewards.
- More blockchains.
- Embedded wallets and sponsored transaction fees.
- Advanced learning paths.
- Community integrations.
- Portable credential exports.
- Enterprise reporting.

Defer a token launch, staking, complex governance, and an open course marketplace until the learning product has demonstrated demand.

**17. Delivery plan**

These are planning estimates for a small experienced team, assuming content is supplied and integrations remain limited.

| Phase | Deliverable | Indicative duration |
|---|---|---|
| Product definition | Requirements, access/reward policies, wireframes | 1–2 weeks |
| Foundation | Accounts, communities, permissions, wallet gates | 2–3 weeks |
| Learning | Course builder, player, progress, assessments | 3–4 weeks |
| Verification | Reviews, completions, credentials, basic rewards | 2–3 weeks |
| Pilot preparation | Security checks, accessibility, operational testing | 2–3 weeks |

Some work can overlap. A focused pilot is roughly **10–15 weeks** under these assumptions. Custom token rewards add implementation and independent review work.

A defensible cost estimate requires decisions about design depth, blockchain support, reward custody, expected usage, and team rates.

**18. What success looks like**

Track:

- Eligible members who enroll.
- Enrolled learners who achieve verified completion.
- Assessment and assignment outcomes.
- Time spent waiting for review.
- Learners returning for another course.
- Community renewal and retention.
- Reward cost per verified completion.
- Fraud, appeals, and failed claims.

The primary measure should be **verified learning outcomes**, supported by community retention.

My recommended build is a **community learning platform with existing-token access, assessed completion, shareable credentials, and community-funded incentives**.
