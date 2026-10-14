import { and, eq, inArray } from 'drizzle-orm';
import { parseUnits } from 'viem';
import {
  collectRules,
  combineStates,
  describeRule,
  type AccessRule,
  type DescribeContext,
  type RuleResult,
  type RuleState,
  type TokenRule,
} from '../../../shared/src/access';
import type { AppContext } from '../context';
import type { Db } from '../db';
import { completions, courses } from '../db/schema';

export interface Subject {
  userId: string;
  wallets: string[];
}

export async function loadDescribeContext(db: Db, rules: (AccessRule | null | undefined)[]): Promise<DescribeContext> {
  const ids = [
    ...new Set(
      rules.flatMap(collectRules).flatMap((r) => (r.type === 'course_completion' ? [r.courseId] : [])),
    ),
  ];
  if (ids.length === 0) return {};
  const rows = await db.select({ id: courses.id, title: courses.title }).from(courses).where(inArray(courses.id, ids));
  return { courseTitles: Object.fromEntries(rows.map((r) => [r.id, r.title])) };
}

function threshold(rule: TokenRule): bigint {
  if (rule.type === 'erc20') return parseUnits(rule.minAmount, rule.decimals);
  return BigInt(rule.minBalance);
}

async function evaluateToken(ctx: AppContext, rule: TokenRule, subject: Subject): Promise<RuleState> {
  if (subject.wallets.length === 0) return 'ineligible';
  const results = await Promise.all(
    subject.wallets.map((owner) =>
      ctx.balances.get({
        chainId: rule.chainId,
        standard: rule.type,
        contract: rule.contract,
        owner,
        tokenId: rule.type === 'erc1155' ? rule.tokenId : undefined,
      }),
    ),
  );
  // Balances are summed across the learner's verified wallets.
  const total = results.reduce((sum, r) => sum + (r?.balance ?? 0n), 0n);
  if (total >= threshold(rule)) return 'eligible';
  return results.some((r) => r === null) ? 'unknown' : 'ineligible';
}

export async function evaluateRule(
  ctx: AppContext,
  rule: AccessRule,
  subject: Subject,
  describe: DescribeContext,
): Promise<RuleResult> {
  const text = describeRule(rule, describe);
  switch (rule.type) {
    case 'all':
    case 'any': {
      const children = await Promise.all(rule.rules.map((r) => evaluateRule(ctx, r, subject, describe)));
      return { state: combineStates(rule.type, children.map((c) => c.state)), text, children };
    }
    case 'allowlist': {
      const allowed = new Set(rule.addresses.map((a) => a.toLowerCase()));
      return { state: subject.wallets.some((w) => allowed.has(w.toLowerCase())) ? 'eligible' : 'ineligible', text };
    }
    case 'course_completion': {
      const [row] = await ctx.db
        .select({ id: completions.id })
        .from(completions)
        .where(
          and(
            eq(completions.userId, subject.userId),
            eq(completions.courseId, rule.courseId),
            eq(completions.status, 'valid'),
          ),
        )
        .limit(1);
      return { state: row ? 'eligible' : 'ineligible', text };
    }
    default:
      return { state: await evaluateToken(ctx, rule, subject), text };
  }
}

/** Evaluates several policies that must all hold (e.g. community gate + course gate). */
export async function evaluatePolicies(
  ctx: AppContext,
  policies: (AccessRule | null | undefined)[],
  subject: Subject,
): Promise<RuleResult | null> {
  const present = policies.filter((p): p is AccessRule => Boolean(p));
  if (present.length === 0) return null;
  const describe = await loadDescribeContext(ctx.db, present);
  const rule: AccessRule = present.length === 1 ? present[0]! : { type: 'all', rules: present };
  return evaluateRule(ctx, rule, subject, describe);
}

/** Describes a policy without evaluating it, for signed-out visitors. */
export async function describePolicy(db: Db, rule: AccessRule | null | undefined): Promise<RuleResult | null> {
  if (!rule) return null;
  const describe = await loadDescribeContext(db, [rule]);
  const walk = (r: AccessRule): RuleResult => ({
    state: 'unknown',
    text: describeRule(r, describe),
    children: r.type === 'all' || r.type === 'any' ? r.rules.map(walk) : undefined,
  });
  return walk(rule);
}
