import { randomUUID } from 'node:crypto';
import {
  decideTier,
  planTierTransition,
  type TierDecisionPolicy,
  type TierEvidence,
  type TierEvidenceType,
} from '../src/kyc-verification/kyc-tier-decision';
const now = new Date('2026-11-01T12:00:00Z');
const customerId = randomUUID();
const req = () => ({ all: [], any: [] });
const policy = (): TierDecisionPolicy => ({
  version: 'test-policy-1',
  approved: true,
  regulatoryRequirementsConfirmed: true,
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  effectiveUntil: null,
  regulatory: { LEVEL_1: req(), LEVEL_2: req() },
  operator: { LEVEL_1: req(), LEVEL_2: req() },
});
const evidence = (type: TierEvidenceType, override: Partial<TierEvidence> = {}): TierEvidence => ({
  id: randomUUID(),
  customerId,
  identityRevision: 'revision-1',
  type,
  status: 'VERIFIED',
  provenance: 'VERIFIED_PROVIDER',
  verifiedAt: new Date('2026-10-01T00:00:00Z'),
  expiresAt: new Date('2027-01-01T00:00:00Z'),
  ...override,
});
const evaluate = (items: TierEvidence[], p: TierDecisionPolicy | null = policy()) =>
  decideTier({ customerId, identityRevision: 'revision-1', now, policy: p, evidence: items });
describe('non-authoritative KYC tier decision', () => {
  it.each(['BVN', 'NIN'] as const)('allows %s alone for the Tier 1 floor, not Tier 2', (kind) => {
    expect(evaluate([evidence(kind)])).toMatchObject({
      status: 'ELIGIBLE',
      highestTier: 'LEVEL_1',
    });
  });
  it('requires both BVN and NIN for Tier 2 and records support identifiers', () => {
    const a = evidence('BVN'),
      b = evidence('NIN');
    expect(evaluate([a, b])).toMatchObject({
      status: 'ELIGIBLE',
      highestTier: 'LEVEL_2',
      supportingEvidenceIds: [a.id, b.id].sort(),
    });
  });
  it('never accepts synthetic evidence as a real approval', () => {
    expect(
      evaluate([
        evidence('BVN', { provenance: 'SYNTHETIC' }),
        evidence('NIN', { provenance: 'SYNTHETIC' }),
      ]),
    ).toMatchObject({ status: 'PENDING', highestTier: 'NONE' });
  });
  it.each(['REVOKED', 'REJECTED'] as const)('does not use %s evidence', (status) => {
    expect(evaluate([evidence('BVN', { status })])).toMatchObject({
      status: 'PENDING',
      highestTier: 'NONE',
    });
  });
  it('does not use expired evidence and refuses invalid dates', () => {
    expect(evaluate([evidence('BVN', { expiresAt: new Date('2026-10-15') })]).status).toBe(
      'PENDING',
    );
    expect(evaluate([evidence('BVN', { expiresAt: new Date('invalid') })]).status).toBe('REVIEW');
  });
  it('routes mismatched identity and contradictions to review', () => {
    expect(evaluate([evidence('BVN', { identityRevision: 'other' })])).toMatchObject({
      status: 'REVIEW',
      reason: 'IDENTITY_MISMATCH',
    });
    expect(evaluate([evidence('BVN'), evidence('BVN', { status: 'REJECTED' })])).toMatchObject({
      status: 'REVIEW',
      reason: 'CONTRADICTORY_EVIDENCE',
    });
  });
  it('routes ambiguous provider review and cross-customer evidence to review', () => {
    expect(evaluate([evidence('BVN', { status: 'REVIEW' })]).status).toBe('REVIEW');
    expect(evaluate([evidence('BVN', { customerId: randomUUID() })]).status).toBe('REVIEW');
  });
  it('additional regulatory and operator requirements are additive and inherited by Tier 2', () => {
    const p = policy();
    p.regulatory.LEVEL_1.all = ['PHONE'];
    p.operator.LEVEL_2.any = [['ADDRESS', 'BIOMETRIC']];
    const b = evidence('BVN'),
      n = evidence('NIN'),
      phone = evidence('PHONE'),
      address = evidence('ADDRESS');
    expect(evaluate([b, n], p).highestTier).toBe('NONE');
    expect(evaluate([b, n, phone], p).highestTier).toBe('LEVEL_1');
    expect(evaluate([b, n, phone, address], p).highestTier).toBe('LEVEL_2');
  });
  it('requires explicit approved and effective policy and regulatory review', () => {
    const p = policy();
    p.regulatoryRequirementsConfirmed = false;
    expect(evaluate([evidence('BVN')], p).status).toBe('NOT_CONFIGURED');
    p.regulatoryRequirementsConfirmed = true;
    p.approved = false;
    expect(evaluate([], p).status).toBe('NOT_CONFIGURED');
    p.approved = true;
    p.effectiveUntil = now;
    expect(evaluate([], p).status).toBe('NOT_CONFIGURED');
    expect(evaluate([], null).status).toBe('NOT_CONFIGURED');
  });
  it('rejects malformed requirement groups and duplicate evidence IDs', () => {
    const p = policy();
    p.operator.LEVEL_1.any = [[]];
    expect(evaluate([], p).status).toBe('NOT_CONFIGURED');
    const e = evidence('BVN');
    expect(evaluate([e, e])).toMatchObject({ status: 'REVIEW', reason: 'INVALID_EVIDENCE' });
  });
  it('does not let empty operator rules weaken the fixed BVN/NIN floor', () => {
    expect(evaluate([evidence('PHONE')]).highestTier).toBe('NONE');
    expect(evaluate([evidence('NIN')]).highestTier).toBe('LEVEL_1');
  });
});

