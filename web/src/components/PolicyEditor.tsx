import { useMemo, useState } from 'react';
import { accessRuleSchema, summarizeRule, type AccessRule } from '../../../shared/src/access';
import { chainName } from '../../../shared/src/chains';
import { ErrorNotice, Field } from './ui';

type Leaf = Exclude<AccessRule, { type: 'all' | 'any' }>;
type LeafType = Leaf['type'];

interface Props {
  initial: AccessRule | null;
  onSave: (rule: AccessRule | null) => void;
  saving?: boolean;
  error?: unknown;
  courses: { id: string; title: string }[];
  chainIds: number[];
  openLabel: string;
}

const TYPE_LABELS: Record<LeafType, string> = {
  erc721: 'Holds an NFT (ERC-721)',
  erc1155: 'Holds a specific token (ERC-1155)',
  erc20: 'Holds a token balance (ERC-20)',
  allowlist: 'Wallet is on a list',
  course_completion: 'Completed a course',
};

function blank(type: LeafType, chainId: number, courses: { id: string }[]): Leaf {
  switch (type) {
    case 'erc721':
      return { type, chainId, contract: '', minBalance: 1, label: '' };
    case 'erc1155':
      return { type, chainId, contract: '', tokenId: '1', minBalance: 1, label: '' };
    case 'erc20':
      return { type, chainId, contract: '', minAmount: '1', decimals: 18, symbol: '', label: '' };
    case 'allowlist':
      return { type, addresses: [], label: '' };
    case 'course_completion':
      return { type, courseId: courses[0]?.id ?? '' };
  }
}

function isFlat(rule: AccessRule | null): boolean {
  if (!rule) return true;
  if (rule.type === 'all' || rule.type === 'any') return rule.rules.every((r) => r.type !== 'all' && r.type !== 'any');
  return true;
}

/** Strips empty optional strings so the schema accepts them. */
function clean(leaf: Leaf): Leaf {
  const out: Record<string, unknown> = { ...leaf };
  for (const key of ['label', 'symbol']) if (out[key] === '') delete out[key];
  return out as Leaf;
}

