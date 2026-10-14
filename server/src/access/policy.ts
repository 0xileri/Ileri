import { and, eq, inArray } from 'drizzle-orm';
import { accessRuleSchema, collectRules, MAX_RULE_DEPTH, normalizeRule, ruleDepth, type AccessRule } from '../../../shared/src/access';
import { chainName } from '../../../shared/src/chains';
import type { AppContext } from '../context';
import { courses } from '../db/schema';
import { badRequest } from '../lib/errors';
import { parse } from '../lib/validate';

/** Validates an access policy submitted by a community owner or instructor. */
export async function validatePolicy(
  ctx: AppContext,
  communityId: string,
  raw: unknown,
  selfCourseId?: string,
): Promise<AccessRule | null> {
  if (raw === null || raw === undefined) return null;
  const rule = normalizeRule(parse(accessRuleSchema, raw));
  if (ruleDepth(rule) > MAX_RULE_DEPTH) throw badRequest(`Rules can be nested at most ${MAX_RULE_DEPTH} levels deep.`);
  const leaves = collectRules(rule);
  for (const leaf of leaves) {
    if ((leaf.type === 'erc20' || leaf.type === 'erc721' || leaf.type === 'erc1155') &&
        !ctx.config.supportedChainIds.includes(leaf.chainId)) {
      throw badRequest(
        `${chainName(leaf.chainId)} is not supported. Supported: ${ctx.config.supportedChainIds.map(chainName).join(', ')}.`,
      );
    }
  }
  const courseIds = [...new Set(leaves.flatMap((l) => (l.type === 'course_completion' ? [l.courseId] : [])))];
  if (selfCourseId && courseIds.includes(selfCourseId)) throw badRequest('A course cannot require itself.');
  if (courseIds.length) {
    const found = await ctx.db
      .select({ id: courses.id })
      .from(courses)
      .where(and(inArray(courses.id, courseIds), eq(courses.communityId, communityId)));
    if (found.length !== courseIds.length) throw badRequest('Prerequisite courses must belong to this community.');
  }
  return rule;
}
