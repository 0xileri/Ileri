import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AccessRule } from '../../../shared/src/access';
import type { CourseContent } from '../../../shared/src/content';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull().default(''),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  createdAt: createdAt(),
});

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Lowercased 0x address. A wallet belongs to exactly one account. */
    address: text('address').notNull(),
    verifiedAt: ts('verified_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wallets_address_uq').on(t.address), index('wallets_user_idx').on(t.userId)],
);

export const authNonces = pgTable('auth_nonces', {
  nonce: text('nonce').primaryKey(),
  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 of the cookie token; the raw token is never stored. */
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    userAgent: text('user_agent'),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash)],
);

// ---------------------------------------------------------------------------
// Communities
// ---------------------------------------------------------------------------

export const communities = pgTable(
  'communities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    tagline: text('tagline').notNull().default(''),
    description: text('description').notNull().default(''),
    logoUrl: text('logo_url'),
    accentColor: text('accent_color').notNull().default('#2f6b4f'),
    visibility: text('visibility', { enum: ['public', 'unlisted'] }).notNull().default('public'),
    status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
    /** Who may join. Null means anyone with an account. */
    joinPolicy: jsonb('join_policy').$type<AccessRule | null>(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('communities_slug_uq').on(t.slug)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'instructor', 'member'] }).notNull().default('member'),
    status: text('status', { enum: ['active', 'left', 'removed'] }).notNull().default('active'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('memberships_community_user_uq').on(t.communityId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    role: text('role', { enum: ['owner', 'instructor'] }).notNull(),
    note: text('note').notNull().default(''),
    maxUses: integer('max_uses').notNull().default(1),
    uses: integer('uses').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invites_token_uq').on(t.tokenHash), index('invites_community_idx').on(t.communityId)],
);

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    coverUrl: text('cover_url'),
    status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
    /** Extra requirement on top of community membership. Null means members only. */
    accessPolicy: jsonb('access_policy').$type<AccessRule | null>(),
    /** Course credits spent at enrollment. 0 means free. */
    creditCost: integer('credit_cost').notNull().default(0),
    currentVersionId: uuid('current_version_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('courses_community_slug_uq').on(t.communityId, t.slug)],
);

export const courseVersions = pgTable(
  'course_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    status: text('status', { enum: ['draft', 'published', 'retired'] }).notNull().default('draft'),
    content: jsonb('content').$type<CourseContent>().notNull(),
    changeNote: text('change_note').notNull().default(''),
    publishedAt: ts('published_at'),
    publishedBy: uuid('published_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('course_versions_course_number_uq').on(t.courseId, t.versionNumber)],
);

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => courseVersions.id),
    lastLessonId: text('last_lesson_id'),
    createdAt: createdAt(),
    lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    uniqueIndex('enrollments_user_course_uq').on(t.userId, t.courseId),
    index('enrollments_course_idx').on(t.courseId),
    index('enrollments_community_idx').on(t.communityId),
  ],
);

export const lessonProgress = pgTable(
  'lesson_progress',
  {
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    lessonId: text('lesson_id').notNull(),
    completedAt: ts('completed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.enrollmentId, t.lessonId] })],
);

export type AttemptQuestion = { questionId: string; optionOrder: string[] };
export type AttemptAnswers = Record<string, string[]>;

export const quizAttempts = pgTable(
  'quiz_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => courseVersions.id),
    quizId: text('quiz_id').notNull(),
    questions: jsonb('questions').$type<AttemptQuestion[]>().notNull(),
    answers: jsonb('answers').$type<AttemptAnswers>(),
    scorePercent: integer('score_percent'),
    passed: boolean('passed'),
    startedAt: ts('started_at').notNull().defaultNow(),
    submittedAt: ts('submitted_at'),
  },
  (t) => [index('quiz_attempts_enrollment_idx').on(t.enrollmentId)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => courseVersions.id),
    assignmentId: text('assignment_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    text: text('text').notNull().default(''),
    linkUrl: text('link_url'),
    mediaId: uuid('media_id'),
    /** SHA-256 of normalised text, used to flag copied work for reviewers. */
    contentHash: text('content_hash'),
    duplicateOfId: uuid('duplicate_of_id'),
    status: text('status', {
      enum: ['submitted', 'under_review', 'approved', 'revision_required'],
    })
      .notNull()
      .default('submitted'),
    reviewerId: uuid('reviewer_id').references(() => users.id),
    claimedAt: ts('claimed_at'),
    decidedAt: ts('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('submissions_enrollment_attempt_uq').on(t.enrollmentId, t.attemptNumber),
    index('submissions_community_status_idx').on(t.communityId, t.status),
    index('submissions_course_hash_idx').on(t.courseId, t.contentHash),
  ],
);

export type RubricScore = { criterionId: string; met: boolean; note?: string };

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id),
    decision: text('decision', { enum: ['approved', 'revision_required'] }).notNull(),
    rubric: jsonb('rubric').$type<RubricScore[]>().notNull(),
    comment: text('comment').notNull().default(''),
    /** True when the decision came from resolving an appeal. */
    viaAppeal: boolean('via_appeal').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('reviews_submission_idx').on(t.submissionId)],
);

export const appeals = pgTable(
  'appeals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['open', 'upheld', 'overturned'] }).notNull().default('open'),
    resolutionNote: text('resolution_note').notNull().default(''),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    createdAt: createdAt(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    uniqueIndex('appeals_submission_uq').on(t.submissionId),
    index('appeals_community_status_idx').on(t.communityId, t.status),
  ],
);

