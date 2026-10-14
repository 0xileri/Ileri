import { z } from 'zod';
import { chainName, shortAddress } from './chains';

// Access rules decide who may join a community or enroll in a course.
// They establish eligibility only. Completion is decided by assessments.

export type Erc721Rule = {
  type: 'erc721';
  chainId: number;
  contract: string;
  minBalance: number;
  label?: string;
};

export type Erc1155Rule = {
  type: 'erc1155';
  chainId: number;
  contract: string;
  tokenId: string;
  minBalance: number;
  label?: string;
};

export type Erc20Rule = {
  type: 'erc20';
  chainId: number;
  contract: string;
  /** Human-readable amount, e.g. "250" or "0.5". */
  minAmount: string;
  decimals: number;
  symbol?: string;
  label?: string;
};

export type AllowlistRule = {
  type: 'allowlist';
  addresses: string[];
  label?: string;
};

export type CourseCompletionRule = {
  type: 'course_completion';
  courseId: string;
  label?: string;
};

export type GroupRule = {
  type: 'all' | 'any';
  rules: AccessRule[];
};

export type AccessRule =
  | Erc721Rule
  | Erc1155Rule
  | Erc20Rule
  | AllowlistRule
  | CourseCompletionRule
  | GroupRule;

export type TokenRule = Erc721Rule | Erc1155Rule | Erc20Rule;

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a 0x-prefixed 20-byte address');
const label = z.string().trim().max(80).optional();
const chainId = z.number().int().positive();

const erc721Schema = z.object({
  type: z.literal('erc721'),
  chainId,
  contract: evmAddress,
  minBalance: z.number().int().min(1).max(1_000_000),
  label,
});

const erc1155Schema = z.object({
  type: z.literal('erc1155'),
  chainId,
  contract: evmAddress,
  tokenId: z.string().regex(/^\d{1,78}$/, 'Token ID must be a whole number'),
  minBalance: z.number().int().min(1).max(1_000_000),
  label,
});

const erc20Schema = z.object({
  type: z.literal('erc20'),
  chainId,
  contract: evmAddress,
  minAmount: z.string().regex(/^\d{1,30}(\.\d{1,36})?$/, 'Amount must be a positive decimal number'),
  decimals: z.number().int().min(0).max(36),
  symbol: z.string().trim().max(16).optional(),
  label,
});

const allowlistSchema = z.object({
  type: z.literal('allowlist'),
  addresses: z.array(evmAddress).min(1).max(5000),
  label,
});

const courseCompletionSchema = z.object({
  type: z.literal('course_completion'),
  courseId: z.uuid(),
  label,
});

export const accessRuleSchema: z.ZodType<AccessRule> = z.lazy(() =>
  z.union([
    erc721Schema,
    erc1155Schema,
    erc20Schema,
    allowlistSchema,
    courseCompletionSchema,
    z.object({
      type: z.enum(['all', 'any']),
      rules: z.array(accessRuleSchema).min(1).max(20),
    }),
  ]),
);

export const MAX_RULE_DEPTH = 3;

export function ruleDepth(rule: AccessRule): number {
  if (rule.type === 'all' || rule.type === 'any') {
    return 1 + Math.max(0, ...rule.rules.map(ruleDepth));
  }
  return 1;
}

/** Normalises addresses to lowercase so comparisons and cache keys are stable. */
export function normalizeRule(rule: AccessRule): AccessRule {
  switch (rule.type) {
    case 'all':
    case 'any':
      return { type: rule.type, rules: rule.rules.map(normalizeRule) };
    case 'allowlist':
      return { ...rule, addresses: [...new Set(rule.addresses.map((a) => a.toLowerCase()))] };
    case 'erc20':
    case 'erc721':
    case 'erc1155':
      return { ...rule, contract: rule.contract.toLowerCase() };
    default:
      return rule;
  }
}

export function collectRules(rule: AccessRule | null | undefined): AccessRule[] {
  if (!rule) return [];
  if (rule.type === 'all' || rule.type === 'any') return [rule, ...rule.rules.flatMap(collectRules)];
  return [rule];
}

export interface DescribeContext {
  courseTitles?: Record<string, string>;
}

/** One-line, plain-language description of a single rule (groups describe their joiner only). */
export function describeRule(rule: AccessRule, ctx: DescribeContext = {}): string {
  switch (rule.type) {
    case 'erc721': {
      const name = rule.label || `the collection ${shortAddress(rule.contract)}`;
      const count = rule.minBalance === 1 ? 'an NFT' : `${rule.minBalance} NFTs`;
      return `Hold ${count} from ${name} on ${chainName(rule.chainId)}`;
    }
    case 'erc1155': {
      const name = rule.label || `token #${rule.tokenId} of ${shortAddress(rule.contract)}`;
      const count = rule.minBalance === 1 ? '' : ` (at least ${rule.minBalance})`;
      return `Hold ${name}${count} on ${chainName(rule.chainId)}`;
    }
    case 'erc20': {
      const unit = rule.symbol || 'tokens';
      const name = rule.label ? ` (${rule.label})` : ` of ${shortAddress(rule.contract)}`;
      return `Hold at least ${rule.minAmount} ${unit}${name} on ${chainName(rule.chainId)}`;
    }
    case 'allowlist':
      return rule.label
        ? `Use a wallet on the "${rule.label}" list`
        : `Use a wallet on the community's approved list`;
    case 'course_completion': {
      const title = ctx.courseTitles?.[rule.courseId] ?? rule.label ?? 'the prerequisite course';
      return `Complete "${title}"`;
    }
    case 'all':
      return 'Meet all of the following';
    case 'any':
      return 'Meet at least one of the following';
  }
}

/** A full sentence summarising a policy, for catalog cards and settings previews. */
export function summarizeRule(rule: AccessRule | null | undefined, ctx: DescribeContext = {}): string {
  if (!rule) return 'Open to everyone';
  const inner = (r: AccessRule, nested: boolean): string => {
    if (r.type === 'all' || r.type === 'any') {
      const parts = r.rules.map((c) => inner(c, true));
      if (parts.length === 1) return parts[0]!;
      const joined = parts.join(r.type === 'all' ? ' and ' : ' or ');
      return nested ? `(${joined})` : joined;
    }
    const text = describeRule(r, ctx);
    return nested ? text.charAt(0).toLowerCase() + text.slice(1) : text;
  };
  const sentence = inner(rule, false);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export type RuleState = 'eligible' | 'ineligible' | 'unknown';

export interface RuleResult {
  state: RuleState;
  text: string;
  children?: RuleResult[];
}

/** Three-valued AND/OR so an outage never turns into a false "not eligible". */
export function combineStates(kind: 'all' | 'any', states: RuleState[]): RuleState {
  if (kind === 'all') {
    if (states.includes('ineligible')) return 'ineligible';
    if (states.includes('unknown')) return 'unknown';
    return 'eligible';
  }
  if (states.includes('eligible')) return 'eligible';
  if (states.includes('unknown')) return 'unknown';
  return 'ineligible';
}
