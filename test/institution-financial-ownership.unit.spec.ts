/**
 * ARENA 4 Phase 2 — institutional financial ownership unit contract.
 *
 * Pure, database-free assertions over the published pieces:
 *
 *  - deterministic, order-insensitive governed-change fingerprints for attribution and enrolment;
 *  - the financial-context fingerprint and fail-closed consumption policy;
 *  - the explicit `NotConfiguredFinancialContextResolver` (never a default institution);
 *  - DTO shape rules that keep institutional writes evidence-bearing and purpose-bounded.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  assertFinancialContextCompatible,
  financialContextFingerprint,
  NotConfiguredFinancialContextResolver,
} from '../src/institution/financial-context-resolver';
import {
  DesignatePlatformLedgerAccountDto,
  ExecuteEnrolmentDto,
  ExecuteWalletAttributionDto,
  OpenInstitutionLedgerAccountDto,
  RequestEnrolmentDto,
  RequestWalletAttributionDto,
} from '../src/institution/dto/institution.dto';
import {
  CustomerInstitutionEnrolmentStatus,
  ENROLMENT_TRANSITIONS,
  InstitutionAttributionEvidenceType,
  InstitutionFinancialEligibility,
} from '../src/institution/institution.enums';
import { customerEnrolmentFingerprint } from '../src/institution/customer-institution-enrolment.service';
import { walletAttributionFingerprint } from '../src/institution/wallet-institution-attribution.service';
import type { FinancialContext } from '../src/institution/institution.types';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const attributionInput = {
  walletId: UUID_A,
  institutionId: UUID_B,
  evidenceType: InstitutionAttributionEvidenceType.INSTITUTION_AGREEMENT,
  evidenceReference: 'AGR-001',
  reason: 'Attributed under the executed custody agreement',
  ledgerAccountId: UUID_A,
  ownerClass: 'CUSTOMER',
  ownerReference: UUID_B,
  currentInstitutionId: null,
};

const enrolmentInput = {
  customerId: UUID_A,
  institutionId: UUID_B,
  reference: 'ENR-001',
  targetStatus: CustomerInstitutionEnrolmentStatus.ACTIVE,
  financialEligibility: InstitutionFinancialEligibility.ELIGIBLE,
  statusReason: 'Onboarding agreement executed and verified',
  kycReuse: {
    evidenceReference: 'KYC-1',
    consentReference: 'CONSENT-1',
    policyReference: 'POLICY-1',
  },
  currentStatus: null,
  currentEligibility: null,
};

describe('institutional financial ownership unit contract', () => {
  describe('governed change fingerprints', () => {
    it('is deterministic and independent of object key order', () => {
      expect(walletAttributionFingerprint(attributionInput)).toBe(
        walletAttributionFingerprint({ ...attributionInput }),
      );
      expect(walletAttributionFingerprint(attributionInput)).toMatch(/^[a-f0-9]{64}$/);
      expect(
        walletAttributionFingerprint({
          ...attributionInput,
          // Same values, different construction order: the payload is canonicalised.
          reason: attributionInput.reason,
          evidenceReference: attributionInput.evidenceReference,
        }),
      ).toBe(walletAttributionFingerprint(attributionInput));
    });

    it('binds the request to the exact wallet, institution, evidence and current state', () => {
      const base = walletAttributionFingerprint(attributionInput);
      expect(walletAttributionFingerprint({ ...attributionInput, walletId: UUID_B })).not.toBe(
        base,
      );
      expect(walletAttributionFingerprint({ ...attributionInput, institutionId: UUID_A })).not.toBe(
        base,
      );
      expect(
        walletAttributionFingerprint({ ...attributionInput, evidenceReference: 'AGR-002' }),
      ).not.toBe(base);
      expect(
        walletAttributionFingerprint({ ...attributionInput, currentInstitutionId: UUID_A }),
      ).not.toBe(base);
      expect(
        walletAttributionFingerprint({
          ...attributionInput,
          evidenceType: InstitutionAttributionEvidenceType.CUSTOMER_MANDATE,
        }),
      ).not.toBe(base);
      expect(walletAttributionFingerprint({ ...attributionInput, ownerClass: 'AGENT' })).not.toBe(
        base,
      );
    });

    it('binds an enrolment change to its target state and the state it acts on', () => {
      const base = customerEnrolmentFingerprint(enrolmentInput);
      expect(customerEnrolmentFingerprint({ ...enrolmentInput })).toBe(base);
      expect(base).toMatch(/^[a-f0-9]{64}$/);
      expect(
        customerEnrolmentFingerprint({
          ...enrolmentInput,
          targetStatus: CustomerInstitutionEnrolmentStatus.SUSPENDED,
        }),
      ).not.toBe(base);
      expect(
        customerEnrolmentFingerprint({
          ...enrolmentInput,
          financialEligibility: InstitutionFinancialEligibility.RESTRICTED,
        }),
      ).not.toBe(base);
      expect(
        customerEnrolmentFingerprint({
          ...enrolmentInput,
          currentStatus: CustomerInstitutionEnrolmentStatus.SUSPENDED,
        }),
      ).not.toBe(base);
      expect(customerEnrolmentFingerprint({ ...enrolmentInput, kycReuse: null })).not.toBe(base);
    });

    it('treats a closed enrolment as terminal', () => {
      expect(ENROLMENT_TRANSITIONS[CustomerInstitutionEnrolmentStatus.CLOSED]).toEqual([]);
      expect(ENROLMENT_TRANSITIONS[CustomerInstitutionEnrolmentStatus.ACTIVE]).toEqual(
        expect.arrayContaining([
          CustomerInstitutionEnrolmentStatus.SUSPENDED,
          CustomerInstitutionEnrolmentStatus.CLOSED,
        ]),
      );
    });
  });

  describe('financial context contract', () => {
    const context = (overrides: Partial<FinancialContext> = {}): FinancialContext => {
      const base = {
        outcome: 'RESOLVED' as const,
        reasons: [],
        institutionId: UUID_B,
        institutionStatus: 'APPROVED' as const,
        agentAffiliation: null,
        customerEnrolment: null,
        parties: [
          {
            kind: 'WALLET' as const,
            id: UUID_A,
            ledgerAccountId: UUID_A,
            ownerClass: 'CUSTOMER',
            ownerReference: UUID_B,
            institutionId: UUID_B,
            institutionalScope: 'INSTITUTION' as const,
            institutionalPurpose: null,
          },
        ],
        resolvedAt: '2026-11-13T00:00:00.000Z',
        evidenceFingerprint: '',
        ...overrides,
      };
      return base as FinancialContext;
    };

    it('derives the same fingerprint for the same evidence and a different one otherwise', () => {
      const base = financialContextFingerprint(context());
      expect(base).toMatch(/^[a-f0-9]{64}$/);
      expect(financialContextFingerprint(context())).toBe(base);
      expect(
        financialContextFingerprint(
          context({ reasons: ['UNATTRIBUTED_WALLET'], outcome: 'INCOMPATIBLE' }),
        ),
      ).not.toBe(base);
      expect(financialContextFingerprint(context({ institutionId: UUID_A }))).not.toBe(base);
      expect(
        financialContextFingerprint(
          context({ parties: [{ ...context().parties[0]!, institutionId: null }] }),
        ),
      ).not.toBe(base);
    });

    it('is the only permissive outcome the consumption helper accepts', () => {
      expect(assertFinancialContextCompatible(context()).outcome).toBe('RESOLVED');

      expect(() =>
        assertFinancialContextCompatible(
          context({ outcome: 'INCOMPATIBLE', reasons: ['CROSS_INSTITUTION'] }),
        ),
      ).toThrow(/incompatible/i);
      for (const outcome of ['UNRESOLVED', 'NOT_CONFIGURED', 'INSTITUTION_INACTIVE'] as const) {
        expect(() =>
          assertFinancialContextCompatible(
            context({ outcome, reasons: ['NO_INSTITUTION_CONTEXT'] }),
          ),
        ).toThrow(/unavailable/i);
      }
    });

    it('fails closed without fabricating a default institution', async () => {
      const resolver = new NotConfiguredFinancialContextResolver();
      const result = await resolver.resolve({} as never, { walletIds: [UUID_A] });
      expect(result.outcome).toBe('NOT_CONFIGURED');
      expect(result.institutionId).toBeNull();
      expect(result.reasons).toEqual(['SCHEMA_NOT_CONFIGURED']);
      expect(result.evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(() => assertFinancialContextCompatible(result)).toThrow(/unavailable/i);
    });
  });

  describe('DTO shape rules', () => {
    const errors = async (
      dto: new () => object,
      payload: Record<string, unknown>,
    ): Promise<unknown[]> => validate(plainToInstance(dto, payload));

    const attribution = {
      walletId: UUID_A,
      evidenceType: InstitutionAttributionEvidenceType.INSTITUTION_AGREEMENT,
      evidenceReference: 'AGR-001',
      reason: 'Attributed under the executed custody agreement',
    };

    it('accepts a well-formed attribution request and execute command', async () => {
      expect(await errors(RequestWalletAttributionDto, attribution)).toHaveLength(0);
      expect(
        await errors(ExecuteWalletAttributionDto, { ...attribution, approvalId: UUID_B }),
      ).toHaveLength(0);
    });

    it('rejects unregistered evidence types, missing evidence and short reasons', async () => {
      expect(
        (await errors(RequestWalletAttributionDto, { ...attribution, evidenceType: 'VIBES' }))
          .length,
      ).toBeGreaterThan(0);
      expect(
        (await errors(RequestWalletAttributionDto, { ...attribution, evidenceReference: '' }))
          .length,
      ).toBeGreaterThan(0);
      expect(
        (await errors(RequestWalletAttributionDto, { ...attribution, reason: 'too short' })).length,
      ).toBeGreaterThan(0);
      expect(
        (await errors(RequestWalletAttributionDto, { ...attribution, walletId: 'not-a-uuid' }))
          .length,
      ).toBeGreaterThan(0);
    });

    it('requires the full KYC-reuse triad when reuse is claimed', async () => {
      const enrolment = {
        customerId: UUID_A,
        reference: 'ENR-001',
        targetStatus: CustomerInstitutionEnrolmentStatus.ACTIVE,
        financialEligibility: InstitutionFinancialEligibility.ELIGIBLE,
        statusReason: 'Onboarding agreement executed and verified',
      };
      expect(await errors(RequestEnrolmentDto, enrolment)).toHaveLength(0);
      expect(
        await errors(RequestEnrolmentDto, {
          ...enrolment,
          kycReuse: { evidenceReference: 'KYC-1' },
        }),
      ).not.toHaveLength(0);
      expect(await errors(ExecuteEnrolmentDto, { ...enrolment, approvalId: UUID_B })).toHaveLength(
        0,
      );
      expect(await errors(ExecuteEnrolmentDto, enrolment)).not.toHaveLength(0);
    });

    it('bounds institution ledger accounts to settlement, suspense and clearing purposes', async () => {
      const account = {
        code: 'SETTLE-001',
        name: 'Institution settlement account',
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        currency: 'NGN',
        purpose: 'SETTLEMENT',
      };
      expect(await errors(OpenInstitutionLedgerAccountDto, account)).toHaveLength(0);
      expect(
        await errors(OpenInstitutionLedgerAccountDto, { ...account, purpose: 'CUSTOMER_FUNDS' }),
      ).not.toHaveLength(0);
      expect(
        await errors(OpenInstitutionLedgerAccountDto, {
          ...account,
          purpose: 'PLATFORM_OPERATIONS',
        }),
      ).not.toHaveLength(0);
      expect(
        await errors(OpenInstitutionLedgerAccountDto, { ...account, currency: 'naira' }),
      ).not.toHaveLength(0);
      expect(
        await errors(DesignatePlatformLedgerAccountDto, { ledgerAccountId: UUID_A }),
      ).toHaveLength(0);
      expect(
        await errors(DesignatePlatformLedgerAccountDto, { ledgerAccountId: 'x' }),
      ).not.toHaveLength(0);
    });
  });
});
