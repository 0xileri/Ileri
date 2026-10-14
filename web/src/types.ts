import type { AccessRule, RuleResult, RuleState } from '../../shared/src/access';
import type { CourseContent } from '../../shared/src/content';

export type Role = 'owner' | 'instructor' | 'member';

export interface AppConfig {
  devMode: boolean;
  chainMode: 'mock' | 'rpc';
  supportedChainIds: number[];
  communityCreation: 'open' | 'admin';
  siweStatement: string;
}

export interface Me {
  user: { id: string; displayName: string; bio: string; isPlatformAdmin: boolean; createdAt: string } | null;
  wallets?: { id: string; address: string; verifiedAt: string }[];
  memberships?: { communityId: string; slug: string; name: string; logoUrl: string | null; accentColor: string; role: Role }[];
}

export interface Requirements {
  summary: string;
  state: RuleState | 'open';
  evaluated: boolean;
  result: RuleResult | null;
}

export interface CampaignSummary {
  id: string;
  courseId: string;
  name: string;
  rewardKind: 'points' | 'course_credits';
  amountPerCompletion: number;
  allocationMode: 'first_approved' | 'reserved_at_enrollment';
  requiresApproval: boolean;
  startsAt: string;
  endsAt: string | null;
  claimDeadline: string | null;
  status: 'draft' | 'active' | 'paused' | 'ended';
  live: boolean;
  remaining: number | null;
  maxRewards: number | null;
}

export type Stage = 'enrolled' | 'learning' | 'submitted' | 'under_review' | 'revision_required' | 'approved' | 'completed';

export interface EnrollmentSummary {
  enrollmentId: string;
  courseId: string;
  versionId: string;
  stage: Stage;
  progressPercent: number;
  lessonsDone: number;
  lessonsTotal: number;
  lastLessonId: string | null;
  enrolledAt: string;
  lastActivityAt: string;
  completedAt: string | null;
}

export interface CommunityCard {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  logoUrl: string | null;
  accentColor: string;
  memberCount: number;
  courseCount: number;
  joinSummary: string;
  myRole: Role | null;
}

export interface CommunityDetail {
  community: {
    id: string;
    slug: string;
    name: string;
    tagline: string;
    description: string;
    logoUrl: string | null;
    accentColor: string;
    visibility: 'public' | 'unlisted';
    status: 'active' | 'suspended';
    createdAt: string;
    memberCount: number;
    joinPolicy?: AccessRule | null;
  };
  membership: { role: Role; joinedAt: string } | null;
  viewerIsPlatformAdmin: boolean;
  join: Requirements;
}

export interface CourseCard {
  id: string;
  slug: string;
  title: string;
  summary: string;
  coverUrl: string | null;
  status: 'draft' | 'published' | 'archived';
  creditCost: number;
  accessSummary: string;
  lessonCount: number;
  estimatedMinutes: number;
  hasCredential: boolean;
  versionNumber: number | null;
  campaigns: CampaignSummary[];
  myEnrollment: EnrollmentSummary | null;
}

export interface OutlineModule {
  id: string;
  title: string;
  lessons: { id: string; title: string; kind: 'text' | 'video'; estimatedMinutes: number; required: boolean; completed?: boolean }[];
}

export interface CoursePreview {
  course: { id: string; slug: string; title: string; summary: string; coverUrl: string | null; status: string; creditCost: number };
  community: { id: string; slug: string; name: string; logoUrl: string | null; accentColor: string };
  version: { id: string; versionNumber: number; status: string; publishedAt: string | null };
  description: string;
  outcomes: string[];
  prerequisitesText: string;
  instructorName: string;
  outline: OutlineModule[];
  lessonCount: number;
  estimatedMinutes: number;
  quiz: { questionsPerAttempt: number; passPercent: number; maxAttempts: number } | null;
  assignment: { title: string } | null;
  completionRequirements: string[];
  credential: { title: string } | null;
  campaigns: CampaignSummary[];
  access: Requirements;
  viewerRole: Role | 'admin' | null;
  myEnrollment: EnrollmentSummary | null;
  myCompletion: { id: string; completedAt: string; status: string } | null;
}

export interface ReviewRecord {
  decision: 'approved' | 'revision_required';
  comment: string;
  rubric: { criterionId: string; met: boolean; note?: string }[];
  createdAt: string;
  viaAppeal: boolean;
  reviewerName?: string;
}

export interface SubmissionRecord {
  id: string;
  attemptNumber: number;
  status: 'submitted' | 'under_review' | 'approved' | 'revision_required';
  text: string;
  linkUrl: string | null;
  file: { url: string } | null;
  createdAt: string;
  decidedAt: string | null;
  reviews: ReviewRecord[];
  appeal?: { status: 'open' | 'upheld' | 'overturned'; reason: string; resolutionNote: string; createdAt: string } | null;
}