export function PolicyEditor({ initial, onSave, saving, error, courses, chainIds, openLabel }: Props) {
  const defaultChain = chainIds[0] ?? 8453;
  const [mode, setMode] = useState<'open' | 'rules' | 'json'>(initial === null ? 'open' : isFlat(initial) ? 'rules' : 'json');
  const [combinator, setCombinator] = useState<'all' | 'any'>(initial && (initial.type === 'any' || initial.type === 'all') ? initial.type : 'all');
  const [leaves, setLeaves] = useState<Leaf[]>(() => {
    if (!initial) return [];
    if (initial.type === 'all' || initial.type === 'any') return initial.rules.filter((r): r is Leaf => r.type !== 'all' && r.type !== 'any');
    return [initial as Leaf];
  });
  const [json, setJson] = useState(() => JSON.stringify(initial, null, 2));
  const [addressDrafts, setAddressDrafts] = useState<Record<number, string>>({});

  const built = useMemo((): { rule: AccessRule | null; problem: string | null } => {
    if (mode === 'open') return { rule: null, problem: null };
    let candidate: unknown;
    if (mode === 'json') {
      try {
        candidate = JSON.parse(json);
      } catch {
        return { rule: null, problem: 'That is not valid JSON.' };
      }
    } else {
      if (leaves.length === 0) return { rule: null, problem: 'Add at least one condition, or make it open.' };
      const cleaned = leaves.map(clean);
      candidate = cleaned.length === 1 ? cleaned[0] : { type: combinator, rules: cleaned };
    }
    const parsed = accessRuleSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { rule: null, problem: issue ? `${issue.path.join('.') || 'rule'}: ${issue.message}` : 'Invalid rule' };
    }
    return { rule: parsed.data, problem: null };
  }, [mode, json, leaves, combinator]);

  const courseTitles = Object.fromEntries(courses.map((c) => [c.id, c.title]));
  const update = (i: number, patch: Partial<Leaf>) => setLeaves((ls) => ls.map((l, j) => (j === i ? ({ ...l, ...patch } as Leaf) : l)));

  return (
    <div>
      <fieldset>
        <legend className="sr-only">Access mode</legend>
        <label className="option">
          <input type="radio" name="policy-mode" checked={mode === 'open'} onChange={() => setMode('open')} />
          <span>
            <strong>{openLabel}</strong>
          </span>
        </label>
        <label className="option">
          <input type="radio" name="policy-mode" checked={mode === 'rules'} onChange={() => setMode('rules')} />
          <span>
            <strong>Require conditions</strong>
            <span className="muted small" style={{ display: 'block' }}>
              Token ownership, an allowlist, or completing another course.
            </span>
          </span>
        </label>
        {mode === 'json' && (
          <label className="option">
            <input type="radio" name="policy-mode" checked readOnly />
            <span>
              <strong>Advanced rule (JSON)</strong>
            </span>
          </label>
        )}
      </fieldset>

      {mode === 'rules' && (
        <div>
          {leaves.length > 1 && (
            <Field label="People must meet" htmlFor="combinator">
              <select id="combinator" value={combinator} onChange={(e) => setCombinator(e.target.value as 'all' | 'any')}>
                <option value="all">All of these conditions</option>
                <option value="any">Any one of these conditions</option>
              </select>
            </Field>
          )}
          {leaves.map((leaf, i) => (
            <div key={i} className="editor-block">
              <div className="editor-head">
                <span className="spacer">Condition {i + 1}</span>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => {
                    setLeaves((ls) => ls.filter((_, j) => j !== i));
                    setAddressDrafts({});
                  }}
                >
                  Remove
                </button>
              </div>
              <div className="editor-body">
                <Field label="Type" htmlFor={`type-${i}`}>
                  <select
                    id={`type-${i}`}
                    value={leaf.type}
                    onChange={(e) => {
                      setLeaves((ls) => ls.map((l, j) => (j === i ? blank(e.target.value as LeafType, defaultChain, courses) : l)));
                      setAddressDrafts((d) => ({ ...d, [i]: '' }));
                    }}
                  >
                    {(Object.keys(TYPE_LABELS) as LeafType[]).map((t) => (
                      <option key={t} value={t} disabled={t === 'course_completion' && courses.length === 0}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                {(leaf.type === 'erc721' || leaf.type === 'erc1155' || leaf.type === 'erc20') && (
                  <>
                    <div className="form-grid">
                      <Field label="Name shown to members" htmlFor={`label-${i}`} hint="e.g. Guild Pass">
                        <input id={`label-${i}`} value={leaf.label ?? ''} onChange={(e) => update(i, { label: e.target.value })} />
                      </Field>
                      <Field label="Chain" htmlFor={`chain-${i}`}>
                        <select id={`chain-${i}`} value={leaf.chainId} onChange={(e) => update(i, { chainId: Number(e.target.value) })}>
                          {chainIds.map((id) => (
                            <option key={id} value={id}>
                              {chainName(id)}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Contract address" htmlFor={`contract-${i}`}>
                      <input id={`contract-${i}`} className="mono" placeholder="0x…" value={leaf.contract} onChange={(e) => update(i, { contract: e.target.value.trim() })} />
                    </Field>
                  </>
                )}
                {(leaf.type === 'erc721' || leaf.type === 'erc1155') && (
                  <div className="form-grid">
                    {leaf.type === 'erc1155' && (
                      <Field label="Token ID" htmlFor={`token-${i}`}>
                        <input id={`token-${i}`} value={leaf.tokenId} onChange={(e) => update(i, { tokenId: e.target.value.trim() })} />
                      </Field>
                    )}
                    <Field label="Minimum held" htmlFor={`min-${i}`}>
                      <input id={`min-${i}`} type="number" min={1} value={leaf.minBalance} onChange={(e) => update(i, { minBalance: Number(e.target.value) })} />
                    </Field>
                  </div>
                )}
                {leaf.type === 'erc20' && (
                  <div className="form-grid">
                    <Field label="Minimum amount" htmlFor={`amount-${i}`}>
                      <input id={`amount-${i}`} value={leaf.minAmount} onChange={(e) => update(i, { minAmount: e.target.value.trim() })} />
                    </Field>
                    <Field label="Symbol" htmlFor={`symbol-${i}`}>
                      <input id={`symbol-${i}`} value={leaf.symbol ?? ''} onChange={(e) => update(i, { symbol: e.target.value })} />
                    </Field>
                    <Field label="Decimals" htmlFor={`decimals-${i}`}>
                      <input id={`decimals-${i}`} type="number" min={0} max={36} value={leaf.decimals} onChange={(e) => update(i, { decimals: Number(e.target.value) })} />
                    </Field>
                  </div>
                )}
                {leaf.type === 'allowlist' && (
                  <>
                    <Field label="List name shown to members" htmlFor={`label-${i}`} hint="Addresses themselves are never shown to members.">
                      <input id={`label-${i}`} value={leaf.label ?? ''} onChange={(e) => update(i, { label: e.target.value })} />
                    </Field>
                    <Field label="Wallet addresses" htmlFor={`addresses-${i}`} hint={`${leaf.addresses.length} addresses. One per line, or separated by commas.`}>
                      <textarea
                        id={`addresses-${i}`}
                        className="code"
                        rows={5}
                        value={addressDrafts[i] ?? leaf.addresses.join('\n')}
                        onChange={(e) => {
                          setAddressDrafts((d) => ({ ...d, [i]: e.target.value }));
                          update(i, { addresses: e.target.value.split(/[\s,]+/).map((a) => a.trim()).filter(Boolean) });
                        }}
                      />
                    </Field>
                  </>
                )}
                {leaf.type === 'course_completion' && (
                  <Field label="Course" htmlFor={`course-${i}`}>
                    <select id={`course-${i}`} value={leaf.courseId} onChange={(e) => update(i, { courseId: e.target.value })}>
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            </div>
          ))}
          <div className="row">
            <button type="button" className="btn small" onClick={() => setLeaves((ls) => [...ls, blank('erc721', defaultChain, courses)])}>
              Add condition
            </button>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                setJson(JSON.stringify(built.rule ?? (leaves.length ? { type: combinator, rules: leaves } : null), null, 2));
                setMode('json');
              }}
            >
              Edit as JSON
            </button>
          </div>
        </div>
      )}

      {mode === 'json' && (
        <Field label="Rule" htmlFor="policy-json" hint="Groups use {type: 'all' | 'any', rules: [...]} and can nest up to three levels.">
          <textarea id="policy-json" className="code" rows={12} value={json} onChange={(e) => setJson(e.target.value)} />
        </Field>
      )}

      <div className="notice" style={{ marginTop: 14 }}>
        <span className="small muted">Members will see: </span>
        <strong style={{ display: 'inline' }}>
          {built.problem ? '…' : mode === 'open' ? openLabel : summarizeRule(built.rule, { courseTitles })}
        </strong>
      </div>
      {built.problem && mode !== 'open' && <p className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>{built.problem}</p>}
      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" className="btn primary" disabled={Boolean(built.problem) || saving} onClick={() => onSave(built.rule)}>
          {saving ? 'Saving…' : 'Save access rules'}
        </button>
      </div>
      {Boolean(error) && <ErrorNotice error={error} />}
    </div>
  );
}