describe('non-authoritative transition planning', () => {
  it('proposes both upgrade and downgrade but never applies either', () => {
    const one = evaluate([evidence('BVN')]);
    expect(
      planTierTransition({ currentTier: 'NONE', legacyAssessment: false, decision: one }),
    ).toMatchObject({
      action: 'PROPOSE_TRANSITION',
      oldTier: 'NONE',
      newTier: 'LEVEL_1',
      direction: 'UPGRADE',
    });
    expect(
      planTierTransition({ currentTier: 'LEVEL_2', legacyAssessment: false, decision: one }),
    ).toMatchObject({
      action: 'PROPOSE_TRANSITION',
      oldTier: 'LEVEL_2',
      newTier: 'LEVEL_1',
      direction: 'DOWNGRADE',
    });
    const expired = evaluate([evidence('BVN', { expiresAt: new Date('2026-10-15') })]);
    expect(
      planTierTransition({ currentTier: 'LEVEL_1', legacyAssessment: false, decision: expired }),
    ).toMatchObject({ action: 'PROPOSE_TRANSITION', newTier: 'NONE', direction: 'DOWNGRADE' });
  });
  it('does not propose downgrades for ambiguous, unconfigured, legacy or Tier 3 assessments', () => {
    const review = evaluate([evidence('BVN', { status: 'REVIEW' })]);
    expect(
      planTierTransition({ currentTier: 'LEVEL_2', legacyAssessment: false, decision: review })
        .action,
    ).toBe('HOLD_FOR_REVIEW');
    const missing = evaluate([], null);
    expect(
      planTierTransition({ currentTier: 'LEVEL_1', legacyAssessment: false, decision: missing })
        .action,
    ).toBe('HOLD_FOR_REVIEW');
    const eligible = evaluate([evidence('BVN')]);
    expect(
      planTierTransition({ currentTier: 'LEVEL_2', legacyAssessment: true, decision: eligible })
        .action,
    ).toBe('HOLD_FOR_REVIEW');
    expect(
      planTierTransition({ currentTier: 'LEVEL_3', legacyAssessment: false, decision: eligible })
        .action,
    ).toBe('HOLD_FOR_REVIEW');
  });
  it('refuses contradictory or forged decision shapes', () => {
    const d = evaluate([]);
    expect(
      planTierTransition({
        currentTier: 'NONE',
        legacyAssessment: false,
        decision: { ...d, highestTier: 'LEVEL_2' },
      }).action,
    ).toBe('HOLD_FOR_REVIEW');
    expect(
      planTierTransition({
        currentTier: 'NONE',
        legacyAssessment: false,
        decision: { ...d, status: 'ELIGIBLE', highestTier: 'LEVEL_1' },
      }).action,
    ).toBe('HOLD_FOR_REVIEW');
  });
  it('returns no change for a duplicate equivalent evaluation', () => {
    const eligible = evaluate([evidence('NIN')]);
    expect(
      planTierTransition({ currentTier: 'LEVEL_1', legacyAssessment: false, decision: eligible })
        .action,
    ).toBe('NO_CHANGE');
  });
});