export interface LearnView {
  course: { id: string; title: string; summary: string; status: string };
  community: { id: string; slug: string; name: string; accentColor: string; logoUrl: string | null };
  version: { id: string; versionNumber: number; isCurrent: boolean };
  access: { state: 'granted' } | { state: 'denied' | 'unavailable'; message: string; requirements: Requirements | null };
  stage: Stage;
  progress: { percent: number; lessonsDone: number; lessonsTotal: number };
  lastLessonId: string | null;
  requirements: string[];
  modules: OutlineModule[];
  quiz: {
    title: string;
    required: boolean;
    passPercent: number;
    questionsPerAttempt: number;
    maxAttempts: number;
    attemptsUsed: number;
    bestScore: number | null;
    passed: boolean;
    openAttemptId: string | null;
    cooldownUntil: string | null;
    history: { id: string; scorePercent: number; passed: boolean; submittedAt: string }[];
  } | null;
  assignment: {
    title: string;
    required: boolean;
    prompt: string | null;
    allowLink: boolean;
    allowFile: boolean;
    rubric: { id: string; title: string; description: string; required: boolean }[];
    submissions: SubmissionRecord[];
  } | null;
  completion: { status: 'valid' | 'revoked'; completedAt: string; credential: { publicId: string; status: string } | null } | null;
  rewards: { id: string; campaignName: string; rewardKind: 'points' | 'course_credits'; amount: number; status: string; note: string }[];
}

export interface LessonView {
  lesson: {
    id: string;
    title: string;
    kind: 'text' | 'video';
    body: string;
    videoUrl: string | null;
    video: { url: string; mimeType: string } | null;
    attachments: { name: string; url: string }[];
    estimatedMinutes: number;
    required: boolean;
    completed: boolean;
  };
  previousLessonId: string | null;
  nextLessonId: string | null;
}

export interface QuizAttempt {
  id: string;
  startedAt: string;
  questions: { id: string; prompt: string; kind: 'single' | 'multiple'; options: { id: string; text: string }[] }[];
}

export interface QuizResult {
  scorePercent: number;
  passed: boolean;
  correct: number;
  total: number;
  passPercent: number;
  attemptsRemaining: number;
  courseCompleted: boolean;
  credentialPublicId: string | null;
}

export interface CourseEditor {
  course: {
    id: string;
    communityId: string;
    slug: string;
    title: string;
    summary: string;
    coverUrl: string | null;
    status: 'draft' | 'published' | 'archived';
    accessPolicy: AccessRule | null;
    creditCost: number;
    currentVersionId: string | null;
    accessSummary: string;
  };
  community: { id: string; slug: string; name: string };
  versions: {
    id: string;
    versionNumber: number;
    status: 'draft' | 'published' | 'retired';
    changeNote: string;
    publishedAt: string | null;
    updatedAt: string;
    enrollmentCount: number;
  }[];
  draft: { id: string; versionNumber: number; content: CourseContent; changeNote: string; issues: string[] } | null;
  published: { id: string; versionNumber: number; content: CourseContent } | null;
  otherCourses: { id: string; title: string }[];
  supportedChainIds: number[];
}

export interface RewardRow {
  id: string;
  status: 'reserved' | 'eligible' | 'submitted' | 'pending' | 'confirmed' | 'failed' | 'rejected' | 'expired' | 'unfunded';
  amount: number;
  note: string;
  createdAt: string;
  eligibleAt: string | null;
  claimedAt: string | null;
  resolvedAt: string | null;
  campaignName: string;
  rewardKind: 'points' | 'course_credits';
  claimDeadline: string | null;
  requiresApproval: boolean;
  courseId: string;
  courseTitle: string;
  communityName: string;
  communitySlug: string;
}

export interface CredentialRow {
  publicId: string;
  title: string;
  courseTitle: string;
  courseId?: string;
  versionNumber?: number;
  recipientName?: string;
  issuedAt: string;
  status: 'active' | 'revoked';
  revokedReason?: string | null;
  communityName?: string;
  communitySlug?: string;
  accentColor?: string;
}

export interface VerifyView {
  credential: {
    publicId: string;
    title: string;
    recipientName: string;
    courseTitle: string;
    courseId: string;
    versionNumber: number;
    criteria: string;
    issuedAt: string;
    status: 'active' | 'revoked';
    revokedAt: string | null;
    revokedReason: string | null;
  };
  issuer: { name: string; slug: string; logoUrl: string | null; accentColor: string; status: string };
  verification: { valid: boolean; checkedAt: string; verifyUrl: string };
}
