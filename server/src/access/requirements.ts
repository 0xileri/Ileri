import { summarizeRule, type RuleResult, type RuleState } from '../../../shared/src/access';
import type { AuthUser } from '../auth/session';
import type { AppContext } from '../context';
import type { courses } from '../db/schema';
import { AppError } from '../lib/errors';
import { activeMembership, isStaffRole, userWallets, type Community, type Membership } from '../permissions';
import { describePolicy, evaluatePolicies, loadDescribeContext } from './evaluate';

type Course = typeof courses.$inferSelect;

export interface Requirements {
  /** One sentence, e.g. "Hold an NFT from Ileri Pass on Base". */
  summary: string;
  /** "open" when there is no rule at all. */
  state: RuleState | 'open';
  /** False for signed-out visitors: the tree is descriptive only. */
  evaluated: boolean;
  result: RuleResult | null;
}

export async function requirementsFor(
  ctx: AppContext,
  policies: (Course['accessPolicy'] | Community['joinPolicy'])[],
  user: AuthUser | null,
): Promise<Requirements> {
  const present = policies.filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (present.length === 0) return { summary: 'Open to everyone', state: 'open', evaluated: Boolean(user), result: null };
  const describe = await loadDescribeContext(ctx.db, present);
  const combined = present.length === 1 ? present[0]! : ({ type: 'all', rules: present } as const);
  const summary = summarizeRule(combined, describe);
  if (!user) {
    return { summary, state: 'unknown', evaluated: false, result: await describePolicy(ctx.db, combined) };
  }
  const result = await evaluatePolicies(ctx, present, { userId: user.id, wallets: await userWallets(ctx.db, user.id) });
  return { summary, state: result!.state, evaluated: true, result };
}

export type AccessDecision =
  | { state: 'granted'; via: 'staff' | 'open' | 'policy'; requirements: Requirements | null }
  | {
      state: 'denied';
      reason: 'not_member' | 'policy' | 'suspended' | 'unpublished';
      message: string;
      requirements: Requirements | null;
    }
  | { state: 'unavailable'; message: string; requirements: Requirements | null };

export const UNAVAILABLE_MESSAGE =
  "We couldn't confirm your token holdings right now because the blockchain service isn't responding. Your access hasn't changed. Please try again in a minute.";

/**
 * Decides whether a user may read a course's protected content right now.
 * Called at enrollment and on every protected request. Losing eligibility
 * suspends access but never deletes progress or credentials.
 */
export async function courseAccess(
  ctx: AppContext,
  user: AuthUser,
  community: Community,
  course: Course,
  membership?: Membership | null,
): Promise<AccessDecision> {
  if (user.isPlatformAdmin) return { state: 'granted', via: 'staff', requirements: null };
  if (community.status !== 'active') {
    return { state: 'denied', reason: 'suspended', message: 'This community is currently suspended.', requirements: null };
  }
  const member = membership === undefined ? await activeMembership(ctx.db, community.id, user.id) : membership;
  if (member && isStaffRole(member.role)) return { state: 'granted', via: 'staff', requirements: null };
  if (course.status === 'draft') {
    return { state: 'denied', reason: 'unpublished', message: 'This course is not published yet.', requirements: null };
  }
  const requirements = await requirementsFor(ctx, [community.joinPolicy, course.accessPolicy], user);
  if (!member) {
    return {
      state: 'denied',
      reason: 'not_member',
      message: `Join ${community.name} to access this course.`,
      requirements,
    };
  }
  if (requirements.state === 'open') return { state: 'granted', via: 'open', requirements };
  if (requirements.state === 'eligible') return { state: 'granted', via: 'policy', requirements };
  if (requirements.state === 'unknown') return { state: 'unavailable', message: UNAVAILABLE_MESSAGE, requirements };
  return {
    state: 'denied',
    reason: 'policy',
    message:
      "You don't currently meet this course's access requirements. Your progress and credentials are saved, and access returns as soon as you qualify again.",
    requirements,
  };
}

/** Throws the right HTTP error unless access is granted. */
export function assertGranted(decision: AccessDecision): void {
  if (decision.state === 'granted') return;
  if (decision.state === 'unavailable') {
    throw new AppError(503, 'eligibility_unavailable', decision.message, { requirements: decision.requirements });
  }
  throw new AppError(403, decision.reason === 'policy' ? 'access_suspended' : decision.reason, decision.message, {
    requirements: decision.requirements,
  });
}