export type CompletionEvidence = {
  lessonsCompleted: number;
  quizAttemptId?: string;
  quizScore?: number;
  submissionId?: string;
  reviewId?: string;
};

export const completions = pgTable(
  'completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => courseVersions.id),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    evidence: jsonb('evidence').$type<CompletionEvidence>().notNull(),
    status: text('status', { enum: ['valid', 'revoked'] }).notNull().default('valid'),
    completedAt: ts('completed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('completions_user_course_uq').on(t.userId, t.courseId),
    index('completions_community_idx').on(t.communityId),
  ],
);

export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Unguessable identifier used in public verification links. */
    publicId: text('public_id').notNull(),
    completionId: uuid('completion_id')
      .notNull()
      .references(() => completions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => courseVersions.id),
    versionNumber: integer('version_number').notNull(),
    recipientName: text('recipient_name').notNull(),
    title: text('title').notNull(),
    courseTitle: text('course_title').notNull(),
    criteria: text('criteria').notNull(),
    issuedAt: ts('issued_at').notNull().defaultNow(),
    status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
    revokedBy: uuid('revoked_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('credentials_public_id_uq').on(t.publicId),
    uniqueIndex('credentials_completion_uq').on(t.completionId),
    index('credentials_user_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

export const rewardCampaigns = pgTable(
  'reward_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    rewardKind: text('reward_kind', { enum: ['points', 'course_credits'] }).notNull(),
    amountPerCompletion: integer('amount_per_completion').notNull(),
    /** Optional caps. A null cap is unlimited; the effective limit is whichever binds first. */
    maxRewards: integer('max_rewards'),
    totalBudget: integer('total_budget'),
    allocationMode: text('allocation_mode', { enum: ['first_approved', 'reserved_at_enrollment'] })
      .notNull()
      .default('first_approved'),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    claimDeadline: ts('claim_deadline'),
    status: text('status', { enum: ['draft', 'active', 'paused', 'ended'] }).notNull().default('draft'),
    /** Running totals of budget committed to reserved, claimable and paid entitlements. */
    allocatedCount: integer('allocated_count').notNull().default(0),
    allocatedAmount: integer('allocated_amount').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('reward_campaigns_course_idx').on(t.courseId)],
);

export const rewardEntitlements = pgTable(
  'reward_entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => rewardCampaigns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id').references(() => enrollments.id, { onDelete: 'set null' }),
    completionId: uuid('completion_id').references(() => completions.id, { onDelete: 'set null' }),
    amount: integer('amount').notNull(),
    /**
     * reserved   budget held at enrollment, not yet earned
     * eligible   earned and claimable
     * submitted  claimed, waiting for owner approval
     * pending    reserved for asynchronous payouts (on-chain, later)
     * confirmed  paid into the learner's balance
     * failed     payout failed and can be retried
     * rejected   owner declined the claim
     * expired    claim deadline passed, budget released
     * unfunded   completion was approved after the budget ran out
     */
    status: text('status', {
      enum: ['reserved', 'eligible', 'submitted', 'pending', 'confirmed', 'failed', 'rejected', 'expired', 'unfunded'],
    }).notNull(),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    eligibleAt: ts('eligible_at'),
    claimedAt: ts('claimed_at'),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    uniqueIndex('reward_entitlements_campaign_user_uq').on(t.campaignId, t.userId),
    index('reward_entitlements_user_idx').on(t.userId),
    index('reward_entitlements_community_status_idx').on(t.communityId, t.status),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['points', 'course_credits'] }).notNull(),
    amount: integer('amount').notNull(),
    reason: text('reason', { enum: ['reward', 'enrollment', 'adjustment'] }).notNull(),
    /** (sourceType, sourceId) is unique so a retried payout can never post twice. */
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    memo: text('memo').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ledger_source_uq').on(t.sourceType, t.sourceId),
    index('ledger_user_community_idx').on(t.userId, t.communityId),
  ],
);

// ---------------------------------------------------------------------------
// Media, chain cache, audit
// ---------------------------------------------------------------------------

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    /** Set for learner uploads, which only the learner and reviewers may read. */
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['lesson', 'submission'] }).notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('media_community_idx').on(t.communityId)],
);

export const balanceCache = pgTable(
  'balance_cache',
  {
    chainId: integer('chain_id').notNull(),
    standard: text('standard', { enum: ['erc20', 'erc721', 'erc1155'] }).notNull(),
    contract: text('contract').notNull(),
    tokenId: text('token_id').notNull().default(''),
    owner: text('owner').notNull(),
    balance: text('balance').notNull(),
    fetchedAt: ts('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.standard, t.contract, t.tokenId, t.owner] })],
);

/** Token balances for the mock chain used in development and tests. */
export const devBalances = pgTable(
  'dev_balances',
  {
    chainId: integer('chain_id').notNull(),
    standard: text('standard', { enum: ['erc20', 'erc721', 'erc1155'] }).notNull(),
    contract: text('contract').notNull(),
    tokenId: text('token_id').notNull().default(''),
    owner: text('owner').notNull(),
    balance: text('balance').notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.standard, t.contract, t.tokenId, t.owner] })],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    communityId: uuid('community_id'),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_community_created_idx').on(t.communityId, t.createdAt),
    index('audit_action_idx').on(t.action),
  ],
);
